"use client";

import Link from "next/link";
import { useMemo, useState, type FormEvent } from "react";
import { useConvex, useMutation, useQuery } from "convex/react";
import type { FunctionArgs, FunctionReturnType } from "convex/server";
import { ConvexError } from "convex/values";
import { api } from "../../../convex/_generated/api";

type Grid = "none" | "unreliable" | "reliable";
type Mode = "bill" | "appliances";
type Selected = Record<string, { quantity: string; hours: string }>;

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

  const [grid, setGrid] = useState<Grid | null>(null);
  const [mode, setMode] = useState<Mode>("bill");
  const [units, setUnits] = useState("");
  const [days, setDays] = useState("30");
  const [amount, setAmount] = useState("");
  const [rate, setRate] = useState("");
  const [selected, setSelected] = useState<Selected>({});
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<FunctionReturnType<typeof api.estimator.recommend> | null>(null);
  const [chosen, setChosen] = useState<string | null>(null);
  const [form, setForm] = useState({ name: "", phone: "", email: "", location: "", website: "" });
  const [done, setDone] = useState(false);

  const grouped = useMemo(() => {
    if (!config || !config.enabled) return [];
    const term = search.trim().toLowerCase();
    const map = new Map<string, typeof config.appliances>();
    for (const a of config.appliances) {
      if (term && !a.name.toLowerCase().includes(term)) continue;
      map.set(a.category, [...(map.get(a.category) ?? []), a]);
    }
    return [...map.entries()];
  }, [config, search]);

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
  const currency = config.currency;

  function buildInput() {
    if (mode === "bill") {
      return {
        mode: "bill" as const,
        units: Number(units),
        days: Number(days),
        amount: amount.trim() ? Number(amount) : undefined
      };
    }
    return {
      mode: "appliances" as const,
      items: Object.entries(selected).map(([name, v]) => ({
        name,
        quantity: Number(v.quantity),
        hoursPerDay: Number(v.hours)
      })),
      ratePerKwh: rate.trim() ? Number(rate) : undefined
    };
  }

  async function calculate(event: FormEvent) {
    event.preventDefault();
    if (!grid) {
      setError("Tell us about your grid power first.");
      return;
    }
    setBusy(true);
    setError(null);
    setChosen(null);
    try {
      const response = await runQuery({ input: buildInput(), grid });
      setResult(response);
      setTimeout(() => document.getElementById("results")?.scrollIntoView({ behavior: "smooth" }), 50);
    } catch (e) {
      setResult(null);
      setError(message(e));
    } finally {
      setBusy(false);
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
        <h2>1. Your grid power</h2>
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

        <h2>2. How would you like to tell us?</h2>
        <div className="choice-row" role="radiogroup" aria-label="Input method">
          <button type="button" role="radio" aria-checked={mode === "bill"} className={`choice ${mode === "bill" ? "choice-on" : ""}`} onClick={() => setMode("bill")}>
            <strong>From my UEDCL bill or token</strong>
            <span>Quickest. Use units bought and what you paid.</span>
          </button>
          <button type="button" role="radio" aria-checked={mode === "appliances"} className={`choice ${mode === "appliances" ? "choice-on" : ""}`} onClick={() => setMode("appliances")}>
            <strong>From my appliances</strong>
            <span>Pick what you use and for how long.</span>
          </button>
        </div>

        {mode === "bill" ? (
          <>
            <label htmlFor="es-units">Units (kWh) you bought or used</label>
            <input id="es-units" required inputMode="decimal" type="number" min="0.1" step="any" placeholder="e.g. 150" value={units} onChange={(e) => setUnits(e.target.value)} />
            <label htmlFor="es-days">Over how many days?</label>
            <input id="es-days" required inputMode="numeric" type="number" min="1" max="366" value={days} onChange={(e) => setDays(e.target.value)} />
            <p className="hint">For a monthly bill use 30. For a token, count how many days it lasted.</p>
            <label htmlFor="es-amount">What you paid for them ({currency}) — optional</label>
            <input id="es-amount" inputMode="numeric" type="number" min="1" step="any" placeholder="e.g. 120000" value={amount} onChange={(e) => setAmount(e.target.value)} />
            <p className="hint">If you leave this blank we use {money(config.tariffMinorPerKwh, exponent, currency)} per unit.</p>
          </>
        ) : (
          <>
            <label htmlFor="es-search">Find an appliance</label>
            <input id="es-search" type="search" placeholder="e.g. fridge, TV, iron" value={search} onChange={(e) => setSearch(e.target.value)} />
            <div className="appliance-picker">
              {grouped.length === 0 ? <p className="hint">No appliance matches.</p> : null}
              {grouped.map(([category, items]) => (
                <details key={category} open={search.trim().length > 0}>
                  <summary className="link-summary">{category}</summary>
                  <div className="appliance-grid">
                    {items.map((a) => (
                      <button
                        type="button"
                        key={a.name}
                        className={`chip ${selected[a.name] ? "chip-on" : ""}`}
                        onClick={() =>
                          setSelected((prev) => {
                            const next = { ...prev };
                            if (next[a.name]) delete next[a.name];
                            else next[a.name] = { quantity: "1", hours: String(a.defaultHours) };
                            return next;
                          })
                        }
                      >
                        {selected[a.name] ? "✓ " : "+ "}{a.name} <span className="muted">({a.powerW} W)</span>
                      </button>
                    ))}
                  </div>
                </details>
              ))}
            </div>
            {Object.keys(selected).length > 0 ? (
              <div className="table-scroll">
                <table className="estimate-table">
                  <thead><tr><th>Appliance</th><th>How many</th><th>Hours a day</th></tr></thead>
                  <tbody>
                    {Object.entries(selected).map(([name, v]) => (
                      <tr key={name}>
                        <td>{name}</td>
                        <td>
                          <input aria-label={`${name} quantity`} type="number" inputMode="numeric" min="1" max="100" value={v.quantity}
                            onChange={(e) => setSelected((p) => ({ ...p, [name]: { ...p[name], quantity: e.target.value } }))} />
                        </td>
                        <td>
                          <input aria-label={`${name} hours per day`} type="number" inputMode="decimal" min="0.25" max="24" step="any" value={v.hours}
                            onChange={(e) => setSelected((p) => ({ ...p, [name]: { ...p[name], hours: e.target.value } }))} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="hint">Tap the appliances you use. Typical hours are filled in; change them to match your home.</p>
            )}
            <label htmlFor="es-rate">Your price per unit ({currency}/kWh) — optional</label>
            <input id="es-rate" inputMode="numeric" type="number" min="1" step="any" placeholder={String(config.tariffMinorPerKwh / 10 ** exponent)} value={rate} onChange={(e) => setRate(e.target.value)} />
            <p className="hint">Leave blank to use {money(config.tariffMinorPerKwh, exponent, currency)} per unit.</p>
          </>
        )}

        {error && !result ? <p className="auth-message" role="alert">{error}</p> : null}
        <button className="button" type="submit" disabled={busy}>{busy && !chosen ? "Working it out…" : "Show my power use and options"}</button>
      </form>

      {result ? (
        <section id="results" className="estimate-results" aria-live="polite">
          <h2>What you use today</h2>
          <div className="stat-grid">
            <div className="stat"><span className="stat-value">{result.summary.dailyKwh}</span><span className="stat-label">kWh per day</span></div>
            {result.summary.costPerDayMinor !== null ? (
              <div className="stat"><span className="stat-value">{money(result.summary.costPerDayMinor, result.exponent, result.currency)}</span><span className="stat-label">per day</span></div>
            ) : null}
            {result.summary.costPerMonthMinor !== null ? (
              <div className="stat"><span className="stat-value">{money(result.summary.costPerMonthMinor, result.exponent, result.currency)}</span><span className="stat-label">per month</span></div>
            ) : null}
            <div className="stat"><span className="stat-value">{result.summary.peakW} W</span><span className="stat-label">busiest moment (estimated)</span></div>
          </div>

          <h2>Solar options for you</h2>
          <p className="estimate-banner">UNVERIFIED — FOR ILLUSTRATION ONLY. A technician checks every design before it is final. Prices are shared when you request a quote.</p>

          {result.options.length === 0 ? (
            <p className="muted">We cannot show options for these numbers yet. Request a call and our team will help.</p>
          ) : null}
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

          {chosen ? (
            <form id="request" className="panel-form" onSubmit={request}>
              <h2>Request your quote</h2>
              <p className="hint">We will contact you with a quotation that includes prices. No payment is needed now.</p>
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
    <div className="shell">
      <header className="topbar">
        <Link className="brand" href="/" aria-label="Solar Switch home">
          <span className="brand-mark">S</span>
          <span>SOLAR SWITCH</span>
        </Link>
        <Link className="button button-small button-secondary" href="/sign-in">Staff sign in</Link>
      </header>
      <main className="workspace">{children}</main>
    </div>
  );
}
