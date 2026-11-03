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

type Grid = "none" | "unreliable" | "reliable";
/** Matches RECOMMENDATION_KEY on the server: ask a technician to design a system. */
const RECOMMENDATION = "recommendation";
type Mode = "bill" | "appliances";
type Category = "residential" | "commercial_small" | "commercial_medium" | "industrial";

const CATEGORY_CHOICES: { value: Category; label: string; hint: string }[] = [
  { value: "residential", label: "Home (residential)", hint: "A house or apartment." },
  { value: "commercial_small", label: "Small business", hint: "Shop, salon, small office." },
  { value: "commercial_medium", label: "Medium business", hint: "Hotel, clinic, school, large office." },
  { value: "industrial", label: "Industrial", hint: "Factory, workshop, processing plant." }
];

const GRID_CHOICES: { value: Grid; label: string; hint: string }[] = [
  { value: "reliable", label: "Yes, mostly reliable", hint: "Power is on most of the time." },
  { value: "unreliable", label: "Yes, but it often goes off", hint: "Frequent outages or load-shedding." },
  { value: "none", label: "No grid power", hint: "Not connected to UEDCL." }
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
  const submit = useMutation(api.estimator.submitRequest);

  const [category, setCategory] = useState<Category>("residential");
  const [grid, setGrid] = useState<Grid | null>(null);
  const [mode, setMode] = useState<Mode>("bill");
  const [units, setUnits] = useState("");
  const [days, setDays] = useState("30");
  const [amount, setAmount] = useState("");
  const [rate, setRate] = useState("");
  const [rows, setRows] = useState<ApplianceRow[]>([]);
  // Bill mode: paste UEDCL messages (default) or type the numbers.
  const [billSource, setBillSource] = useState<"sms" | "manual">("sms");
  const [smsText, setSmsText] = useState("");
  const [smsMeter, setSmsMeter] = useState<string | null>(null);
  const [smsDaysByMeter, setSmsDaysByMeter] = useState<Record<string, string>>({});
  const sms = useSmsSummary(smsText, smsMeter, smsDaysByMeter);
  // What the shown results were calculated from, so the PDF matches the screen.
  const [snapshot, setSnapshot] = useState<{ lines: ReportLine[]; category: Category } | null>(null);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<FunctionReturnType<typeof api.estimator.recommend> | null>(null);
  const [chosen, setChosen] = useState<string | null>(null);
  const [form, setForm] = useState({ name: "", phone: "", email: "", location: "", website: "" });
  const [done, setDone] = useState(false);

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

  function buildInput() {
    if (mode === "bill" && billSource === "sms") {
      return {
        mode: "bill" as const,
        category,
        units: sms.summary.units,
        days: sms.summary.days ?? 0,
        amount: sms.summary.amount > 0 ? sms.summary.amount : undefined
      };
    }
    if (mode === "bill") {
      return {
        mode: "bill" as const,
        category,
        units: Number(units),
        days: Number(days),
        amount: amount.trim() ? Number(amount) : undefined
      };
    }
    return {
      mode: "appliances" as const,
      category,
      items: rowsToItems(rows),
      ratePerKwh: rate.trim() ? Number(rate) : undefined
    };
  }

  async function calculate(event: FormEvent) {
    event.preventDefault();
    if (!grid) {
      setError("Tell us about your grid power first.");
      return;
    }
    if (mode === "bill" && billSource === "sms") {
      if (sms.purchases.length === 0) {
        setError("Paste at least one UEDCL payment message, or choose to type the numbers.");
        return;
      }
      if (!sms.summary.days) {
        setError("Tell us about how many days one top-up lasts.");
        return;
      }
    }
    if (mode === "appliances" && rows.length === 0) {
      setError("Add at least one appliance.");
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
          mode === "appliances"
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
            : []
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
      await submit({
        input: buildInput(),
        grid,
        optionKey: chosen,
        name: form.name,
        phone: form.phone,
        email: form.email || undefined,
        location: form.location,
        website: form.website || undefined
      });
      setDone(true);
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
          We have your request. A {config.companyName} adviser will contact you on{" "}
          <strong>{form.phone}</strong> with a quotation that includes prices.
        </p>
        {config.contactPhone ? <p className="muted">Questions? Call {config.contactPhone}.</p> : null}
        <Link className="button" href="/">Back to home</Link>
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
        <h2>1. What do you need power for?</h2>
        <div className="choice-row" role="radiogroup" aria-label="Customer type">
          {CATEGORY_CHOICES.map((c) => (
            <button type="button" key={c.value} role="radio" aria-checked={category === c.value} className={`choice ${category === c.value ? "choice-on" : ""}`} onClick={() => setCategory(c.value)}>
              <strong>{c.label}</strong>
              <span>{c.hint}</span>
            </button>
          ))}
        </div>

        <h2>2. Your grid power</h2>
        <div className="choice-row" role="radiogroup" aria-label="Grid power">
          {GRID_CHOICES.map((c) => (
            <button
              type="button"
              key={c.value}
              role="radio"
              aria-checked={grid === c.value}
              className={`choice ${grid === c.value ? "choice-on" : ""}`}
              onClick={() => setGrid(c.value)}
            >
              <strong>{c.label}</strong>
              <span>{c.hint}</span>
            </button>
          ))}
        </div>

        <h2>3. How would you like to tell us?</h2>
        <div className="choice-row" role="radiogroup" aria-label="Input method">
          <button type="button" role="radio" aria-checked={mode === "bill"} className={`choice ${mode === "bill" ? "choice-on" : ""}`} onClick={() => setMode("bill")}>
            <strong>From my UEDCL bill or token</strong>
            <span>Quickest. Paste your UEDCL token messages, or type units and what you paid.</span>
          </button>
          <button type="button" role="radio" aria-checked={mode === "appliances"} className={`choice ${mode === "appliances" ? "choice-on" : ""}`} onClick={() => setMode("appliances")}>
            <strong>From my appliances</strong>
            <span>Pick what you use and for how long.</span>
          </button>
        </div>

        {mode === "bill" ? (
          <div className="segmented" role="radiogroup" aria-label="How to give your bill details">
            <button type="button" role="radio" aria-checked={billSource === "sms"} className={billSource === "sms" ? "segmented-on" : ""} onClick={() => setBillSource("sms")}>Paste my UEDCL messages</button>
            <button type="button" role="radio" aria-checked={billSource === "manual"} className={billSource === "manual" ? "segmented-on" : ""} onClick={() => setBillSource("manual")}>Type the numbers</button>
          </div>
        ) : null}

        {mode === "bill" && billSource === "sms" ? (
          <SmsImport
            text={smsText}
            setText={setSmsText}
            sms={sms}
            setMeter={setSmsMeter}
            daysByMeter={smsDaysByMeter}
            setDaysForMeter={(account, d) => setSmsDaysByMeter((prev) => ({ ...prev, [account]: d }))}
          />
        ) : mode === "bill" ? (
          <>
            <label htmlFor="es-units">Units (kWh) you bought or used</label>
            <input id="es-units" required inputMode="decimal" type="number" min="0.1" step="any" placeholder="e.g. 150" value={units} onChange={(e) => setUnits(e.target.value)} />
            <label htmlFor="es-days">Over how many days?</label>
            <div className="quick-row" role="group" aria-label="Quick pick days">
              {[["A week", "7"], ["2 weeks", "14"], ["A month", "30"]].map(([label, v]) => (
                <button type="button" key={v} className={`chip ${days === v ? "chip-on" : ""}`} onClick={() => setDays(v)}>{label}</button>
              ))}
            </div>
            <input id="es-days" required inputMode="numeric" type="number" min="1" max="366" value={days} onChange={(e) => setDays(e.target.value)} />
            <p className="hint">Tap a quick pick or type your own number. For a token, count how many days it lasted.</p>
            <label htmlFor="es-amount">What you paid for them ({currency}) — optional</label>
            <input id="es-amount" inputMode="numeric" type="number" min="1" step="any" placeholder="e.g. 120000" value={amount} onChange={(e) => setAmount(e.target.value)} />
            <p className="hint">If you leave this blank we use the standard rate for your customer type: {money(unitRate, exponent, currency)} per unit.</p>
          </>
        ) : (
          <>
            <ApplianceEditor rows={rows} setRows={setRows} library={config.appliances} />
            <label htmlFor="es-rate">Your price per unit ({currency}/kWh) — optional</label>
            <input id="es-rate" inputMode="numeric" type="number" min="1" step="any" placeholder={String(unitRate / 10 ** exponent)} value={rate} onChange={(e) => setRate(e.target.value)} />
            <p className="hint">Leave blank to use the standard rate for your customer type: {money(unitRate, exponent, currency)} per unit.</p>
          </>
        )}

        {error && !result ? <p className="auth-message" role="alert">{error}</p> : null}
        <button className="button" type="submit" disabled={busy}>{busy && !chosen ? "Working it out…" : "Show my power use and options"}</button>
      </form>

      {result ? (
        <section id="results" className="estimate-results" aria-live="polite">
          <div className="result-block result-use">
          <h2>What you use today</h2>
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
              <label htmlFor="rq-name">Your name</label>
              <input id="rq-name" required maxLength={100} autoComplete="name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              <label htmlFor="rq-phone">Phone</label>
              <input id="rq-phone" required type="tel" maxLength={20} autoComplete="tel" placeholder="+256 700 000000" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
              <label htmlFor="rq-email">Email (optional)</label>
              <input id="rq-email" type="email" maxLength={120} autoComplete="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
              <label htmlFor="rq-loc">Where is the property? (town / area)</label>
              <input id="rq-loc" required maxLength={200} autoComplete="address-level2" value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} />
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
