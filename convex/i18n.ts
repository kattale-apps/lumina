import { ConvexError, v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { requireTenantMembership } from "./lib/auth";
import { MODULE_KEYS, isModuleKey } from "./lib/academy";
import { DEFAULT_MODULES } from "./lib/academyContent";
import { ACADEMY_DRAFTS, type ModuleTranslation } from "./lib/academyI18n";
import { TRANSLATED_LANGS, isLang, type Lang } from "./lib/languages";

/**
 * Translations of the public pages and the Sales Academy. Drafts ship with the app; a super
 * administrator's corrections are stored here and win over them.
 */

type Ctx = QueryCtx | MutationCtx;
const EDITORS = ["super_admin"] as const;
const KEY_PATTERN = /^[a-z0-9_.-]{1,100}$/i;
const MAX_TEXT = 4000;

function requireTranslatedLang(lang: string): Lang {
  if (!isLang(lang) || lang === "en") throw new ConvexError("Choose a language other than English.");
  return lang;
}

/** The company whose public pages are open (the one with the public power check switched on). */
async function openCompany(ctx: Ctx) {
  const settings = await ctx.db
    .query("publicEstimatorSettings")
    .withIndex("by_enabled", (q) => q.eq("enabled", true))
    .first();
  if (!settings) return null;
  const tenant = await ctx.db.get(settings.tenantId);
  return tenant && tenant.status === "active" ? tenant : null;
}

async function reviewedFor(ctx: Ctx, tenantId: Id<"tenants">, lang: string) {
  const row = await ctx.db
    .query("languageStatus")
    .withIndex("by_tenant_lang", (q) => q.eq("tenantId", tenantId).eq("lang", lang))
    .unique();
  return row?.reviewed ?? false;
}

async function overridesFor(ctx: Ctx, tenantId: Id<"tenants">, lang: string) {
  const rows = await ctx.db
    .query("uiTranslations")
    .withIndex("by_tenant_lang_key", (q) => q.eq("tenantId", tenantId).eq("lang", lang))
    .collect();
  return Object.fromEntries(rows.map((r) => [r.key, r.text])) as Record<string, string>;
}

/** Public: the corrections for one language and whether it has been reviewed. */
export const publicOverrides = query({
  args: { lang: v.string() },
  handler: async (ctx, args) => {
    if (!isLang(args.lang) || args.lang === "en") return { reviewed: true, entries: {} as Record<string, string> };
    const tenant = await openCompany(ctx);
    if (!tenant) return { reviewed: false, entries: {} as Record<string, string> };
    return { reviewed: await reviewedFor(ctx, tenant._id, args.lang), entries: await overridesFor(ctx, tenant._id, args.lang) };
  }
});

// ------------------------------------------------------------------ editing screen text

/** Every language's review status, for the translations page. */
export const languageOverview = query({
  args: { tenantId: v.id("tenants") },
  handler: async (ctx, args) => {
    await requireTenantMembership(ctx, args.tenantId, EDITORS);
    const out = [];
    for (const lang of TRANSLATED_LANGS) {
      const corrections = await ctx.db
        .query("uiTranslations")
        .withIndex("by_tenant_lang_key", (q) => q.eq("tenantId", args.tenantId).eq("lang", lang))
        .collect();
      out.push({ lang, reviewed: await reviewedFor(ctx, args.tenantId, lang), corrections: corrections.length });
    }
    return out;
  }
});

export const uiCorrections = query({
  args: { tenantId: v.id("tenants"), lang: v.string() },
  handler: async (ctx, args) => {
    await requireTenantMembership(ctx, args.tenantId, EDITORS);
    const lang = requireTranslatedLang(args.lang);
    return { reviewed: await reviewedFor(ctx, args.tenantId, lang), entries: await overridesFor(ctx, args.tenantId, lang) };
  }
});

/** Saves a correction to one piece of screen text; empty text goes back to the draft. */
export const setUiText = mutation({
  args: { tenantId: v.id("tenants"), lang: v.string(), key: v.string(), text: v.string() },
  handler: async (ctx, args) => {
    const { profile } = await requireTenantMembership(ctx, args.tenantId, EDITORS);
    const lang = requireTranslatedLang(args.lang);
    if (!KEY_PATTERN.test(args.key)) throw new ConvexError("Unknown text.");
    const text = args.text.trim();
    if (text.length > MAX_TEXT) throw new ConvexError(`Keep it to ${MAX_TEXT} characters.`);
    const existing = await ctx.db
      .query("uiTranslations")
      .withIndex("by_tenant_lang_key", (q) => q.eq("tenantId", args.tenantId).eq("lang", lang).eq("key", args.key))
      .unique();
    if (!text) {
      if (existing) await ctx.db.delete(existing._id);
      return { saved: false };
    }
    const fields = { text, updatedAt: Date.now(), updatedBy: profile._id };
    if (existing) await ctx.db.patch(existing._id, fields);
    else await ctx.db.insert("uiTranslations", { tenantId: args.tenantId, lang, key: args.key, ...fields });
    return { saved: true };
  }
});

/** Marks a language as checked by a native speaker (removes the draft notice), or back to draft. */
export const setReviewed = mutation({
  args: { tenantId: v.id("tenants"), lang: v.string(), reviewed: v.boolean() },
  handler: async (ctx, args) => {
    await requireTenantMembership(ctx, args.tenantId, EDITORS);
    const lang = requireTranslatedLang(args.lang);
    const row = await ctx.db
      .query("languageStatus")
      .withIndex("by_tenant_lang", (q) => q.eq("tenantId", args.tenantId).eq("lang", lang))
      .unique();
    if (row) await ctx.db.patch(row._id, { reviewed: args.reviewed, updatedAt: Date.now() });
    else await ctx.db.insert("languageStatus", { tenantId: args.tenantId, lang, reviewed: args.reviewed, updatedAt: Date.now() });
    return { reviewed: args.reviewed };
  }
});

// ------------------------------------------------------------------ Academy translations

type EnglishModule = { key: string; version: number; lessons: { key: string }[]; questions: { key: string; options: string[] }[] };

/**
 * The translation that applies to a module in a language: the company's saved one when it was
 * made from the current English version; otherwise the shipped draft, but only while the
 * company still uses the built-in English text. Anything else falls back to English.
 */
export async function academyTranslation(
  ctx: Ctx,
  tenantId: Id<"tenants">,
  module: EnglishModule,
  lang: string
): Promise<{ translation: ModuleTranslation | null; stale: boolean }> {
  if (!isLang(lang) || lang === "en") return { translation: null, stale: false };
  const row = await ctx.db
    .query("academyTranslations")
    .withIndex("by_tenant_module_lang", (q) => q.eq("tenantId", tenantId).eq("moduleKey", module.key).eq("lang", lang))
    .unique();
  if (row && row.sourceVersion === module.version) return { translation: fromRow(row), stale: false };
  if (module.version === 0) {
    const draft = ACADEMY_DRAFTS[lang]?.find((m) => m.key === module.key) ?? null;
    if (draft) return { translation: draft, stale: false };
  }
  return { translation: null, stale: Boolean(row) };
}

function fromRow(row: Doc<"academyTranslations">): ModuleTranslation {
  return { key: row.moduleKey, title: row.title, summary: row.summary, lessons: row.lessons, questions: row.questions };
}

/** One module in English and in a language, side by side, for the editor. */
export const academyForEdit = query({
  args: { tenantId: v.id("tenants"), lang: v.string(), moduleKey: v.string() },
  handler: async (ctx, args) => {
    await requireTenantMembership(ctx, args.tenantId, EDITORS);
    const lang = requireTranslatedLang(args.lang);
    if (!isModuleKey(args.moduleKey)) throw new ConvexError("Module not found.");
    const row = await ctx.db
      .query("academyModules")
      .withIndex("by_tenant_key", (q) => q.eq("tenantId", args.tenantId).eq("key", args.moduleKey))
      .unique();
    const builtIn = DEFAULT_MODULES.find((m) => m.key === args.moduleKey)!;
    const english = row
      ? { key: row.key, title: row.title, summary: row.summary, lessons: row.lessons, questions: row.questions, version: row.version }
      : { ...builtIn, version: 0 };
    const { translation, stale } = await academyTranslation(ctx, args.tenantId, english, lang);
    const saved = await ctx.db
      .query("academyTranslations")
      .withIndex("by_tenant_module_lang", (q) => q.eq("tenantId", args.tenantId).eq("moduleKey", args.moduleKey).eq("lang", lang))
      .unique();
    return {
      modules: MODULE_KEYS.map((k) => k),
      english: {
        title: english.title,
        summary: english.summary,
        lessons: english.lessons.map((l) => ({ key: l.key, title: l.title, body: l.body })),
        questions: english.questions.map((q) => ({ key: q.key, prompt: q.prompt, options: q.options, explanation: q.explanation ?? "" }))
      },
      // What learners see now (saved, or the shipped draft), or the stale saved one to update.
      translation: translation ?? (saved ? fromRow(saved) : null),
      source: translation ? (saved && saved.sourceVersion === english.version ? "saved" : "draft") : saved ? "stale" : "none",
      stale
    };
  }
});

export const saveAcademyTranslation = mutation({
  args: {
    tenantId: v.id("tenants"),
    lang: v.string(),
    moduleKey: v.string(),
    title: v.string(),
    summary: v.string(),
    lessons: v.array(v.object({ key: v.string(), title: v.string(), body: v.string() })),
    questions: v.array(
      v.object({ key: v.string(), prompt: v.string(), options: v.array(v.string()), explanation: v.optional(v.string()) })
    )
  },
  handler: async (ctx, args) => {
    const { profile } = await requireTenantMembership(ctx, args.tenantId, EDITORS);
    const lang = requireTranslatedLang(args.lang);
    if (!isModuleKey(args.moduleKey)) throw new ConvexError("Module not found.");
    const row = await ctx.db
      .query("academyModules")
      .withIndex("by_tenant_key", (q) => q.eq("tenantId", args.tenantId).eq("key", args.moduleKey))
      .unique();
    const english = row ?? { ...DEFAULT_MODULES.find((m) => m.key === args.moduleKey)!, version: 0 };
    // The translation must line up with the English: same lessons and questions, same number of answer choices.
    const lessonKeys = new Set(english.lessons.map((l) => l.key));
    for (const l of args.lessons) if (!lessonKeys.has(l.key)) throw new ConvexError("A lesson does not match the English module.");
    for (const q of args.questions) {
      const source = english.questions.find((e) => e.key === q.key);
      if (!source) throw new ConvexError("A question does not match the English module.");
      if (q.options.length !== source.options.length) throw new ConvexError(`"${source.prompt.slice(0, 40)}…" needs ${source.options.length} answer choices.`);
    }
    const tooLong = [args.title, args.summary, ...args.lessons.flatMap((l) => [l.title, l.body]), ...args.questions.flatMap((q) => [q.prompt, ...q.options, q.explanation ?? ""])].some(
      (s) => s.length > 12000
    );
    if (tooLong) throw new ConvexError("One of the texts is too long.");
    const fields = {
      sourceVersion: "version" in english ? english.version : 0,
      title: args.title.trim(),
      summary: args.summary.trim(),
      lessons: args.lessons,
      questions: args.questions,
      updatedAt: Date.now(),
      updatedBy: profile._id
    };
    const existing = await ctx.db
      .query("academyTranslations")
      .withIndex("by_tenant_module_lang", (q) => q.eq("tenantId", args.tenantId).eq("moduleKey", args.moduleKey).eq("lang", lang))
      .unique();
    if (existing) await ctx.db.patch(existing._id, fields);
    else await ctx.db.insert("academyTranslations", { tenantId: args.tenantId, moduleKey: args.moduleKey, lang, ...fields });
    return { saved: true };
  }
});
