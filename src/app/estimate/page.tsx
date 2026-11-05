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

type Grid = "none" | "unreliable" | "reliable";
/** Matches RECOMMENDATION_KEY on the server: ask a technician to design a system. */
const RECOMMENDATION = "recommendation";
type Category = "residential" | "commercial_small" | "commercial_medium" | "industrial";

const CATEGORY_CHOICES: { value: Category; label: string; hint: string; emoji: string }[] = [
  { value: "residential", label: "Home", hint: "A house or apartment.", emoji: "🏠" },
  { value: "commercial_small", label: "Small business", hint: "Shop, salon, small office.", emoji: "🏪" },
  { value: "commercial_medium", label: "Medium business", hint: "Hotel, clinic, school, large office.", emoji: "🏨" },
  { value: "industrial", label: "Industry", hint: "Factory, workshop, processing plant.", emoji: "🏭" }
];

const GRID_CHOICES: { value: Grid; label: string; hint: string; emoji: string }[] = [
  { value: "reliable", label: "Mostly reliable", hint: "UEDCL power is on most of the time.", emoji: "✅" },
  { value: "unreliable", label: "Often goes off", hint: "Frequent outages or load-shedding.", emoji: "⚠️" },
  { value: "none", label: "No grid power", hint: "Not connected to UEDCL.", emoji: "🚫" }
];

function message(error: unknown) {
  if (error instanceof ConvexError && typeof error.data === "string") return error.data;
  return "Something went wrong. Check your connection and try again.";
}

function money(minor: number, exponent: number, currency: string) {
  const value = minor / 10 ** exponent;
  return `${currency} ${value.toLocaleString("en-US", { maximumFractionDigits: exponent })}`;
}

export default function EstimatePage() {
  if (!process.env.NEXT_PUBLIC_CONVEX_URL) {
    return (
      <main className="auth-shell">
        <section className="auth-card">
          <h1>Power check unavailable</h1>
          <p>This page is not connected yet. Please try again later.</p>
        </section>
      </main>
    );
  }
  return <Estimator />;
}

function Estimator() {
  const convex = useConvex();
  const config = useQuery(api.estimator.publicConfig, {});
  const viewer = useQuery(api.users.viewerContext, {});
  const submit = useMutation(api.estimator.submitRequest);

  const [category, setCategory] = useState<Category>("residential");
  const [grid, setGrid] = useState<Grid | null>(null);
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
  const signedInProfile = viewer && viewer.state !== "signed_out" && viewer.state !== "profile_missing" && viewer.state !== "disabled" ? viewer.profile : null;
  // After sending: whether the request already went to a signed-in customer account.
  const [done, setDone] = useState<null | { hasAccount: boolean }>(null);

  function runQuery(input: FunctionArgs<typeof api.estimator.recommend>) {
    return convex.query(api.estimator.recommend, input);
  }

  if (config === undefined) {
    return <Shell><p className="muted">Loading…</p></Shell>;
  }
  if (!config.enabled) {
    return (
      <Shell>
        <h1>Power check is not open yet</h1>
        <p className="muted">Please check back soon, or contact us directly.</p>
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

  async function calculate(event: FormEvent) {
    event.preventDefault();
    if (!grid) {
      setError("Tell us about your grid power first.");
      return;
    }
    if (sms.purchases.length > 0 && !sms.summary.days) {
      setError("In step 4, tell us about how many days one top-up lasts.");
      return;
    }
    if (rows.length === 0 && !tokensReady) {
      setError("Add the appliances you use in step 3, or paste your UEDCL messages in step 4.");
      return;
    }
    setBusy(true);
    setError(null);
    setChosen(null);
    try {
      const response = await runQuery({ input: buildInput(), grid });
      setResult(response);
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
      setTimeout(() => document.getElementById("results")?.scrollIntoView({ behavior: "smooth" }), 50);
    } catch (e) {
      setResult(null);
      setSnapshot(null);
      setError(message(e));
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
        customerType: CATEGORY_CHOICES.find((c) => c.value === snapshot.category)?.label ?? "",
        currency: result.currency,
        exponent: result.exponent,
        rateMinorPerKwh: result.summary.ratePerKwhMinor,
        dailyKwh: result.summary.dailyKwh,
        peakW: result.summary.peakW,
        basis: result.summary.basis,
        lines: snapshot.lines
      });
      await savePdf(bytes, `power-usage-estimate-${new Date().toISOString().slice(0, 10)}.pdf`, "Power usage estimate");
    } catch (e) {
      setError(e instanceof AppUpdateNeeded ? e.message : "We could not create the PDF. Please try again.");
    } finally {
      setPdfBusy(false);
    }
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
        name: signedInProfile?.displayName ?? form.name,
        phone: signedInProfile ? "" : form.phone,
        email: signedInProfile?.email ?? (form.email || undefined),
        location: form.location,
        website: form.website || undefined
      });
      if (sent.claimToken) rememberPendingRequest(sent.claimToken);
      setDone({ hasAccount: sent.hasAccount });
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <Shell>
        <h1>Thank you, {form.name.split(" ")[0]}</h1>
        <p>
          We have your request. A technician will review your power needs and prepare a recommendation with
          options, photos and prices. We may call you on <strong>{form.phone}</strong> to check a few details.
        </p>
        {done.hasAccount ? (
          <div className="next-step next-step-ok">
            <strong>✅ It will appear in your account</strong>
            <p>Open My recommendations to see it as soon as it is ready.</p>
            <Link className="button" href="/my-requests">Go to My recommendations</Link>
          </div>
        ) : (
          <div className="next-step">
            <strong>📲 Sign up to get your recommendation in the app</strong>
            <p>
              Create a free account on this phone to receive your recommendation with options, photos and prices, and
              choose the one you want. It takes a minute.
            </p>
            <Link className="button" href="/sign-up?next=/my-requests">Create my free account</Link>
            <p className="hint">
              Already have an account? <Link href="/sign-in"><u>Sign in</u></Link> on this phone and your request is added to it.
            </p>
          </div>
        )}
        {config.contactPhone ? <p className="muted">Questions? Call {config.contactPhone}.</p> : null}
        <Link className="button button-secondary" href="/">Back to home</Link>
      </Shell>
    );
  }

  return (
    <Shell>
      <p className="eyebrow">{config.companyName.toUpperCase()}</p>
      <h1>How much power do you use?</h1>
      <p className="muted">
        Answer a few questions to see what you use and spend today, and the solar options that could fit.
        It takes about two minutes.
      </p>

      <form className="panel-form estimate-form" onSubmit={calculate}>
        <section className="step step-1" aria-labelledby="q1">
          <h2 id="q1"><span className="step-num">1</span> Where do you need power?</h2>
          <div className="choice-row" role="radiogroup" aria-labelledby="q1">
            {CATEGORY_CHOICES.map((c) => (
              <button type="button" key={c.value} role="radio" aria-checked={category === c.value} className={`choice ${category === c.value ? "choice-on" : ""}`} onClick={() => setCategory(c.value)}>
                <strong><span aria-hidden="true">{c.emoji}</span> {c.label}</strong>
                <span>{c.hint}</span>
              </button>
            ))}
          </div>
        </section>

        <section className="step step-2" aria-labelledby="q2">
          <h2 id="q2"><span className="step-num">2</span> How reliable is electricity?</h2>
          <div className="choice-row" role="radiogroup" aria-labelledby="q2">
            {GRID_CHOICES.map((c) => (
              <button type="button" key={c.value} role="radio" aria-checked={grid === c.value} className={`choice ${grid === c.value ? "choice-on" : ""}`} onClick={() => setGrid(c.value)}>
                <strong><span aria-hidden="true">{c.emoji}</span> {c.label}</strong>
                <span>{c.hint}</span>
              </button>
            ))}
          </div>
        </section>

        <section className="step step-3" aria-labelledby="q3">
          <h2 id="q3"><span className="step-num">3</span> Which appliances need power?</h2>
          <ApplianceEditor rows={rows} setRows={setRows} library={config.appliances} />
        </section>

        <section className="step step-4" aria-labelledby="q4">
          <h2 id="q4"><span className="step-num">4</span> Cost of your UEDCL tokens <span className="step-optional">Optional</span></h2>
          <p className="hint">
            Paste your UEDCL token messages and we work out the units you use and what you really pay per unit.
            {rows.length > 0 ? " Your appliance costs will then use your own price." : ""} Skip this to use the standard rate of{" "}
            {money(unitRate, exponent, currency)} per unit.
          </p>
          <SmsImport
            text={smsText}
            setText={setSmsText}
            sms={sms}
            setMeter={setSmsMeter}
            daysByMeter={smsDaysByMeter}
            setDaysForMeter={(account, d) => setSmsDaysByMeter((prev) => ({ ...prev, [account]: d }))}
          />
        </section>

        {error && !result ? <p className="auth-message" role="alert">{error}</p> : null}
        <button className="button" type="submit" disabled={busy}>{busy && !chosen ? "Working it out…" : "Show my power needs"}</button>
      </form>

      {result ? (
        <section id="results" className="estimate-results" aria-live="polite">
          <div className="result-block result-use">
          <h2>Your power needs</h2>
          <div className="projection-grid">
            <div className="tile tile-energy"><span className="tile-label">Energy</span><span className="tile-value">{result.summary.dailyKwh} kWh</span><span className="tile-sub">per day</span></div>
            {result.summary.costPerDayMinor !== null ? (
              <div className="tile tile-day"><span className="tile-label">Cost</span><span className="tile-value">{money(result.summary.costPerDayMinor, result.exponent, result.currency)}</span><span className="tile-sub">per day</span></div>
            ) : null}
            {result.summary.costPerMonthMinor !== null ? (
              <div className="tile tile-month"><span className="tile-label">Cost</span><span className="tile-value">{money(result.summary.costPerMonthMinor, result.exponent, result.currency)}</span><span className="tile-sub">per month</span></div>
            ) : null}
            <div className="tile tile-peak"><span className="tile-label">Busiest moment</span><span className="tile-value">{result.summary.peakW.toLocaleString("en-US")} W</span><span className="tile-sub">estimated</span></div>
          </div>
          </div>
          {snapshot?.tokens ? (
            <p className="token-compare">
              Your UEDCL payments show about <strong>{snapshot.tokens.dailyKwh} kWh a day</strong> (about{" "}
              {money(snapshot.tokens.monthCost, result.exponent, result.currency)} a month) at{" "}
              {money(snapshot.tokens.pricePerUnit, result.exponent, result.currency)} per unit.
              {Math.abs(snapshot.tokens.dailyKwh - result.summary.dailyKwh) > Math.max(0.5, result.summary.dailyKwh * 0.3)
                ? " That differs from your appliance list: check the hours, or whether some of your power comes from elsewhere."
                : " That matches your appliance list well."}
            </p>
          ) : null}
          <div className="result-block result-report report-download">
            <button type="button" className="button button-secondary" disabled={pdfBusy || !snapshot} onClick={downloadReport}>
              {pdfBusy ? "Preparing PDF…" : "Download my usage report (PDF)"}
            </button>
            <p className="hint">Watts and running cost per hour, day, week, month and year. It is an estimate, not a bill.</p>
          </div>

          <div className="result-block result-options">
          <h2>Solar options for you</h2>
          <p className="estimate-banner">UNVERIFIED — FOR ILLUSTRATION ONLY. A technician checks every design before it is final. Prices are shared when you request a quote.</p>

          <div className="option-list">
            {result.options.map((o) => (
              <article key={o.key} className={`option-card ${chosen === o.key ? "option-on" : ""}`}>
                <h3>{o.title}</h3>
                <p className="muted">{o.blurb}</p>
                <ul className="component-list">
                  {o.components.map((c) => (
                    <li key={c.role}>
                      <strong>{c.quantity} × {c.role}</strong>
                      <span>{[c.brand, c.model ?? c.name].filter(Boolean).join(" ")}{c.detail ? ` · ${c.detail}` : ""}</span>
                    </li>
                  ))}
                </ul>
                <p className="option-figures">
                  {o.arrayKw !== null ? <>Solar {o.arrayKw} kW · makes about {o.solarKwhPerDay} kWh a day{o.coveragePercent !== null ? ` · covers about ${o.coveragePercent}% of your use` : ""}. </> : null}
                  {o.batteryKwh !== null ? <>Battery {o.batteryKwh} kWh. </> : null}
                  {o.offsetPerMonthMinor !== null && o.offsetPerMonthMinor > 0 ? <>Could offset about {money(o.offsetPerMonthMinor, result.exponent, result.currency)} of your monthly electricity cost.</> : null}
                </p>
                {o.notes.map((n) => <p key={n} className="hint">{n}</p>)}
                <button type="button" className="button" onClick={() => { setChosen(o.key); setError(null); setTimeout(() => document.getElementById("request")?.scrollIntoView({ behavior: "smooth" }), 50); }}>
                  {chosen === o.key ? "Selected" : "Request a quote for this"}
                </button>
              </article>
            ))}
          </div>

          <div className={`recommend-card ${chosen === RECOMMENDATION ? "option-on" : ""}`}>
            <h3>{result.options.length === 0 ? "Get a system designed for you" : "Not sure which fits?"}</h3>
            <p>
              Send us your numbers and a technician will recommend the right system for your needs and prepare a quotation.
              It is free and there is no obligation.
            </p>
            <button
              type="button"
              className="button"
              onClick={() => { setChosen(RECOMMENDATION); setError(null); setTimeout(() => document.getElementById("request")?.scrollIntoView({ behavior: "smooth" }), 50); }}
            >
              {chosen === RECOMMENDATION ? "Selected" : "Request a system recommendation and quotation"}
            </button>
          </div>
          </div>

          {chosen ? (
            <form id="request" className="panel-form" onSubmit={request}>
              <h2>{chosen === RECOMMENDATION ? "Request a recommendation and quotation" : "Request your quote"}</h2>
              <p className="hint">
                {chosen === RECOMMENDATION
                  ? "A technician will look at your numbers, recommend a system and send a quotation with prices. No payment is needed now."
                  : "We will contact you with a quotation that includes prices. No payment is needed now."}
              </p>
              {signedInProfile ? (
                <div className="signed-in-request">
                  <strong>Requesting as {signedInProfile.displayName}</strong>
                  {signedInProfile.email ? <p className="hint">{signedInProfile.email}</p> : null}
                  <p className="hint">Your account details will be used. You only need to provide the property's location.</p>
                  <label htmlFor="rq-loc">Where is the property? (town / area)</label>
                  <input id="rq-loc" required maxLength={200} autoComplete="address-level2" value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} />
                </div>
              ) : (
                <>
                  <label htmlFor="rq-name">Your name</label>
                  <input id="rq-name" required maxLength={100} autoComplete="name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
                  <label htmlFor="rq-phone">Phone</label>
                  <input id="rq-phone" required type="tel" maxLength={20} autoComplete="tel" placeholder="+256 700 000000" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
                  <label htmlFor="rq-email">Email (optional)</label>
                  <input id="rq-email" type="email" maxLength={120} autoComplete="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
                  <label htmlFor="rq-loc">Where is the property? (town / area)</label>
                  <input id="rq-loc" required maxLength={200} autoComplete="address-level2" value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} />
                </>
              )}
              <div className="honeypot" aria-hidden="true">
                <label htmlFor="rq-site">Website</label>
                <input id="rq-site" tabIndex={-1} autoComplete="off" value={form.website} onChange={(e) => setForm({ ...form, website: e.target.value })} />
              </div>
              {error ? <p className="auth-message" role="alert">{error}</p> : null}
              <button className="button" type="submit" disabled={busy}>{busy ? "Sending…" : "Send my request"}</button>
            </form>
          ) : null}
        </section>
      ) : null}
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="public-bg">
      <div className="shell">
        <header className="topbar">
          <Link className="brand" href="/" aria-label="Solar Switch home">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img className="brand-logo" src="/icons/icon-192.png" alt="" width={38} height={38} />
            <span>SOLAR SWITCH</span>
          </Link>
          <Link className="button button-small button-secondary" href="/sign-in">Staff sign in</Link>
        </header>
        <main className="workspace">{children}</main>
      </div>
    </div>
  );
}
