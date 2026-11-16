/**
 * Solar Switch Sales Academy: an in-app course for staff.
 *
 * Four modules, each with lessons and a quiz. A member of staff who has passed
 * every module's quiz is issued a numbered certificate. The certificate is a
 * record of training only: it does not unlock or block anything else.
 *
 * Module text starts from lib/academyContent.ts; a super administrator can
 * rewrite any module for their company. Correct answers are never sent to a
 * learner before they have passed the quiz.
 */
import { photoUrlOf, profileComplete } from "./profile";
import { academyTranslation } from "./i18n";
import { translateModule } from "./lib/academyI18n";
import { ConvexError, v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import {
  certificateNumber,
  isModuleKey,
  markQuiz,
  MODULE_KEYS,
  tidyModule,
  validateModule,
  type ModuleContent
} from "./lib/academy";
import { ACADEMY_NAME, DEFAULT_MODULES } from "./lib/academyContent";
import { recordAudit } from "./lib/audit";
import { requireTenantMembership } from "./lib/auth";
import { academyLesson, academyQuestion } from "./schema";

type Ctx = QueryCtx | MutationCtx;

const EDITORS = ["super_admin"] as const;
const TEAM_VIEWERS = ["super_admin", "sales_manager"] as const;
const DAY = 24 * 60 * 60 * 1000;
/** Enough for honest retakes; stops the quiz being guessed through. */
const MAX_ATTEMPTS_PER_DAY = 10;

type LoadedModule = ModuleContent & { version: number; edited: boolean; updatedAt: number | null };

/** The company's four modules in order: its edited copy where one exists, else the built-in text. */
async function loadModules(ctx: Ctx, tenantId: Id<"tenants">): Promise<LoadedModule[]> {
  const rows = new Map<string, Doc<"academyModules">>();
  for (const key of MODULE_KEYS) {
    const row = await ctx.db
      .query("academyModules")
      .withIndex("by_tenant_key", (q) => q.eq("tenantId", tenantId).eq("key", key))
      .unique();
    if (row) rows.set(key, row);
  }
  return MODULE_KEYS.map((key) => {
    const row = rows.get(key);
    if (row) {
      return {
        key,
        title: row.title,
        summary: row.summary,
        lessons: row.lessons,
        questions: row.questions,
        passPercent: row.passPercent,
        version: row.version,
        edited: true,
        updatedAt: row.updatedAt
      };
    }
    const builtIn = DEFAULT_MODULES.find((m) => m.key === key)!;
    return { ...builtIn, version: 0, edited: false, updatedAt: null };
  });
}

/** A module as a learner reads it in their language; marking always uses the English module. */
async function inLanguage(ctx: Ctx, tenantId: Id<"tenants">, module: LoadedModule, lang: string | undefined) {
  if (!lang || lang === "en") return { ...module, translated: false };
  const { translation } = await academyTranslation(ctx, tenantId, module, lang);
  return translateModule(module, translation);
}

async function loadModule(ctx: Ctx, tenantId: Id<"tenants">, key: string) {
  if (!isModuleKey(key)) throw new ConvexError("Module not found.");
  return (await loadModules(ctx, tenantId)).find((m) => m.key === key)!;
}

async function attemptsFor(ctx: Ctx, tenantId: Id<"tenants">, userId: Id<"userProfiles">, moduleKey: string) {
  return await ctx.db
    .query("academyAttempts")
    .withIndex("by_user_module", (q) => q.eq("tenantId", tenantId).eq("userId", userId).eq("moduleKey", moduleKey))
    .collect();
}

/** A learner's standing on one module: their best attempt, and their first pass if any. */
function standing(attempts: Doc<"academyAttempts">[]) {
  if (attempts.length === 0) return { attempts: 0, best: null, passedAt: null as number | null };
  const best = attempts.reduce((a, b) => (b.scorePercent > a.scorePercent ? b : a));
  const passes = attempts.filter((a) => a.passed).sort((a, b) => a.createdAt - b.createdAt);
  return {
    attempts: attempts.length,
    best: { scorePercent: best.scorePercent, correct: best.correct, total: best.total, at: best.createdAt },
    passedAt: passes[0]?.createdAt ?? null
  };
}

async function certificateOf(ctx: Ctx, tenantId: Id<"tenants">, userId: Id<"userProfiles">) {
  return await ctx.db
    .query("academyCertificates")
    .withIndex("by_tenant_user", (q) => q.eq("tenantId", tenantId).eq("userId", userId))
    .first();
}

/**
 * The certificate as it prints today: the number, date and scores are fixed when it is
 * earned; the name and face photo follow the holder's profile, so setting up a profile
 * later still produces a proper certificate.
 */
const presentCertificate = (c: Doc<"academyCertificates">, holder: Doc<"userProfiles">, photoUrl: string | null) => ({
  number: c.number,
  verifyCode: c.verifyCode ?? null,
  holderName: holder.profileUpdatedAt ? holder.displayName : c.holderName,
  photoUrl,
  companyName: c.companyName,
  issuedAt: c.issuedAt,
  modules: c.modules
});

// ------------------------------------------------------------------ learners

/** The course as one member of staff sees it: the four modules and their own progress. */
export const overview = query({
  args: { tenantId: v.id("tenants"), lang: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const { profile, membership } = await requireTenantMembership(ctx, args.tenantId);
    const modules = await loadModules(ctx, args.tenantId);
    const out = [];
    for (const english of modules) {
      const m = await inLanguage(ctx, args.tenantId, english, args.lang);
      const s = standing(await attemptsFor(ctx, args.tenantId, profile._id, m.key));
      out.push({
        key: m.key,
        title: m.title,
        summary: m.summary,
        lessons: m.lessons.length,
        questions: m.questions.length,
        passPercent: m.passPercent,
        attempts: s.attempts,
        bestPercent: s.best?.scorePercent ?? null,
        passed: s.passedAt !== null
      });
    }
    const certificate = await certificateOf(ctx, args.tenantId, profile._id);
    const role = membership.role as string;
    return {
      academyName: ACADEMY_NAME,
      learnerName: profile.displayName,
      modules: out,
      passedCount: out.filter((m) => m.passed).length,
      certificate: certificate ? presentCertificate(certificate, profile, await photoUrlOf(ctx, profile)) : null,
      profileComplete: profileComplete(profile),
      canEdit: (EDITORS as readonly string[]).includes(role),
      canSeeTeam: (TEAM_VIEWERS as readonly string[]).includes(role)
    };
  }
});

/** One module's lessons and quiz. The quiz carries no answers. */
export const getModule = query({
  args: { tenantId: v.id("tenants"), key: v.string(), lang: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const { profile } = await requireTenantMembership(ctx, args.tenantId);
    const m = await inLanguage(ctx, args.tenantId, await loadModule(ctx, args.tenantId, args.key), args.lang);
    const s = standing(await attemptsFor(ctx, args.tenantId, profile._id, m.key));
    const index = MODULE_KEYS.indexOf(m.key as (typeof MODULE_KEYS)[number]);
    return {
      academyName: ACADEMY_NAME,
      key: m.key,
      number: index + 1,
      nextKey: MODULE_KEYS[index + 1] ?? null,
      title: m.title,
      summary: m.summary,
      passPercent: m.passPercent,
      version: m.version,
      translated: m.translated,
      lessons: m.lessons.map((l) => ({ key: l.key, title: l.title, body: l.body, videoUrl: l.videoUrl ?? null })),
      questions: m.questions.map((q) => ({ key: q.key, prompt: q.prompt, options: q.options })),
      attempts: s.attempts,
      bestPercent: s.best?.scorePercent ?? null,
      passed: s.passedAt !== null
    };
  }
});

/**
 * Marks a quiz attempt on the server and, when it completes the course, issues
 * the certificate. A failed attempt learns which questions were wrong but not
 * the right answers; a passed attempt gets the explanations.
 */
export const submitQuiz = mutation({
  args: {
    tenantId: v.id("tenants"),
    key: v.string(),
    // The module version the learner was shown, so an edit made meanwhile is noticed.
    version: v.number(),
    answers: v.array(v.object({ questionKey: v.string(), optionIndex: v.number() })),
    // Explanations come back in this language; marking is on the English module.
    lang: v.optional(v.string())
  },
  handler: async (ctx, args) => {
    const { profile, tenant } = await requireTenantMembership(ctx, args.tenantId);
    const m = await loadModule(ctx, args.tenantId, args.key);
    if (m.version !== args.version) {
      throw new ConvexError("This module was updated while you were taking the quiz. Reload the page and try again.");
    }
    const given = new Map(args.answers.map((a) => [a.questionKey, a.optionIndex]));
    if (m.questions.some((q) => !given.has(q.key))) throw new ConvexError("Answer every question before submitting.");

    const now = Date.now();
    const earlier = await attemptsFor(ctx, args.tenantId, profile._id, m.key);
    if (earlier.filter((a) => a.createdAt > now - DAY).length >= MAX_ATTEMPTS_PER_DAY) {
      throw new ConvexError("That is a lot of attempts for one day. Read the lessons again and try tomorrow.");
    }

    const answers = m.questions.map((q) => given.get(q.key) ?? -1);
    const marked = markQuiz(m.questions, answers, m.passPercent);
    await ctx.db.insert("academyAttempts", {
      tenantId: args.tenantId,
      userId: profile._id,
      moduleKey: m.key,
      moduleVersion: m.version,
      answers,
      correct: marked.correct,
      total: marked.total,
      scorePercent: marked.scorePercent,
      passed: marked.passed,
      createdAt: now
    });

    let certificateNumberIssued: string | null = null;
    if (marked.passed && !(await certificateOf(ctx, args.tenantId, profile._id))) {
      const all = await loadModules(ctx, args.tenantId);
      const passedModules: { key: string; title: string; scorePercent: number; passedAt: number }[] = [];
      for (const mod of all) {
        const passes = (await attemptsFor(ctx, args.tenantId, profile._id, mod.key)).filter((a) => a.passed);
        if (passes.length === 0) break;
        const best = passes.reduce((a, b) => (b.scorePercent > a.scorePercent ? b : a));
        const first = passes.reduce((a, b) => (b.createdAt < a.createdAt ? b : a));
        passedModules.push({ key: mod.key, title: mod.title, scorePercent: best.scorePercent, passedAt: first.createdAt });
      }
      if (passedModules.length === all.length) {
        const seq = await ctx.db
          .query("numberSequences")
          .withIndex("by_tenant_key", (q) => q.eq("tenantId", args.tenantId).eq("key", "academy_certificate"))
          .unique();
        const n = seq?.next ?? 1;
        if (seq) await ctx.db.patch(seq._id, { next: n + 1 });
        else await ctx.db.insert("numberSequences", { tenantId: args.tenantId, key: "academy_certificate", next: 2 });
        certificateNumberIssued = certificateNumber(new Date(now).getUTCFullYear(), n);
        const certificateId = await ctx.db.insert("academyCertificates", {
          tenantId: args.tenantId,
          userId: profile._id,
          number: certificateNumberIssued,
          holderName: profile.displayName,
          companyName: tenant.name,
          modules: passedModules,
          issuedAt: now,
          verifyCode: newVerifyCode()
        });
        await recordAudit(ctx, profile, {
          tenantId: args.tenantId,
          action: "academy.certified",
          entityType: "academyCertificates",
          entityId: certificateId,
          summary: `${profile.displayName} completed the ${ACADEMY_NAME}: certificate ${certificateNumberIssued}.`
        });
      }
    }

    return {
      passed: marked.passed,
      correct: marked.correct,
      total: marked.total,
      scorePercent: marked.scorePercent,
      passPercent: m.passPercent,
      results: (await inLanguage(ctx, args.tenantId, m, args.lang)).questions.map((q, i) => ({
        questionKey: q.key,
        correct: marked.results[i],
        // Answers and explanations are released only once the quiz is passed.
        correctIndex: marked.passed ? q.correctIndex : null,
        explanation: marked.passed ? q.explanation ?? null : null
      })),
      certificateNumber: certificateNumberIssued
    };
  }
});

// ------------------------------------------------------------------ managers

/** Who has passed what, for managers and the administrator. */
export const teamProgress = query({
  args: { tenantId: v.id("tenants") },
  handler: async (ctx, args) => {
    await requireTenantMembership(ctx, args.tenantId, TEAM_VIEWERS);
    const members = (
      await ctx.db
        .query("memberships")
        .withIndex("by_tenant", (q) => q.eq("tenantId", args.tenantId))
        .collect()
    ).filter((m) => m.status === "active");
    const attempts = await ctx.db
      .query("academyAttempts")
      .withIndex("by_tenant", (q) => q.eq("tenantId", args.tenantId))
      .collect();
    const certificates = await ctx.db
      .query("academyCertificates")
      .withIndex("by_tenant", (q) => q.eq("tenantId", args.tenantId))
      .collect();

    const people = [];
    for (const member of members) {
      const person = await ctx.db.get(member.userId);
      if (!person || person.status !== "active") continue;
      const mine = attempts.filter((a) => a.userId === member.userId);
      const certificate = certificates.find((c) => c.userId === member.userId);
      people.push({
        userId: member.userId,
        name: person.displayName,
        role: member.role,
        passed: MODULE_KEYS.map((key) => mine.some((a) => a.moduleKey === key && a.passed)),
        attempts: mine.length,
        certificateNumber: certificate?.number ?? null,
        certifiedAt: certificate?.issuedAt ?? null
      });
    }
    return {
      moduleCount: MODULE_KEYS.length,
      certified: people.filter((p) => p.certificateNumber).length,
      people: people.sort((a, b) => a.name.localeCompare(b.name))
    };
  }
});

// ------------------------------------------------------------------ administrator

/** A module with its answers, for the administrator's editor. */
export const getModuleForEdit = query({
  args: { tenantId: v.id("tenants"), key: v.string() },
  handler: async (ctx, args) => {
    await requireTenantMembership(ctx, args.tenantId, EDITORS);
    const m = await loadModule(ctx, args.tenantId, args.key);
    return {
      key: m.key,
      number: MODULE_KEYS.indexOf(m.key as (typeof MODULE_KEYS)[number]) + 1,
      title: m.title,
      summary: m.summary,
      passPercent: m.passPercent,
      lessons: m.lessons.map((l) => ({ key: l.key, title: l.title, body: l.body, videoUrl: l.videoUrl ?? "" })),
      questions: m.questions.map((q) => ({
        key: q.key,
        prompt: q.prompt,
        options: q.options,
        correctIndex: q.correctIndex,
        explanation: q.explanation ?? ""
      })),
      version: m.version,
      edited: m.edited,
      updatedAt: m.updatedAt
    };
  }
});

/** Replaces one module's content for this company. Earlier passes and certificates stand. */
export const saveModule = mutation({
  args: {
    tenantId: v.id("tenants"),
    key: v.string(),
    // The version the editor loaded; a save over someone else's newer edit is refused.
    expectedVersion: v.number(),
    title: v.string(),
    summary: v.string(),
    passPercent: v.number(),
    lessons: v.array(academyLesson),
    questions: v.array(academyQuestion)
  },
  handler: async (ctx, args) => {
    const { profile } = await requireTenantMembership(ctx, args.tenantId, EDITORS);
    const current = await loadModule(ctx, args.tenantId, args.key);
    if (current.version !== args.expectedVersion) {
      throw new ConvexError("This module was changed by someone else. Reload it to see the latest version.");
    }
    const content = tidyModule({
      key: current.key,
      title: args.title,
      summary: args.summary,
      passPercent: args.passPercent,
      lessons: args.lessons,
      questions: args.questions
    });
    const problem = validateModule(content);
    if (problem) throw new ConvexError(problem);

    const existing = await ctx.db
      .query("academyModules")
      .withIndex("by_tenant_key", (q) => q.eq("tenantId", args.tenantId).eq("key", current.key))
      .unique();
    const version = current.version + 1;
    const fields = {
      title: content.title,
      summary: content.summary,
      passPercent: content.passPercent,
      lessons: content.lessons,
      questions: content.questions,
      version,
      updatedAt: Date.now(),
      updatedBy: profile.authSubject
    };
    const id = existing
      ? (await ctx.db.patch(existing._id, fields), existing._id)
      : await ctx.db.insert("academyModules", { tenantId: args.tenantId, key: current.key, ...fields });
    await recordAudit(ctx, profile, {
      tenantId: args.tenantId,
      action: "academy.module_saved",
      entityType: "academyModules",
      entityId: id,
      summary: `Sales Academy module "${content.title}" updated to version ${version}.`,
      metadata: { key: current.key, lessons: content.lessons.length, questions: content.questions.length }
    });
    return { version };
  }
});

/** Discards the company's edits to one module and returns to the built-in text. */
export const restoreModule = mutation({
  args: { tenantId: v.id("tenants"), key: v.string() },
  handler: async (ctx, args) => {
    const { profile } = await requireTenantMembership(ctx, args.tenantId, EDITORS);
    if (!isModuleKey(args.key)) throw new ConvexError("Module not found.");
    const existing = await ctx.db
      .query("academyModules")
      .withIndex("by_tenant_key", (q) => q.eq("tenantId", args.tenantId).eq("key", args.key))
      .unique();
    if (!existing) return { changed: false };
    await ctx.db.delete(existing._id);
    await recordAudit(ctx, profile, {
      tenantId: args.tenantId,
      action: "academy.module_restored",
      entityType: "academyModules",
      entityId: existing._id,
      summary: `Sales Academy module "${existing.title}" restored to the original text.`,
      metadata: { key: args.key, discardedVersion: existing.version }
    });
    return { changed: true };
  }
});

// ------------------------------------------------------------------ verification

/** 12 characters from an alphabet without look-alikes (no 0/O, 1/I/L). About 60 bits of randomness. */
const VERIFY_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
function newVerifyCode() {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => VERIFY_ALPHABET[b % VERIFY_ALPHABET.length]).join("");
}

/**
 * The verification code for the signed-in person's certificate, for the QR code on the PDF.
 * Certificates issued before codes existed get one the first time they are downloaded.
 */
export const certificateLink = mutation({
  args: { tenantId: v.id("tenants") },
  handler: async (ctx, args) => {
    const { profile } = await requireTenantMembership(ctx, args.tenantId);
    const certificate = await certificateOf(ctx, args.tenantId, profile._id);
    if (!certificate) throw new ConvexError("You do not have a certificate yet.");
    if (certificate.verifyCode) return { code: certificate.verifyCode };
    const code = newVerifyCode();
    await ctx.db.patch(certificate._id, { verifyCode: code });
    return { code };
  }
});

/** Public: what anyone scanning a certificate's QR code sees. Nothing else is reachable by the code. */
export const verifyCertificate = query({
  args: { code: v.string() },
  handler: async (ctx, args) => {
    const code = args.code.trim().toUpperCase();
    if (!/^[A-Z0-9]{12}$/.test(code)) return null;
    const certificate = await ctx.db
      .query("academyCertificates")
      .withIndex("by_verify_code", (q) => q.eq("verifyCode", code))
      .unique();
    if (!certificate) return null;
    const holder = await ctx.db.get(certificate.userId);
    if (!holder) return null;
    return {
      academyName: ACADEMY_NAME,
      ...presentCertificate(certificate, holder, await photoUrlOf(ctx, holder)),
      modules: certificate.modules.map((m) => ({ title: m.title, scorePercent: m.scorePercent })),
      // A certificate stays a true record of training even if the account is later closed.
      holderActive: holder.status === "active"
    };
  }
});
