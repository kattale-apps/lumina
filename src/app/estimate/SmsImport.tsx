"use client";

import { useMemo } from "react";
import { parseUedclSms, summarisePurchases, type ParsedSms, type SmsSummary } from "./uedclSms";

const fmtDate = (d: Date | null) =>
  d ? d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "—";
const ugx = (n: number) => `UGX ${Math.round(n).toLocaleString("en-US")}`;

export function useSmsSummary(text: string, days: string): { parsed: ParsedSms; summary: SmsSummary } {
  return useMemo(() => {
    const parsed = parseUedclSms(text);
    const manual = Number(days);
    return { parsed, summary: summarisePurchases(parsed.purchases, Number.isFinite(manual) && manual > 0 ? manual : null) };
  }, [text, days]);
}

export function SmsImport({
  text,
  setText,
  days,
  setDays,
  parsed,
  summary
}: {
  text: string;
  setText: (v: string) => void;
  days: string;
  setDays: (v: string) => void;
  parsed: ParsedSms;
  summary: SmsSummary;
}) {
  const { purchases } = parsed;

  async function pasteFromClipboard() {
    try {
      const clip = await navigator.clipboard.readText();
      if (clip) setText(text ? `${text}\n${clip}` : clip);
    } catch {
      document.getElementById("es-sms")?.focus();
    }
  }

  return (
    <div className="sms-import">
      <ol className="sms-steps">
        <li>Open your messages and find the ones from <strong>UEDCL</strong>.</li>
        <li>Press and hold a message, select the others, then tap <strong>Copy</strong>.</li>
        <li>Paste them below. Add more any time; repeats are ignored.</li>
      </ol>

      <div className="sms-paste-row">
        <button type="button" className="button button-secondary button-small" onClick={pasteFromClipboard}>Paste from clipboard</button>
        {text ? <button type="button" className="link-button" onClick={() => setText("")}>Clear</button> : null}
      </div>
      <label htmlFor="es-sms" className="visually-hidden">Your UEDCL messages</label>
      <textarea
        id="es-sms"
        rows={purchases.length ? 4 : 6}
        placeholder={"Dear Customer, payment of 2,000.00 for a/c 14532984490 received by UEDCL. Token no. …, Units 2.20 KWh.Thank you for paying."}
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      <p className="hint">Your messages stay on this device. We only use the amount, units and date, never the token number.</p>

      {text.trim() && purchases.length === 0 ? (
        <p className="auth-message" role="alert">
          We could not find a UEDCL payment in that text. Paste the messages exactly as UEDCL sent them, or type the numbers instead.
        </p>
      ) : null}

      {purchases.length > 0 ? (
        <div className="sms-found" aria-live="polite">
          <p className="sms-found-title">
            Found <strong>{purchases.length}</strong> payment{purchases.length === 1 ? "" : "s"}
            {parsed.duplicates ? ` (${parsed.duplicates} repeat${parsed.duplicates === 1 ? "" : "s"} ignored)` : ""}
          </p>
          <div className="table-scroll">
            <table className="estimate-table">
              <thead>
                <tr><th>Date</th><th>Paid</th><th>Units</th><th>Per unit</th></tr>
              </thead>
              <tbody>
                {purchases.map((p, i) => (
                  <tr key={`${p.tokenTail ?? "x"}-${i}`}>
                    <td>{fmtDate(p.date)}</td>
                    <td>{ugx(p.amount)}</td>
                    <td>{p.units} kWh</td>
                    <td>{ugx(p.amount / p.units)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <th>Total</th>
                  <th>{ugx(summary.totalAmount)}</th>
                  <th>{summary.totalUnits} kWh</th>
                  <th>{summary.pricePerUnit ? ugx(summary.pricePerUnit) : "—"}</th>
                </tr>
              </tfoot>
            </table>
          </div>

          {parsed.unreadable > 0 ? (
            <p className="hint">{parsed.unreadable} message{parsed.unreadable === 1 ? "" : "s"} looked like a payment but could not be read and {parsed.unreadable === 1 ? "was" : "were"} left out.</p>
          ) : null}
          {parsed.accounts.length > 1 ? (
            <p className="auth-message">
              These messages are for {parsed.accounts.length} different meters ({parsed.accounts.map((a) => `…${a.slice(-4)}`).join(", ")}).
              For one property, paste only that meter&apos;s messages.
            </p>
          ) : null}

          {summary.basis === "dates" ? (
            <p className="form-success">
              From {fmtDate(summary.firstDate)} to {fmtDate(summary.lastDate)} ({summary.days} days) you used about{" "}
              <strong>{summary.units} kWh</strong>. Your latest top-up is left out because those units are still on your meter.
            </p>
          ) : (
            <>
              <label htmlFor="es-sms-days">
                {summary.payments === 1 ? "About how many days does this top-up last?" : `About how many days does one top-up of about ${ugx(summary.typicalAmount)} (${summary.typicalUnits} kWh) last?`}
              </label>
              <div className="quick-row" role="group" aria-label="Quick pick days">
                {[["1 day", "1"], ["2 days", "2"], ["3 days", "3"], ["5 days", "5"], ["A week", "7"], ["2 weeks", "14"], ["A month", "30"]].map(([label, v]) => (
                  <button type="button" key={v} className={`chip ${days === v ? "chip-on" : ""}`} onClick={() => setDays(v)}>{label}</button>
                ))}
              </div>
              <input id="es-sms-days" required inputMode="decimal" type="number" min="0.5" max="366" step="any" placeholder="Days" value={days} onChange={(e) => setDays(e.target.value)} />
              <p className="hint">Think of a normal top-up: how long until the meter runs low and you buy again?</p>
            </>
          )}

          {summary.projection ? (
            <div className="sms-projection" aria-live="polite">
              <p className="sms-projection-title">
                Your projected electricity spend
                <span>
                  {summary.payments === 1 ? "from 1 payment" : `from ${summary.payments} payments`} at {ugx(summary.pricePerUnit ?? 0)} per unit
                </span>
              </p>
              <div className="stat-grid">
                {([["Per day", "day"], ["Per week", "week"], ["Per month", "month"], ["Per year", "year"]] as const).map(([label, key]) => (
                  <div className="stat" key={key}>
                    <span className="stat-value">{ugx(summary.projection!.cost[key])}</span>
                    <span className="stat-label">{label} · {summary.projection!.kwh[key]} kWh</span>
                  </div>
                ))}
              </div>
              <p className="hint">
                An estimate that assumes you keep using power the same way.
                {summary.payments < 3 ? " Paste a few more payments for a steadier figure." : ""}
              </p>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
