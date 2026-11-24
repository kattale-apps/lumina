"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import type { Id } from "../../../../convex/_generated/dataModel";
import { ConvexError } from "convex/values";
import { api } from "../../../../convex/_generated/api";
import { ApplianceEditor, rowsToItems, type ApplianceRow } from "../ApplianceEditor";
import { rememberPendingRequest } from "../../../lib/pendingRequests";
import { Rich, useT, type MessageKey } from "@/lib/i18n";
import { en } from "@/lib/i18n/en";
import { StepButtons, StepProgress, useGoBack } from "@/components/StepNav";
import { requestReference, WhatsAppSend } from "@/components/WhatsAppSend";
import { PublicShell } from "@/components/PublicShell";

const STEPS = 3;
type Grid = "none" | "unreliable" | "reliable";
type Match = FunctionReturnType<typeof api.budget.budgetMatch>;
type System = NonNullable<Match["closest"]>;

const GRID_CHOICES: { value: Grid; emoji: string }[] = [
  { value: "reliable", emoji: "✅" },
  { value: "unreliable", emoji: "⚠️" },
  { value: "none", emoji: "🚫" }
];
const QUICK_AMOUNTS = [1_000_000, 2_000_000, 5_000_000, 10_000_000, 20_000_000];

function message(error: unknown, fallback: string) {
  return error instanceof ConvexError && typeof error.data === "string" ? error.data : fallback;
}

const amountText = (n: number) => n.toLocaleString("en-US");
/** "5M" for the quick buttons. */
const shortAmount = (n: number) => (n >= 1_000_000 ? `${n / 1_000_000}M` : amountText(n));

export default function BudgetPage() {
  if (!process.env.NEXT_PUBLIC_CONVEX_URL) return null;
  return (
    <PublicShell>
      <BudgetCheck />
    </PublicShell>
  );
}

function BudgetCheck() {
  const t = useT();
  const goBack = useGoBack("/");
  const config = useQuery(api.estimator.publicConfig, {});
  const customer = useQuery(api.shop.myAccount, {});
  const match = useAction(api.budget.budgetMatch);
  const submit = useMutation(api.budget.submitBudgetRequest);
  const logCheck = useMutation(api.checks.logCheck);
  const opened = useMutation(api.whatsappAgents.opened);
  const [checkId, setCheckId] = useState<Id<"publicChecks"> | null>(null);

  const [step, setStep] = useState(1);
  const [amount, setAmount] = useState("");
  const [grid, setGrid] = useState<Grid>("unreliable");
  const [rows, setRows] = useState<ApplianceRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // What the shown results were worked out from, so a request sends the same answers.
  const [result, setResult] = useState<null | { match: Match; budget: number; grid: Grid; rows: ApplianceRow[] }>(null);
  // The system to request: a key, or "advice" for "Send us your budget".
  const [chosen, setChosen] = useState<string | null>(null);
  const [form, setForm] = useState({ name: "", phone: "", location: "", website: "" });
  const [done, setDone] = useState<null | { whatsappText: string | null; name: string; phone: string; whatsappNumber: string | null; requestId: Id<"quoteRequests"> | null }>(null);

  const signedIn = customer?.signedIn === true;
  const account = signedIn ? customer.account : null;
  const budget = Number(amount.replace(/[^\d]/g, "")) || 0;

  if (config === undefined) return <p className="muted">{t("common.loading")}</p>;
  if (!config.enabled) {
    return (
      <>
        <h1>{t("estimate.notOpen")}</h1>
        <p className="muted">{t("estimate.notOpenHint")}</p>
      </>
    );
  }
  const currency = config.currency;
  const fmt = (n: number) => `${currency} ${amountText(n)}`;

  function toTop() {
    setTimeout(() => document.getElementById("budget-top")?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
  }
  function goToStep(next: number) {
    setError(null);
    setStep(next);
    toTop();
  }

  async function next(event: FormEvent) {
    event.preventDefault();
    if (step === 1 && budget <= 0) {
      setError(t("budget.errAmount"));
      return;
    }
    if (step < STEPS) {
      goToStep(step + 1);
      return;
    }
    if (rows.length === 0) {
      setError(t("budget.errAppliances"));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const found = await match({ budget, grid, items: rowsToItems(rows) });
      setResult({ match: found, budget, grid, rows });
      setCheckId(null);
      void logCheck({
        kind: "budget",
        summary: `Budget ${fmt(budget)}, ${rows.length} appliance(s), ${found.closest ? "a system fits" : "nothing fits"}`
      }).then((r) => setCheckId(r.checkId)).catch(() => undefined);
      setChosen(null);
      toTop();
    } catch (e) {
      setError(message(e, t("common.genericError")));
    } finally {
      setBusy(false);
    }
  }

  function choose(key: string) {
    setChosen(key);
    setError(null);
    setTimeout(() => document.getElementById("request")?.scrollIntoView({ behavior: "smooth" }), 50);
  }

  const allShown = (m: Match) => [m.closest, ...m.best, ...m.below, ...m.above, m.smallest].filter((s): s is System => s !== null);

  /** The request as a WhatsApp message to the company, in English for the team. */
  function whatsappMessage(requestId: string, systemTitle: string | null) {
    if (!result || !config?.enabled) return null;
    const who = account ?? { name: form.name, phone: form.phone };
    const system = allShown(result.match).find((s) => s.key === chosen);
    const appliances = rowsToItems(result.rows).slice(0, 15).map((a) => `• ${a.quantity} × ${a.size ? `${a.name}, ${a.size}` : a.name} (${a.hoursPerDay} h a day)`);
    return [
      `Hello ${config.companyName}, what can my budget buy?`,
      "",
      `Budget: ${fmt(result.budget)} for equipment (installation not included)`,
      `Electricity: ${en[`estimate.grid.${result.grid}` as MessageKey]}`,
      "",
      "Appliances:",
      ...appliances,
      "",
      system && systemTitle
        ? [
            `Interested in: ${systemTitle}`,
            ...system.components.map((c) => `• ${c.quantity} × ${c.role}: ${[c.brand, c.model ?? c.name].filter(Boolean).join(" ")}${c.detail ? ` (${c.detail})` : ""}`),
            ...(system.leavesOut.length ? [`Leaves out: ${system.leavesOut.join(", ")}`] : [])
          ].join("\n")
        : "Please advise what my budget can buy.",
      "",
      `Name: ${who.name}`,
      `Phone: ${who.phone}`,
      `Location: ${form.location}`,
      `Reference: ${requestReference(requestId)}`,
      `Open in the app: ${window.location.origin}/dashboard/leads/${requestId}`
    ].filter((line, i, all) => line !== "" || all[i - 1] !== "").join("\n");
  }

  async function send(event: FormEvent) {
    event.preventDefault();
    if (!result || !chosen) return;
    setBusy(true);
    setError(null);
    try {
      const sent = await submit({
        checkId: checkId ?? undefined,
        budget: result.budget,
        grid: result.grid,
        items: rowsToItems(result.rows),
        systemKey: chosen === "advice" ? undefined : chosen,
        name: account ? undefined : form.name,
        phone: account ? undefined : form.phone,
        location: form.location,
        website: form.website || undefined
      });
      if (sent.claimToken) rememberPendingRequest(sent.claimToken);
      setDone({
        whatsappText: sent.requestId ? whatsappMessage(sent.requestId, sent.systemTitle) : null,
        name: (account?.name ?? form.name).split(" ")[0],
        phone: account?.phone ?? form.phone,
        whatsappNumber: sent.whatsappNumber,
        requestId: sent.requestId
      });
      setTimeout(() => window.scrollTo({ top: 0, behavior: "smooth" }), 50);
    } catch (e) {
      setError(message(e, t("common.genericError")));
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <>
        <h1>{t("estimate.thanks", { name: done.name })}</h1>
        <p><Rich text={t("budget.thanksText", { phone: done.phone })} /></p>
        {done.whatsappNumber && done.whatsappText ? <WhatsAppSend number={done.whatsappNumber} text={done.whatsappText} onOpen={() => { if (done.requestId) void opened({ quoteRequestId: done.requestId }); }} /> : null}
        {config.contactPhone ? <p className="muted">{t("common.questionsCall", { phone: config.contactPhone })}</p> : null}
        <div className="hero-actions">
          <button type="button" className="button button-secondary" onClick={() => { setDone(null); setResult(null); setChosen(null); goToStep(1); }}>
            {t("budget.another")}
          </button>
          <Link className="button button-secondary" href="/">{t("estimate.backHome")}</Link>
        </div>
      </>
    );
  }

  const firstEmpty = account
    ? (form.location.trim() ? "" : "location")
    : !form.name.trim() ? "name" : !form.phone.trim() ? "phone" : !form.location.trim() ? "location" : "";
  const glowIf = (field: string) => (firstEmpty === field ? "guide-glow" : undefined);

  if (result) {
    const m = result.match;
    const chosenSystem = chosen && chosen !== "advice" ? allShown(m).find((s) => s.key === chosen) ?? null : null;
    const group = (title: MessageKey, hint: MessageKey, list: System[], tone: string) =>
      list.length ? (
        <div className={`budget-group budget-group-${tone}`}>
          <h2>{t(title)}</h2>
          <p className="hint">{t(hint)}</p>
          <div className="option-list">
            {list.map((s) => <SystemCard key={s.key} system={s} chosen={chosen === s.key} onChoose={() => choose(s.key)} />)}
          </div>
        </div>
      ) : null;
    return (
      <section id="results" className="estimate-results budget-results" aria-live="polite">
        <span id="budget-top" />
        <p className="eyebrow">{config.companyName.toUpperCase()}</p>
        <div className="results-head">
          <h1>{t("budget.resultsTitle", { amount: fmt(result.budget) })}</h1>
          <button type="button" className="button button-secondary button-small" onClick={() => { setResult(null); setChosen(null); goToStep(1); }}>
            ← {t("estimate.changeAnswers")}
          </button>
        </div>
        <div className="budget-note">
          <p><Rich text={t("budget.noInstall")} /></p>
          <p>{t("budget.noPricesNote")}</p>
        </div>

        {m.status === "no_prices" ? <p className="budget-nothing" role="status">{t("budget.noPrices")}</p> : null}
        {m.status === "ok" && !m.closest ? (
          <div className="budget-nothing" role="status">
            <p><Rich text={t("budget.nothingFits", { amount: fmt(result.budget) })} /></p>
            <p className="hint">{t("budget.nothingFitsHint")}</p>
          </div>
        ) : null}
        {m.roomToSpare ? <p className="budget-spare">🎉 {t("budget.roomToSpare")}</p> : null}

        {group("budget.closest", "budget.closestHint", m.closest ? [m.closest] : [], "closest")}
        {group("budget.best", "budget.bestHint", m.best, "best")}
        {group("budget.below", "budget.belowHint", m.below, "below")}
        {group("budget.above", "budget.aboveHint", m.above, "above")}
        {group("budget.smallest", "budget.smallestHint", m.smallest ? [m.smallest] : [], "above")}

        <div className={`recommend-card ${chosen === "advice" ? "option-on" : ""}`}>
          <h3>{t("budget.notSure")}</h3>
          <p>{t("budget.notSureText")}</p>
          <button type="button" className={`button${!m.closest ? " guide-glow" : ""}`} onClick={() => choose("advice")}>
            {chosen === "advice" ? t("estimate.selected") : t("budget.sendBudget")}
          </button>
        </div>

        {chosen ? (
          <form id="request" className="panel-form" onSubmit={send}>
            <h2>{chosenSystem ? t("budget.formTitle") : t("budget.formTitleAdvice")}</h2>
            {chosenSystem ? <p><strong>{t(`budget.sys.${chosenSystem.systemType}` as MessageKey)}</strong> · {storageText(t, chosenSystem)}</p> : null}
            <p className="hint">{t("budget.formHint")}</p>
            {account ? (
              <div className="signed-in-request">
                <strong>{t("estimate.requestingAs", { name: account.name })}</strong>
              </div>
            ) : (
              <>
                <label htmlFor="bq-name">{t("estimate.yourName")}</label>
                <input id="bq-name" className={glowIf("name")} required maxLength={100} autoComplete="name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
                <label htmlFor="bq-phone">{t("estimate.phone")}</label>
                <input id="bq-phone" className={glowIf("phone")} required type="tel" maxLength={20} autoComplete="tel" placeholder="+256 700 000000" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
              </>
            )}
            <label htmlFor="bq-loc">{t("item.location")}</label>
            <input id="bq-loc" className={glowIf("location")} required maxLength={200} autoComplete="address-level2" value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} />
            <div className="honeypot" aria-hidden="true">
              <label htmlFor="bq-site">Website</label>
              <input id="bq-site" tabIndex={-1} autoComplete="off" value={form.website} onChange={(e) => setForm({ ...form, website: e.target.value })} />
            </div>
            {error ? <p className="auth-message" role="alert">{error}</p> : null}
            <button className={`button${firstEmpty ? "" : " guide-glow"}`} type="submit" disabled={busy || customer === undefined}>
              {busy ? t("estimate.sending") : t("estimate.send")}
            </button>
          </form>
        ) : null}
      </section>
    );
  }

  return (
    <>
      <span id="budget-top" />
      <p className="eyebrow">{config.companyName.toUpperCase()}</p>
      <h1>{t("budget.title")}</h1>
      {step === 1 ? <p className="muted">{t("budget.intro")}</p> : null}
      <form className="panel-form estimate-form" onSubmit={next} noValidate>
        <StepProgress step={step} total={STEPS} label={t("wizard.progress", { step, total: STEPS })} />

        <section className="step step-1" aria-labelledby="bq1" hidden={step !== 1}>
          <h2 id="bq1"><span className="step-num">1</span> {t("budget.q1")}</h2>
          <label htmlFor="budget-amount">{t("budget.amount", { currency })}</label>
          <input
            id="budget-amount"
            className={`budget-amount${budget > 0 ? "" : " guide-glow"}`}
            inputMode="numeric"
            autoComplete="off"
            placeholder={t("budget.amountPlaceholder")}
            value={amount}
            onChange={(e) => {
              const digits = e.target.value.replace(/[^\d]/g, "").slice(0, 11);
              setAmount(digits ? amountText(Number(digits)) : "");
            }}
          />
          <div className="chip-row">
            {QUICK_AMOUNTS.map((n) => (
              <button type="button" key={n} className={`chip ${budget === n ? "chip-on" : ""}`} onClick={() => setAmount(amountText(n))}>
                {shortAmount(n)}
              </button>
            ))}
          </div>
          <p className="budget-note"><Rich text={t("budget.equipmentOnly")} /></p>
        </section>

        <section className="step step-2" aria-labelledby="bq2" hidden={step !== 2}>
          <h2 id="bq2"><span className="step-num">2</span> {t("budget.q2")}</h2>
          <div className="choice-row" role="radiogroup" aria-labelledby="bq2">
            {GRID_CHOICES.map((c) => (
              <button type="button" key={c.value} role="radio" aria-checked={grid === c.value} className={`choice ${grid === c.value ? "choice-on" : ""}`} onClick={() => setGrid(c.value)}>
                <strong><span aria-hidden="true">{c.emoji}</span> {t(`estimate.grid.${c.value}`)}</strong>
                <span>{t(`estimate.grid.${c.value}.hint`)}</span>
              </button>
            ))}
          </div>
          <p className="hint">🔋 {t("budget.q2Hint")}</p>
        </section>

        <section className="step step-3" aria-labelledby="bq3" hidden={step !== 3}>
          <h2 id="bq3"><span className="step-num">3</span> {t("budget.q3")}</h2>
          {rows.length === 0 ? <p className="guide-pointer">👇 {t("estimate.q3Prompt")}</p> : null}
          <ApplianceEditor rows={rows} setRows={setRows} library={config.appliances} guide={step === 3} />
        </section>

        {error ? <p className="auth-message" role="alert">{error}</p> : null}
        <StepButtons
          onBack={step > 1 ? () => goToStep(step - 1) : goBack}
          backLabel={t("wizard.back")}
          nextLabel={busy ? t("budget.working") : step < STEPS ? t("wizard.next") : t("budget.show")}
          busy={busy}
          glowNext={(step === 1 && budget > 0) || step === 2 || (step === 3 && rows.length > 0)}
        />
      </form>
    </>
  );
}

function storageText(t: ReturnType<typeof useT>, s: System) {
  if (s.backupHours) return t("budget.hours", { hours: s.backupHours });
  return s.autonomyDays === 1 ? t("budget.fullDay") : t("budget.halfDay");
}

function SystemCard({ system: s, chosen, onChoose }: { system: System; chosen: boolean; onChoose: () => void }) {
  const t = useT();
  const hasPanels = s.components.some((c) => c.role === "Solar panels");
  return (
    <article className={`option-card budget-card ${chosen ? "option-on" : ""}`}>
      <h3>{t(`budget.sys.${s.systemType}` as MessageKey)}</h3>
      <p className="muted">{t(`budget.sys.${s.systemType}.hint` as MessageKey)}</p>
      <div className="pill-row">
        <span className="pill pill-info">🔋 {storageText(t, s)}</span>
        <span className={hasPanels ? "pill pill-ok" : "pill"}>{hasPanels ? `☀️ ${t("budget.panels")}` : `🔌 ${t("budget.noPanels")}`}</span>
      </div>
      <ul className="component-list">
        {s.components.map((c) => (
          <li key={c.role}>
            <strong>{c.quantity} × {c.role}</strong>
            <span>{[c.brand, c.model ?? c.name].filter(Boolean).join(" ")}{c.detail ? ` · ${c.detail}` : ""}</span>
            {c.estimated ? <span className="pill pill-warn">{t("estimate.specsPending")}</span> : null}
          </li>
        ))}
      </ul>
      <p className="option-figures">
        {s.batteryKwh !== null ? <>{t("budget.figBattery", { kwh: s.batteryKwh })}. </> : null}
        {s.arrayKw !== null ? <>{t("budget.figSolar", { kw: s.arrayKw, kwh: s.solarKwhPerDay ?? 0 })}. </> : null}
        {s.inverterW !== null ? <>{t("budget.figInverter", { watts: s.inverterW.toLocaleString("en-US") })}.</> : null}
      </p>
      {s.leavesOut.length ? (
        <>
          <p className="budget-runs">✅ {t("budget.runs", { list: s.runs.join(", ") })}</p>
          <p className="budget-out">✖ {t("budget.leavesOut", { list: s.leavesOut.join(", ") })}</p>
        </>
      ) : (
        <p className="budget-runs">✅ {t("budget.runsAll")}</p>
      )}
      {s.toConfirm ? <p className="hint">{t("budget.toConfirm")}</p> : null}
      <button type="button" className="button" onClick={onChoose}>
        {chosen ? t("estimate.selected") : t("budget.requestThis")}
      </button>
    </article>
  );
}
