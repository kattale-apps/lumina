"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { useConvex, useMutation, useQuery } from "convex/react";
import type { FunctionArgs, FunctionReturnType } from "convex/server";
import { ConvexError } from "convex/values";
import { api } from "../../../convex/_generated/api";
import { guideByKey } from "../../../convex/lib/applianceGuide";
import { ApplianceEditor, rowsToItems, type ApplianceRow } from "./ApplianceEditor";
import type { ReportLine } from "./usageReport";
import { SmsImport, useSmsSummary } from "./SmsImport";
import { AppUpdateNeeded, savePdf } from "../../lib/savePdf";
import { rememberPendingRequest } from "../../lib/pendingRequests";
import { clearPendingEstimate, savePendingEstimate } from "../../lib/pendingEstimate";
import { Rich, useT, type MessageKey } from "@/lib/i18n";
import { en } from "@/lib/i18n/en";
import { StepButtons, StepProgress, useGoBack } from "@/components/StepNav";
import { requestReference, WhatsAppSend } from "@/components/WhatsAppSend";
import { PublicShell } from "@/components/PublicShell";

const STEPS = 4;

type Grid = "none" | "unreliable" | "reliable";
/** Matches RECOMMENDATION_KEY on the server: ask a technician to design a system. */
const RECOMMENDATION = "recommendation";
type Category = "residential" | "commercial_small" | "commercial_medium" | "industrial";

const CATEGORY_CHOICES: { value: Category; emoji: string }[] = [
  { value: "residential", emoji: "🏠" },
  { value: "commercial_small", emoji: "🏪" },
  { value: "commercial_medium", emoji: "🏨" },
  { value: "industrial", emoji: "🏭" }
];

const GRID_CHOICES: { value: Grid; emoji: string }[] = [
  { value: "reliable", emoji: "✅" },
  { value: "unreliable", emoji: "⚠️" },
  { value: "none", emoji: "🚫" }
];

function message(error: unknown, fallback: string) {
  if (error instanceof ConvexError && typeof error.data === "string") return error.data;
  return fallback;
}

/** Text for a fixed option template, translated when the key is known, else the server's English. */
function optionText(t: (key: MessageKey) => string, key: string, fallback: string) {
  const k = key as MessageKey;
  return k in en ? t(k) : fallback;
}

function money(minor: number, exponent: number, currency: string) {
  const value = minor / 10 ** exponent;
  return `${currency} ${value.toLocaleString("en-US", { maximumFractionDigits: exponent })}`;
}

export default function EstimatePage() {
  if (!process.env.NEXT_PUBLIC_CONVEX_URL) return <Unavailable />;
  return <Estimator />;
}

function Unavailable() {
  const t = useT();
  return (
    <main className="auth-shell">
      <section className="auth-card">
        <h1>{t("estimate.unavailable")}</h1>
        <p>{t("estimate.unavailableHint")}</p>
      </section>
    </main>
  );
}

function Estimator() {
  const t = useT();
  const goBack = useGoBack("/");
  const convex = useConvex();
  const config = useQuery(api.estimator.publicConfig, {});
  // Public sign-up is off for now: the request reaches the team without an account.
  const signUpOpen = useQuery(api.access.signUpStatus, {})?.publicSignUpOpen ?? false;
  // Use the same customer-account lookup as the customer dashboard, not staff/profile state.
  const customer = useQuery(api.shop.myAccount, {});
  const submit = useMutation(api.estimator.submitRequest);

  const [category, setCategory] = useState<Category>("residential");
  // Most customers have grid power that comes and goes, so that is the starting answer.
  const [grid, setGrid] = useState<Grid | null>("unreliable");
  // One question on screen at a time, then a page with the results.
  const [step, setStep] = useState(1);
  const [view, setView] = useState<"questions" | "results">("questions");
  const [rows, setRows] = useState<ApplianceRow[]>([]);
  // Step 4 (optional): UEDCL token messages give the real price per unit and actual use.
  const [smsText, setSmsText] = useState("");
  const [smsMeter, setSmsMeter] = useState<string | null>(null);
  const [smsDaysByMeter, setSmsDaysByMeter] = useState<Record<string, string>>({});
  const sms = useSmsSummary(smsText, smsMeter, smsDaysByMeter);
  // What the shown results were calculated from, so the PDF matches the screen.
  const [snapshot, setSnapshot] = useState<{
    lines: ReportLine[];
    category: Category;
    /** What the token messages showed, when both appliances and messages were given. */
    tokens: { dailyKwh: number; monthCost: number; pricePerUnit: number } | null;
  } | null>(null);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<FunctionReturnType<typeof api.estimator.recommend> | null>(null);
  const [chosen, setChosen] = useState<string | null>(null);
  const [form, setForm] = useState({ name: "", phone: "", email: "", location: "", website: "" });
  const signedInCustomer = customer?.signedIn === true;
  const hasCustomerAccount = signedInCustomer && customer.account !== null;
  // After sending: whether the request already went to a signed-in customer account.
  const [done, setDone] = useState<null | { hasAccount: boolean; whatsappText: string | null }>(null);

  function runQuery(input: FunctionArgs<typeof api.estimator.recommend>) {
    return convex.query(api.estimator.recommend, input);
  }

  if (config === undefined) {
    return <Shell><p className="muted">{t("common.loading")}</p></Shell>;
  }
  if (!config.enabled) {
    return (
      <Shell>
        <h1>{t("estimate.notOpen")}</h1>
        <p className="muted">{t("estimate.notOpenHint")}</p>
      </Shell>
    );
  }

  const exponent = config.exponent;
  const unitRate = config.categoryRatesMinor?.[category] ?? config.tariffMinorPerKwh;
  const currency = config.currency;

  // Token messages are usable once there is a time span to spread them over.
  const tokensReady = sms.purchases.length > 0 && sms.summary.days !== null && sms.summary.units > 0;
  // Whole currency units only: the server refuses fractions of a shilling.
  const tokenRate = tokensReady && sms.summary.pricePerUnit ? Math.round(sms.summary.pricePerUnit) : undefined;

  function buildInput() {
    // Appliances drive the design. Without them, the token messages alone give the usage.
    if (rows.length === 0) {
      return {
        mode: "bill" as const,
        category,
        units: sms.summary.units,
        days: sms.summary.days ?? 0,
        amount: sms.summary.amount > 0 ? sms.summary.amount : undefined
      };
    }
    return {
      mode: "appliances" as const,
      category,
      items: rowsToItems(rows),
      ratePerKwh: tokenRate
    };
  }

  function toTop() {
    setTimeout(() => document.getElementById("estimate-top")?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
  }
  function goToStep(next: number) {
    setError(null);
    setStep(next);
    toTop();
  }

  /** Next: the following question, or the results after the last one. */
  async function calculate(event: FormEvent) {
    event.preventDefault();
    if (step === 2 && !grid) {
      setError(t("estimate.errGrid"));
      return;
    }
    if (step < STEPS) {
      goToStep(step + 1);
      return;
    }
    if (!grid) {
      goToStep(2);
      setError(t("estimate.errGrid"));
      return;
    }
    if (sms.purchases.length > 0 && !sms.summary.days) {
      setError(t("estimate.errDays"));
      return;
    }
    if (rows.length === 0 && !tokensReady) {
      goToStep(3);
      setError(t("estimate.errNothing"));
      return;
    }
    setBusy(true);
    setError(null);
    setChosen(null);
    try {
      const check = { input: buildInput(), grid };
      const response = await runQuery(check);
      setResult(response);
      // Kept on the phone so the same options appear in My recommendations after signing up.
      if (customer !== undefined && !hasCustomerAccount) savePendingEstimate(check);
      setSnapshot({
        category,
        lines:
          rows.length > 0
            ? rows.map((r) => {
                const g = guideByKey(r.guideKey);
                return {
                  name: g && g.sizes.length > 1 && r.size ? `${r.name}, ${r.size}` : r.name,
                  powerW: Number(r.powerW),
                  quantity: Number(r.quantity),
                  hoursPerDay: Number(r.hours),
                  duty: g?.duty ?? 1
                };
              })
            : [],
        tokens:
          rows.length > 0 && tokensReady && sms.summary.projection && tokenRate
            ? { dailyKwh: sms.summary.projection.kwh.day, monthCost: sms.summary.projection.cost.month, pricePerUnit: tokenRate }
            : null
      });
      setView("results");
      toTop();
    } catch (e) {
      setResult(null);
      setSnapshot(null);
      setError(message(e, t("common.genericError")));
    } finally {
      setBusy(false);
    }
  }

  async function downloadReport() {
    if (!result || !snapshot) return;
    setPdfBusy(true);
    try {
      const { buildUsageReport } = await import("./usageReport");
      const bytes = await buildUsageReport({
        companyName: config!.enabled ? config!.companyName : "Solar Switch",
        customerType: en[`estimate.cat.${snapshot.category}` as MessageKey] ?? "",
        currency: result.currency,
        exponent: result.exponent,
        rateMinorPerKwh: result.summary.ratePerKwhMinor,
        dailyKwh: result.summary.dailyKwh,
        peakW: result.summary.peakW,
        basis: result.summary.basis,
        lines: snapshot.lines,
        // The recommendations travel with the report. Parts only: prices are never included.
        options: result.options.map((o) => ({
          title: o.title,
          blurb: o.blurb,
          components: o.components.map((c) => `${c.quantity} x ${c.role}: ${[c.brand, c.model ?? c.name].filter(Boolean).join(" ")}${c.detail ? ` (${c.detail})` : ""}`),
          figures: [
            o.arrayKw !== null ? `Solar ${o.arrayKw} kW, about ${o.solarKwhPerDay ?? 0} kWh a day${o.coveragePercent !== null ? `, covers about ${o.coveragePercent}% of your use` : ""}` : "",
            o.batteryKwh !== null ? `Battery ${o.batteryKwh} kWh` : ""
          ].filter(Boolean),
          notes: o.notes
        }))
      });
      await savePdf(bytes, `energy-usage-estimate-${new Date().toISOString().slice(0, 10)}.pdf`, "Energy usage estimate", { ready: t("pdf.ready"), open: t("pdf.open"), hint: t("pdf.hint"), close: t("pdf.close") });
    } catch (e) {
      setError(e instanceof AppUpdateNeeded ? e.message : t("estimate.errPdf"));
    } finally {
      setPdfBusy(false);
    }
  }

  /** The request as a WhatsApp message to the company, in English for the technician. */
  function whatsappMessage(requestId: string) {
    if (!result || !config?.enabled) return null;
    const who = hasCustomerAccount ? customer.account! : { name: form.name, phone: form.phone };
    const fmt = (minor: number | null) => (minor === null ? null : money(minor, result.exponent, result.currency));
    const appliances = (snapshot?.lines ?? []).slice(0, 15).map((l) => `• ${l.quantity} × ${l.name} (${l.hoursPerDay} h a day)`);
    const more = (snapshot?.lines.length ?? 0) > 15 ? [`• …and ${(snapshot?.lines.length ?? 0) - 15} more`] : [];
    const chosenTitle = chosen === RECOMMENDATION ? "A system recommendation and quotation" : result.options.find((o) => o.key === chosen)?.title ?? "";
    const month = fmt(result.summary.costPerMonthMinor);
    return [
      `Hello ${config.companyName}, I would like a solar recommendation.`,
      "",
      `Name: ${who.name}`,
      `Phone: ${who.phone}`,
      `Location: ${form.location}`,
      `Type: ${en[`estimate.cat.${snapshot?.category ?? category}` as MessageKey] ?? ""}`,
      grid ? `Electricity: ${en[`estimate.grid.${grid}` as MessageKey]}` : "",
      `Energy use: about ${result.summary.dailyKwh} kWh a day${month ? ` (about ${month} a month)` : ""}`,
      `Busiest moment: about ${result.summary.peakW.toLocaleString("en-US")} W`,
      ...(appliances.length ? ["", "Appliances:", ...appliances, ...more] : []),
      "",
      `Interested in: ${chosenTitle}`,
      `Reference: ${requestReference(requestId)}`,
      `Open in the app: ${window.location.origin}/dashboard/leads/${requestId}`
    ].filter((line, i, all) => line !== "" || all[i - 1] !== "").join("\n");
  }

  async function request(event: FormEvent) {
    event.preventDefault();
    if (!grid || !chosen) return;
    setBusy(true);
    setError(null);
    try {
      const sent = await submit({
        input: buildInput(),
        grid,
        optionKey: chosen,
        // Profile identity is authoritative for signed-in users; never trust editable client fields.
        // The server takes these from the account when signed in, so only send them otherwise.
        name: hasCustomerAccount ? undefined : form.name,
        phone: hasCustomerAccount ? undefined : form.phone,
        email: hasCustomerAccount ? undefined : form.email || undefined,
        location: form.location,
        website: form.website || undefined
      });
      if (sent.claimToken) rememberPendingRequest(sent.claimToken);
      // Sent: nothing is left waiting to be carried over.
      clearPendingEstimate();
      setDone({ hasAccount: sent.hasAccount, whatsappText: sent.requestId ? whatsappMessage(sent.requestId) : null });
    } catch (e) {
      setError(message(e, t("common.genericError")));
    } finally {
      setBusy(false);
    }
  }

  const firstEmpty = hasCustomerAccount
    ? (form.location.trim() ? "" : "location")
    : !form.name.trim() ? "name" : !form.phone.trim() ? "phone" : !form.location.trim() ? "location" : "";
  const glowIf = (field: string) => (firstEmpty === field ? "guide-glow" : undefined);

  if (done) {
    return (
      <Shell>
        <h1>{t("estimate.thanks", { name: (hasCustomerAccount ? customer.account!.name : form.name).split(" ")[0] })}</h1>
        <p>
          <Rich text={t("estimate.thanksText", { phone: hasCustomerAccount ? customer.account!.phone : form.phone })} />
        </p>
        {config.whatsappNumber && done.whatsappText ? <WhatsAppSend number={config.whatsappNumber} text={done.whatsappText} /> : null}
        {done.hasAccount ? (
          <div className="next-step next-step-ok">
            <strong>{t("estimate.inAccountTitle")}</strong>
            <p>{t("estimate.inAccountText")}</p>
            <Link className="button" href="/my-requests">{t("estimate.goToRecommendations")}</Link>
          </div>
        ) : !signUpOpen ? (
          <div className="next-step">
            <strong>{t("estimate.noAccountTitle")}</strong>
            <p>{t("estimate.noAccountText")}</p>
          </div>
        ) : (
          <div className="next-step">
            <strong>{t("estimate.signUpTitle")}</strong>
            <p>{t("estimate.signUpText")}</p>
            <Link className="button" href="/sign-up?next=/my-requests">{t("estimate.signUpButton")}</Link>
            <p className="hint">
              <Rich text={t("estimate.signInInstead")} link={(label) => <Link href="/sign-in"><u>{label}</u></Link>} />
            </p>
          </div>
        )}
        {config.contactPhone ? <p className="muted">{t("common.questionsCall", { phone: config.contactPhone })}</p> : null}
        <Link className="button button-secondary" href="/">{t("estimate.backHome")}</Link>
      </Shell>
    );
  }

  return (
    <Shell>
      <span id="estimate-top" />
      <p className="eyebrow">{config.companyName.toUpperCase()}</p>
      {view === "questions" ? (
      <>
      <h1>{t("estimate.title")}</h1>
      {step === 1 ? (
        <>
          <p className="muted">{t("estimate.intro")}</p>
          <p className="hint">
            <Rich text={t("estimate.haveSolar")} link={(label) => <Link href="/estimate/upgrade"><u>{label}</u></Link>} />
          </p>
        </>
      ) : null}

      <form className="panel-form estimate-form" onSubmit={calculate} noValidate>
        <StepProgress step={step} total={STEPS} label={t("wizard.progress", { step, total: STEPS })} />
        <section className="step step-1" aria-labelledby="q1" hidden={step !== 1}>
          <h2 id="q1"><span className="step-num">1</span> {t("estimate.q1")}</h2>
          <div className="choice-row" role="radiogroup" aria-labelledby="q1">
            {CATEGORY_CHOICES.map((c) => (
              <button type="button" key={c.value} role="radio" aria-checked={category === c.value} className={`choice ${category === c.value ? "choice-on" : ""}`} onClick={() => setCategory(c.value)}>
                <strong><span aria-hidden="true">{c.emoji}</span> {t(`estimate.cat.${c.value}`)}</strong>
                <span>{t(`estimate.cat.${c.value}.hint`)}</span>
              </button>
            ))}
          </div>
        </section>

        <section className="step step-2" aria-labelledby="q2" hidden={step !== 2}>
          <h2 id="q2"><span className="step-num">2</span> {t("estimate.q2")}</h2>
          <div className="choice-row" role="radiogroup" aria-labelledby="q2">
            {GRID_CHOICES.map((c) => (
              <button type="button" key={c.value} role="radio" aria-checked={grid === c.value} className={`choice ${grid === c.value ? "choice-on" : ""}`} onClick={() => setGrid(c.value)}>
                <strong><span aria-hidden="true">{c.emoji}</span> {t(`estimate.grid.${c.value}`)}</strong>
                <span>{t(`estimate.grid.${c.value}.hint`)}</span>
              </button>
            ))}
          </div>
        </section>

        <section className="step step-3" aria-labelledby="q3" hidden={step !== 3}>
          <h2 id="q3"><span className="step-num">3</span> {t("estimate.q3")}</h2>
          {rows.length === 0 ? <p className="guide-pointer">👇 {t("estimate.q3Prompt")}</p> : null}
          <ApplianceEditor rows={rows} setRows={setRows} library={config.appliances} guide={step === 3} />
          {rows.length === 0 ? <p className="hint">{t("estimate.q3Skip")}</p> : null}
        </section>

        <section className="step step-4" aria-labelledby="q4" hidden={step !== 4}>
          <h2 id="q4"><span className="step-num">4</span> {t("estimate.q4")} <span className="step-optional">{t("common.optional")}</span></h2>
          <p className="hint">
            {t("estimate.q4Hint")}
            {rows.length > 0 ? ` ${t("estimate.q4HintOwnPrice")}` : ""} {t("estimate.q4HintStandard", { price: money(unitRate, exponent, currency) })}
          </p>
          {!smsText.trim() ? <p className="guide-pointer">👇 {t("estimate.q4Prompt")}</p> : null}
          <SmsImport
            guide={step === 4}
            text={smsText}
            setText={setSmsText}
            sms={sms}
            setMeter={setSmsMeter}
            daysByMeter={smsDaysByMeter}
            setDaysForMeter={(account, d) => setSmsDaysByMeter((prev) => ({ ...prev, [account]: d }))}
          />
        </section>

        {error ? <p className="auth-message" role="alert">{error}</p> : null}
        <StepButtons
          onBack={step > 1 ? () => goToStep(step - 1) : goBack}
          backLabel={t("wizard.back")}
          nextLabel={busy ? t("estimate.working") : step < STEPS ? t("wizard.next") : t("estimate.show")}
          busy={busy}
          // Glow once the question on screen has an answer; until then the answer area glows.
          glowNext={step <= 2 || (step === 3 && rows.length > 0) || (step === 4 && (tokensReady || (rows.length > 0 && sms.purchases.length === 0)))}
        />
      </form>
      </>
      ) : null}

      {view === "results" && result ? (
        <section id="results" className="estimate-results" aria-live="polite">
          <div className="results-head">
            <h1>{t("estimate.resultsTitle")}</h1>
            <button type="button" className="button button-secondary button-small" onClick={() => { setView("questions"); setChosen(null); goToStep(1); }}>
              ← {t("estimate.changeAnswers")}
            </button>
          </div>
          <div className="result-block result-use">
          <h2>{t("estimate.needsTitle")}</h2>
          <div className="projection-grid">
            <div className="tile tile-energy"><span className="tile-label">{t("estimate.tileEnergy")}</span><span className="tile-value">{result.summary.dailyKwh} kWh</span><span className="tile-sub">{t("estimate.perDay")}</span></div>
            {result.summary.costPerDayMinor !== null ? (
              <div className="tile tile-day"><span className="tile-label">{t("estimate.tileCost")}</span><span className="tile-value">{money(result.summary.costPerDayMinor, result.exponent, result.currency)}</span><span className="tile-sub">{t("estimate.perDay")}</span></div>
            ) : null}
            {result.summary.costPerMonthMinor !== null ? (
              <div className="tile tile-month"><span className="tile-label">{t("estimate.tileCost")}</span><span className="tile-value">{money(result.summary.costPerMonthMinor, result.exponent, result.currency)}</span><span className="tile-sub">{t("estimate.perMonth")}</span></div>
            ) : null}
            <div className="tile tile-peak"><span className="tile-label">{t("estimate.tileBusiest")}</span><span className="tile-value">{result.summary.peakW.toLocaleString("en-US")} W</span><span className="tile-sub">{t("estimate.estimated")}</span></div>
          </div>
          </div>
          {snapshot?.tokens ? (
            <p className="token-compare">
              <Rich text={t("estimate.tokensCompare", {
                kwh: snapshot.tokens.dailyKwh,
                month: money(snapshot.tokens.monthCost, result.exponent, result.currency),
                price: money(snapshot.tokens.pricePerUnit, result.exponent, result.currency)
              })} />{" "}
              {Math.abs(snapshot.tokens.dailyKwh - result.summary.dailyKwh) > Math.max(0.5, result.summary.dailyKwh * 0.3)
                ? t("estimate.tokensDiffer")
                : t("estimate.tokensMatch")}
            </p>
          ) : null}
          <div className="result-block result-options">
          <h2>{t("estimate.optionsTitle")}</h2>
          <p className="estimate-banner">{t("estimate.banner")}</p>
          <p className="price-note">
            <Rich text={t("estimate.pricesShop")} link={(label) => <Link href="/shop"><u>{label}</u></Link>} />
          </p>
          {result.options.length === 0 ? <p className="muted">{t("estimate.noOptionsYet")}</p> : null}

          <div className="option-list">
            {result.options.map((o) => (
              <article key={o.key} className={`option-card ${chosen === o.key ? "option-on" : ""}`}>
                <h3>{optionText(t, `option.${o.key}.title`, o.title)}</h3>
                <p className="muted">{optionText(t, `option.${o.key}.blurb`, o.blurb)}</p>
                <ul className="option-facts">
                  <li className={o.cutsBill ? "fact-yes" : "fact-no"}>{o.cutsBill ? t("estimate.factBill") : t("estimate.factNoBill")}</li>
                  <li className={o.key === "bill_saver" ? "fact-no" : "fact-yes"}>
                    {t("estimate.factOutage", { text: optionText(t, `option.${o.key}.outage`, o.duringOutage) })}
                  </li>
                </ul>
                <ul className="component-list">
                  {o.components.map((c) => (
                    <li key={c.role}>
                      <strong>{c.quantity} × {c.role}</strong>
                      <span>{[c.brand, c.model ?? c.name].filter(Boolean).join(" ")}{c.detail ? ` · ${c.detail}` : ""}</span>
                      {c.estimated ? <span className="pill pill-warn">{t("estimate.specsPending")}</span> : null}
                    </li>
                  ))}
                </ul>
                <p className="option-figures">
                  {o.arrayKw !== null ? <>{t("estimate.figSolar", { kw: o.arrayKw, kwh: o.solarKwhPerDay ?? 0 })}{o.coveragePercent !== null ? t("estimate.figCoverage", { percent: o.coveragePercent }) : ""}. </> : null}
                  {o.batteryKwh !== null ? <>{t("estimate.figBattery", { kwh: o.batteryKwh })} </> : null}
                  {o.offsetPerMonthMinor !== null && o.offsetPerMonthMinor > 0 ? <>{t("estimate.figOffset", { amount: money(o.offsetPerMonthMinor, result.exponent, result.currency) })}</> : null}
                </p>
                {o.notes.map((n) => <p key={n} className="hint">{n}</p>)}
                <button type="button" className="button" onClick={() => { setChosen(o.key); setError(null); setTimeout(() => document.getElementById("request")?.scrollIntoView({ behavior: "smooth" }), 50); }}>
                  {chosen === o.key ? t("estimate.selected") : t("estimate.requestThis")}
                </button>
              </article>
            ))}
          </div>

          <div className={`recommend-card ${chosen === RECOMMENDATION ? "option-on" : ""}`}>
            <h3>{result.options.length === 0 ? t("estimate.designForYou") : t("estimate.notSure")}</h3>
            <p>{t("estimate.recommendText")}</p>
            <button
              type="button"
              className="button"
              onClick={() => { setChosen(RECOMMENDATION); setError(null); setTimeout(() => document.getElementById("request")?.scrollIntoView({ behavior: "smooth" }), 50); }}
            >
              {chosen === RECOMMENDATION ? t("estimate.selected") : t("estimate.requestRecommendation")}
            </button>
          </div>
          </div>

          <div className="result-block result-report report-download">
            <button type="button" className="button button-secondary" disabled={pdfBusy || !snapshot} onClick={downloadReport}>
              {pdfBusy ? t("estimate.preparingPdf") : t("estimate.downloadPdf")}
            </button>
            <p className="hint">{t("estimate.pdfHint")}</p>
          </div>


          {chosen ? (
            <form id="request" className="panel-form" onSubmit={request}>
              <h2>{chosen === RECOMMENDATION ? t("estimate.formTitleRecommendation") : t("estimate.formTitleQuote")}</h2>
              <p className="hint">
                {chosen === RECOMMENDATION ? t("estimate.formHintRecommendation") : t("estimate.formHintQuote")}
              </p>
              {customer === undefined ? (
                <p className="hint">{t("estimate.checkingAccount")}</p>
              ) : hasCustomerAccount ? (
                <div className="signed-in-request">
                  <strong>{t("estimate.requestingAs", { name: customer.account!.name })}</strong>
                  {customer.email ? <p className="hint">{customer.email}</p> : null}
                  <p className="hint">{t("estimate.accountUsed")}</p>
                  <label htmlFor="rq-loc">{t("estimate.location")}</label>
                  <input id="rq-loc" className={glowIf("location")} required maxLength={200} autoComplete="address-level2" value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} />
                </div>
              ) : (
                <>
                  {signedInCustomer ? <p className="hint">{t("estimate.signedInNoAccount")}</p> : null}
                  <label htmlFor="rq-name">{t("estimate.yourName")}</label>
                  <input id="rq-name" className={glowIf("name")} required maxLength={100} autoComplete="name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
                  <label htmlFor="rq-phone">{t("estimate.phone")}</label>
                  <input id="rq-phone" className={glowIf("phone")} required type="tel" maxLength={20} autoComplete="tel" placeholder="+256 700 000000" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
                  {signedInCustomer ? null : (
                    <>
                      <label htmlFor="rq-email">{t("estimate.emailOptional")}</label>
                      <input id="rq-email" type="email" maxLength={120} autoComplete="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
                    </>
                  )}
                  <label htmlFor="rq-loc">{t("estimate.location")}</label>
                  <input id="rq-loc" className={glowIf("location")} required maxLength={200} autoComplete="address-level2" value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} />
                </>
              )}
              <div className="honeypot" aria-hidden="true">
                <label htmlFor="rq-site">Website</label>
                <input id="rq-site" tabIndex={-1} autoComplete="off" value={form.website} onChange={(e) => setForm({ ...form, website: e.target.value })} />
              </div>
              {error ? <p className="auth-message" role="alert">{error}</p> : null}
              <button className={`button${firstEmpty ? "" : " guide-glow"}`} type="submit" disabled={busy || customer === undefined}>{busy ? t("estimate.sending") : t("estimate.send")}</button>
            </form>
          ) : null}
        </section>
      ) : null}
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return <PublicShell>{children}</PublicShell>;
}
