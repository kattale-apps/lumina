/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import { DEFAULT_MODULES } from "./lib/academyContent";
import schema from "./schema";

const modules = import.meta.glob("./**/*.*s");
type T = ReturnType<typeof convexTest>;

async function registerUser(t: T, email: string) {
  return await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", { email });
    await ctx.db.insert("userProfiles", {
      authSubject: userId, email, displayName: email.split("@")[0], status: "active",
      createdAt: Date.now(), updatedAt: Date.now()
    });
    return { subject: `${userId}|test-session` };
  });
}

async function setup() {
  const t = convexTest(schema, modules);
  const owner = await registerUser(t, "owner@acme.ug");
  const { tenantId } = await t.mutation(internal.admin.bootstrapTenant, {
    companyName: "Acme Solar", slug: "acme", adminEmail: "owner@acme.ug"
  });
  const agentUser = await registerUser(t, "agent@acme.ug");
  await t.mutation(internal.admin.grantMembership, { tenantSlug: "acme", email: "agent@acme.ug", role: "sales_agent" });
  const asOwner = t.withIdentity({ subject: owner.subject });
  await asOwner.mutation(api.estimator.updateEstimatorSettings, { tenantId, enabled: true, tariffPerKwh: 800 });
  return { t, tenantId, asOwner, agent: t.withIdentity({ subject: agentUser.subject }) };
}

const m1 = DEFAULT_MODULES.find((m) => m.key === "m1")!;
const translated = {
  moduleKey: "m1",
  title: "Ebikwata ku masannyalaze",
  summary: "Ensonga enkulu ez’amasannyalaze g’enjuba.",
  lessons: [{ key: m1.lessons[0].key, title: "Amaanyi n’ensimbi", body: "## Amaanyi\nEbigambo ebyetaagisa." }],
  questions: m1.questions.map((q) => ({ key: q.key, prompt: `LG ${q.prompt}`, options: q.options.map((o) => `LG ${o}`), explanation: `LG ${q.explanation ?? ""}` }))
};

describe("screen text corrections", () => {
  test("only the super administrator corrects text; the public pages get it with the review state", async () => {
    const { t, tenantId, asOwner, agent } = await setup();
    expect(await t.query(api.i18n.publicOverrides, { lang: "lg" })).toEqual({ reviewed: false, entries: {} });
    await expect(agent.mutation(api.i18n.setUiText, { tenantId, lang: "lg", key: "home.title", text: "x" })).rejects.toThrow(/role/);
    await expect(asOwner.mutation(api.i18n.setUiText, { tenantId, lang: "en", key: "home.title", text: "x" })).rejects.toThrow(/other than English/);
    await expect(asOwner.mutation(api.i18n.setUiText, { tenantId, lang: "lg", key: "bad key!", text: "x" })).rejects.toThrow(/Unknown/);

    await asOwner.mutation(api.i18n.setUiText, { tenantId, lang: "lg", key: "home.title", text: "  Tuyamba buli muntu.  " });
    await asOwner.mutation(api.i18n.setReviewed, { tenantId, lang: "lg", reviewed: true });
    expect(await t.query(api.i18n.publicOverrides, { lang: "lg" })).toEqual({ reviewed: true, entries: { "home.title": "Tuyamba buli muntu." } });
    // Empty text goes back to the shipped draft.
    await asOwner.mutation(api.i18n.setUiText, { tenantId, lang: "lg", key: "home.title", text: "" });
    expect((await t.query(api.i18n.publicOverrides, { lang: "lg" })).entries).toEqual({});
    const overview = await asOwner.query(api.i18n.languageOverview, { tenantId });
    expect(overview.find((o) => o.lang === "lg")).toMatchObject({ reviewed: true, corrections: 0 });
  });

  test("a person's language choice is kept on their profile", async () => {
    const { agent } = await setup();
    await agent.mutation(api.profile.setLanguage, { language: "nyn" });
    expect((await agent.query(api.profile.myProfile, {}))!.language).toBe("nyn");
    await expect(agent.mutation(api.profile.setLanguage, { language: "fr" })).rejects.toThrow(/Unknown language/);
  });
});

describe("Academy translations", () => {
  test("learners read the translation, the quiz is still marked on the English answers", async () => {
    const { tenantId, asOwner, agent } = await setup();
    await asOwner.mutation(api.i18n.saveAcademyTranslation, { tenantId, lang: "lg", ...translated });

    const mod = await agent.query(api.academy.getModule, { tenantId, key: "m1", lang: "lg" });
    expect(mod.translated).toBe(true);
    expect(mod.title).toBe("Ebikwata ku masannyalaze");
    expect(mod.lessons[0].title).toBe("Amaanyi n’ensimbi");
    // A lesson without a translation stays in English.
    expect(mod.lessons[1].title).toBe(m1.lessons[1].title);
    expect(mod.questions[0].options[0]).toBe(`LG ${m1.questions[0].options[0]}`);
    // English is unchanged for everyone else.
    expect((await agent.query(api.academy.getModule, { tenantId, key: "m1" })).title).toBe(m1.title);
    expect((await agent.query(api.academy.overview, { tenantId, lang: "lg" })).modules[0].title).toBe("Ebikwata ku masannyalaze");

    const result = await agent.mutation(api.academy.submitQuiz, {
      tenantId, key: "m1", version: mod.version, lang: "lg",
      answers: m1.questions.map((q) => ({ questionKey: q.key, optionIndex: q.correctIndex }))
    });
    expect(result.passed).toBe(true);
    expect(result.results[0].explanation).toBe(`LG ${m1.questions[0].explanation}`);
  });

  test("a translation must line up with the English, and goes stale when the English changes", async () => {
    const { tenantId, asOwner, agent } = await setup();
    const short = { ...translated, questions: [{ ...translated.questions[0], options: ["only one"] }] };
    await expect(asOwner.mutation(api.i18n.saveAcademyTranslation, { tenantId, lang: "lg", ...short })).rejects.toThrow(/answer choices/);
    await expect(agent.mutation(api.i18n.saveAcademyTranslation, { tenantId, lang: "lg", ...translated })).rejects.toThrow(/role/);
    await asOwner.mutation(api.i18n.saveAcademyTranslation, { tenantId, lang: "lg", ...translated });

    // The administrator rewrites the English module: the old translation must not show any more.
    const edit = await asOwner.query(api.academy.getModuleForEdit, { tenantId, key: "m1" });
    await asOwner.mutation(api.academy.saveModule, {
      tenantId, key: "m1", expectedVersion: edit.version, title: "Solar basics (new)", summary: edit.summary,
      passPercent: edit.passPercent, lessons: edit.lessons, questions: edit.questions
    });
    const mod = await agent.query(api.academy.getModule, { tenantId, key: "m1", lang: "lg" });
    expect(mod.translated).toBe(false);
    expect(mod.title).toBe("Solar basics (new)");
    const forEdit = await asOwner.query(api.i18n.academyForEdit, { tenantId, lang: "lg", moduleKey: "m1" });
    expect(forEdit.source).toBe("stale");
  });
});
