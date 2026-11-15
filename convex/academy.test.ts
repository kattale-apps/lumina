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
  const people: Record<string, { subject: string }> = {};
  for (const [email, role] of [
    ["agent@acme.ug", "sales_agent"], ["mgr@acme.ug", "sales_manager"], ["stock@acme.ug", "inventory_admin"]
  ] as const) {
    people[email] = await registerUser(t, email);
    await t.mutation(internal.admin.grantMembership, { tenantSlug: "acme", email, role });
  }
  const outsider = await registerUser(t, "nobody@elsewhere.ug");
  const as = (email: string) => t.withIdentity({ subject: people[email].subject });
  return {
    t, tenantId,
    asOwner: t.withIdentity({ subject: owner.subject }),
    agent: as("agent@acme.ug"), mgr: as("mgr@acme.ug"), stock: as("stock@acme.ug"),
    outsider: t.withIdentity({ subject: outsider.subject })
  };
}
type Ctx = Awaited<ReturnType<typeof setup>>;

const right = (key: string) =>
  DEFAULT_MODULES.find((m) => m.key === key)!.questions.map((q) => ({ questionKey: q.key, optionIndex: q.correctIndex }));
const wrong = (key: string) =>
  DEFAULT_MODULES.find((m) => m.key === key)!.questions.map((q) => ({
    questionKey: q.key, optionIndex: (q.correctIndex + 1) % q.options.length
  }));
const take = (who: Ctx["agent"], c: Ctx, key: string, answers = right(key), version = 0) =>
  who.mutation(api.academy.submitQuiz, { tenantId: c.tenantId, key, version, answers });

describe("taking the course", () => {
  test("every member of staff sees the four modules, and nobody else does", async () => {
    const c = await setup();
    const o = await c.agent.query(api.academy.overview, { tenantId: c.tenantId });
    expect(o.academyName).toBe("Solar Switch Sales Academy");
    expect(o.modules.map((m) => m.key)).toEqual(["m1", "m2", "m3", "m4"]);
    expect(o.modules.every((m) => !m.passed && m.attempts === 0 && m.lessons === 4 && m.questions === 6)).toBe(true);
    expect(o.certificate).toBeNull();
    expect(o.canEdit).toBe(false);
    // Stock staff may train too: the course is for everyone on the team.
    expect((await c.stock.query(api.academy.overview, { tenantId: c.tenantId })).modules).toHaveLength(4);
    await expect(c.outsider.query(api.academy.overview, { tenantId: c.tenantId })).rejects.toThrow();
  });

  test("a module is sent to learners without its answers", async () => {
    const c = await setup();
    const m = await c.agent.query(api.academy.getModule, { tenantId: c.tenantId, key: "m1" });
    expect(m.lessons).toHaveLength(4);
    expect(m.questions[0].options).toHaveLength(4);
    expect(JSON.stringify(m)).not.toMatch(/correctIndex|explanation/);
    await expect(c.agent.query(api.academy.getModule, { tenantId: c.tenantId, key: "m9" })).rejects.toThrow(/Module not found/);
  });

  test("a failed attempt says which questions were wrong but not the right answers", async () => {
    const c = await setup();
    const result = await take(c.agent, c, "m1", wrong("m1"));
    expect(result.passed).toBe(false);
    expect(result.correct).toBe(0);
    expect(result.results.every((r) => r.correct === false && r.correctIndex === null && r.explanation === null)).toBe(true);
    expect(result.certificateNumber).toBeNull();
    const o = await c.agent.query(api.academy.overview, { tenantId: c.tenantId });
    expect(o.modules[0]).toMatchObject({ attempts: 1, bestPercent: 0, passed: false });
  });

  test("every question must be answered", async () => {
    const c = await setup();
    await expect(take(c.agent, c, "m1", right("m1").slice(1))).rejects.toThrow(/Answer every question/);
  });

  test("passing all four modules issues one numbered certificate", async () => {
    const c = await setup();
    for (const key of ["m1", "m2", "m3"]) {
      const r = await take(c.agent, c, key);
      expect(r.passed).toBe(true);
      expect(r.scorePercent).toBe(100);
      expect(r.results[0].explanation).toBeTruthy();
      expect(r.certificateNumber).toBeNull();
    }
    const last = await take(c.agent, c, "m4");
    const number = `SSA-${new Date().getUTCFullYear()}-00001`;
    expect(last.certificateNumber).toBe(number);

    const o = await c.agent.query(api.academy.overview, { tenantId: c.tenantId });
    expect(o.passedCount).toBe(4);
    expect(o.certificate?.number).toBe(number);
    expect(o.certificate?.holderName).toBe("agent");
    expect(o.certificate?.companyName).toBe("Acme Solar");
    expect(o.certificate?.modules.map((m) => m.scorePercent)).toEqual([100, 100, 100, 100]);

    // Passing again does not issue a second certificate; the next person gets the next number.
    expect((await take(c.agent, c, "m4")).certificateNumber).toBeNull();
    for (const key of ["m1", "m2", "m3"]) await take(c.mgr, c, key);
    expect((await take(c.mgr, c, "m4")).certificateNumber).toBe(`SSA-${new Date().getUTCFullYear()}-00002`);
  });

  test("a pass after earlier failures still counts", async () => {
    const c = await setup();
    await take(c.agent, c, "m2", wrong("m2"));
    await take(c.agent, c, "m2");
    const o = await c.agent.query(api.academy.overview, { tenantId: c.tenantId });
    expect(o.modules[1]).toMatchObject({ attempts: 2, bestPercent: 100, passed: true });
  });

  test("attempts are limited per day", async () => {
    const c = await setup();
    for (let i = 0; i < 10; i++) await take(c.agent, c, "m1", wrong("m1"));
    await expect(take(c.agent, c, "m1")).rejects.toThrow(/a lot of attempts/);
  });
});

describe("team progress", () => {
  test("managers see who is certified; agents do not", async () => {
    const c = await setup();
    for (const key of ["m1", "m2", "m3", "m4"]) await take(c.agent, c, key);
    await take(c.stock, c, "m1");
    const team = await c.mgr.query(api.academy.teamProgress, { tenantId: c.tenantId });
    expect(team.certified).toBe(1);
    const agent = team.people.find((p) => p.name === "agent")!;
    expect(agent.passed).toEqual([true, true, true, true]);
    expect(agent.certificateNumber).toMatch(/^SSA-/);
    expect(team.people.find((p) => p.name === "stock")!.passed).toEqual([true, false, false, false]);
    await expect(c.agent.query(api.academy.teamProgress, { tenantId: c.tenantId })).rejects.toThrow();
  });
});

describe("editing the course", () => {
  const edited = (over: object = {}) => {
    const m = DEFAULT_MODULES[0];
    return {
      key: "m1", expectedVersion: 0, title: "Power basics for our team", summary: m.summary, passPercent: 100,
      lessons: [{ key: "x-l1", title: "One lesson", body: "Our own text.", videoUrl: "https://www.youtube.com/watch?v=abc123" }],
      questions: [
        { key: "x-q1", prompt: "One unit is?", options: ["1 kWh", "1 W"], correctIndex: 0, explanation: "A unit is a kWh." },
        { key: "x-q2", prompt: "Power is measured in?", options: ["Watts", "Litres"], correctIndex: 0 },
        { key: "x-q3", prompt: "Energy is measured in?", options: ["Metres", "kWh"], correctIndex: 1 }
      ],
      ...over
    };
  };

  test("only the administrator may read answers or change a module", async () => {
    const c = await setup();
    await expect(c.agent.query(api.academy.getModuleForEdit, { tenantId: c.tenantId, key: "m1" })).rejects.toThrow();
    await expect(c.mgr.mutation(api.academy.saveModule, { tenantId: c.tenantId, ...edited() })).rejects.toThrow();
    const full = await c.asOwner.query(api.academy.getModuleForEdit, { tenantId: c.tenantId, key: "m1" });
    expect(full.edited).toBe(false);
    expect(full.questions[0].correctIndex).toBe(DEFAULT_MODULES[0].questions[0].correctIndex);
  });

  test("a saved module replaces the built-in text and is what learners are marked against", async () => {
    const c = await setup();
    expect(await c.asOwner.mutation(api.academy.saveModule, { tenantId: c.tenantId, ...edited() })).toEqual({ version: 1 });
    const m = await c.agent.query(api.academy.getModule, { tenantId: c.tenantId, key: "m1" });
    expect(m.title).toBe("Power basics for our team");
    expect(m.version).toBe(1);
    expect(m.lessons[0].videoUrl).toBe("https://www.youtube.com/watch?v=abc123");
    expect(m.questions).toHaveLength(3);

    // A learner who loaded the old version is told to reload, not marked against questions they never saw.
    await expect(take(c.agent, c, "m1")).rejects.toThrow(/updated while you were taking the quiz/);
    const answers = [
      { questionKey: "x-q1", optionIndex: 0 }, { questionKey: "x-q2", optionIndex: 0 }, { questionKey: "x-q3", optionIndex: 0 }
    ];
    // Two of three is below the new 100% pass mark.
    expect((await take(c.agent, c, "m1", answers, 1)).passed).toBe(false);
    answers[2].optionIndex = 1;
    expect((await take(c.agent, c, "m1", answers, 1)).passed).toBe(true);
  });

  test("invalid content and stale saves are refused", async () => {
    const c = await setup();
    const save = (over: object) => c.asOwner.mutation(api.academy.saveModule, { tenantId: c.tenantId, ...edited(over) });
    await expect(save({ title: "  " })).rejects.toThrow(/title/);
    await expect(save({ questions: [] })).rejects.toThrow(/at least 3 quiz questions/);
    await expect(save({ lessons: [{ key: "l", title: "L", body: "B", videoUrl: "http://insecure.example/v" }] })).rejects.toThrow(/https/);
    await save({});
    await expect(save({})).rejects.toThrow(/changed by someone else/);
  });

  test("restoring a module brings back the original text; earlier passes stand", async () => {
    const c = await setup();
    await take(c.agent, c, "m1");
    await c.asOwner.mutation(api.academy.saveModule, { tenantId: c.tenantId, ...edited() });
    expect(await c.asOwner.mutation(api.academy.restoreModule, { tenantId: c.tenantId, key: "m1" })).toEqual({ changed: true });
    const m = await c.agent.query(api.academy.getModule, { tenantId: c.tenantId, key: "m1" });
    expect(m.title).toBe(DEFAULT_MODULES[0].title);
    expect(m.version).toBe(0);
    expect(m.passed).toBe(true);
    expect(await c.asOwner.mutation(api.academy.restoreModule, { tenantId: c.tenantId, key: "m1" })).toEqual({ changed: false });
    await expect(c.agent.mutation(api.academy.restoreModule, { tenantId: c.tenantId, key: "m1" })).rejects.toThrow();
  });
});
