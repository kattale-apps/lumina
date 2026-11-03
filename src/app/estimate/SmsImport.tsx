"use client";

import { useEffect, useMemo, useState } from "react";
import { parseUedclSms, summarisePurchases, type ParsedSms, type Purchase, type SmsSummary } from "./uedclSms";

const PAGE_SIZE = 5;

const fmtDate = (d: Date | null) =>
  d ? d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : null;
const ugx = (n: number) => `UGX ${Math.round(n).toLocaleString("en-US")}`;
const meterLabel = (account: string) => `Meter …⁠${account.slice(-4)}`;

export type SmsState = {
  parsed: ParsedSms;
  /** The meter being reported on; null when nothing was found. */
  meter: string | null;
  purchases: Purchase[];
  summary: SmsSummary;
  /** One report per meter, for the meter tabs. */
  meters: { account: string; payments: number; summary: SmsSummary }[];
};

const toDays = (v: string | undefined) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
};

/** Parses the pasted text and reports on one meter at a time. */
export function useSmsSummary(text: string, meter: string | null, daysByMeter: Record<string, string>): SmsState {
  return useMemo(() => {
    const parsed = parseUedclSms(text);
    const meters = parsed.accounts
      .map((account) => {
        const own = parsed.purchases.filter((p) => p.account === account);
        return { account, payments: own.length, summary: summarisePurchases(own, toDays(daysByMeter[account])) };
      })
      // The meter with the most payments first: usually the customer's own.
      .sort((a, b) => b.payments - a.payments);
    const chosen = meters.find((m) => m.account === meter) ?? meters[0];
    const purchases = chosen ? parsed.purchases.filter((p) => p.account === chosen.account) : [];
    return {
      parsed,
      meter: chosen?.account ?? null,
      purchases,
      summary: chosen?.summary ?? summarisePurchases([], null),
      meters
    };
  }, [text, meter, daysByMeter]);
}

function PaymentList({ purchases }: { purchases: Purchase[] }) {
  const [page, setPage] = useState(0);
  // Newest first: with dates by date, otherwise the last pasted message first.
  const ordered = useMemo(() => {
    const dated = purchases.every((p) => p.date);
    const list = [...purchases];
    return dated ? list.sort((a, b) => b.date!.getTime() - a.date!.getTime()) : list.reverse();
  }, [purchases]);
  const pages = Math.max(1, Math.ceil(ordered.length / PAGE_SIZE));
  useEffect(() => setPage(0), [purchases]);
  const current = Math.min(page, pages - 1);
  const shown = ordered.slice(current * PAGE_SIZE, current * PAGE_SIZE + PAGE_SIZE);

  return (
    <div className="payment-list">
      <ul>
        {shown.map((p, i) => (
          <li key={`${p.tokenTail ?? "x"}-${current}-${i}`}>
            <div>
              <strong>{ugx(p.amount)}</strong>
              <span>{fmtDate(p.date) ?? `Payment ${ordered.length - (current * PAGE_SIZE + i)}`}</span>
            </div>
            <div className="payment-units">
              <strong>{p.units} kWh</strong>
              <span>{ugx(p.amount / p.units)}/unit</span>
            </div>
          </li>
        ))}
      </ul>
      {pages > 1 ? (
        <nav className="pager" aria-label="Payments pages">
          <button type="button" className="button button-secondary button-small" disabled={current === 0} onClick={() => setPage(current - 1)}>‹ Newer</button>
          <span>
            {current * PAGE_SIZE + 1}–{Math.min(ordered.length, (current + 1) * PAGE_SIZE)} of {ordered.length}
          </span>
          <button type="button" className="button button-secondary button-small" disabled={current >= pages - 1} onClick={() => setPage(current + 1)}>Older ›</button>
        </nav>
      ) : null}
    </div>
  );
}

export function SmsImport({
  text,
  setText,
  sms,
  setMeter,
  daysByMeter,
  setDaysForMeter
}: {
  text: string;
  setText: (v: string) => void;
  sms: SmsState;
  setMeter: (account: string) => void;
  daysByMeter: Record<string, string>;
  setDaysForMeter: (account: string, days: string) => void;
}) {
  const { parsed, summary, purchases, meter, meters } = sms;
  const days = meter ? daysByMeter[meter] ?? "" : "";

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
        <li>Paste them below. A few recent ones are enough; repeats are ignored.</li>
      </ol>

      <div className="sms-paste-row">
        <button type="button" className="button button-secondary" onClick={pasteFromClipboard}>Paste from clipboard</button>
        {text ? <button type="button" className="link-button" onClick={() => setText("")}>Clear</button> : null}
      </div>
      <label htmlFor="es-sms" className="visually-hidden">Your UEDCL messages</label>
      <textarea
        id="es-sms"
        rows={parsed.purchases.length ? 3 : 6}
        placeholder={"Dear Customer, payment of 2,000.00 for a/c 14532984490 received by UEDCL. Token no. …, Units 2.20 KWh.Thank you for paying."}
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      <p className="hint">Your messages stay on this device. We only use the amount, units and date, never the token number.</p>

      {text.trim() && parsed.purchases.length === 0 ? (
        <p className="auth-message" role="alert">
          We could not find a UEDCL payment in that text. Paste the messages exactly as UEDCL sent them, or type the numbers instead.
        </p>
      ) : null}

      {meters.length > 1 ? (
        <div className="meter-tabs" role="tablist" aria-label="Meters">
          {meters.map((m) => (
            <button
              type="button"
              role="tab"
              key={m.account}
              aria-selected={m.account === meter}
              className={m.account === meter ? "meter-tab meter-tab-on" : "meter-tab"}
              onClick={() => setMeter(m.account)}
            >
              <strong>{meterLabel(m.account)}</strong>
              <span>
                {m.payments} payment{m.payments === 1 ? "" : "s"}
                {m.summary.projection ? ` · ${ugx(m.summary.projection.cost.month)}/month` : ""}
              </span>
            </button>
          ))}
        </div>
      ) : null}

      {purchases.length > 0 && meter ? (
        <div className="sms-found" aria-live="polite">
          <div className="sms-found-head">
            <p className="sms-found-title">
              <strong>{purchases.length}</strong> payment{purchases.length === 1 ? "" : "s"}
              {meters.length > 1 ? ` for ${meterLabel(meter)}` : ""}
            </p>
            <p className="sms-found-totals">
              {ugx(summary.totalAmount)} · {summary.totalUnits} kWh{summary.pricePerUnit ? ` · ${ugx(summary.pricePerUnit)}/unit` : ""}
            </p>
          </div>
          {parsed.duplicates || parsed.unreadable ? (
            <p className="hint">
              {parsed.duplicates ? `${parsed.duplicates} repeat${parsed.duplicates === 1 ? "" : "s"} ignored. ` : ""}
              {parsed.unreadable ? `${parsed.unreadable} message${parsed.unreadable === 1 ? "" : "s"} could not be read.` : ""}
            </p>
          ) : null}

          <PaymentList purchases={purchases} />

          {summary.basis === "dates" ? (
            <p className="form-success">
              From {fmtDate(summary.firstDate)} to {fmtDate(summary.lastDate)} ({summary.days} days) you used about{" "}
              <strong>{summary.units} kWh</strong>. Your latest top-up is left out because those units are still on your meter.
            </p>
          ) : (
            <div className="sms-days">
              <label htmlFor="es-sms-days">
                {summary.payments === 1
                  ? "About how many days does this top-up last?"
                  : `About how many days does one top-up of about ${ugx(summary.typicalAmount)} (${summary.typicalUnits} kWh) last?`}
              </label>
              <div className="quick-row" role="group" aria-label="Quick pick days">
                {[["1 day", "1"], ["2 days", "2"], ["3 days", "3"], ["5 days", "5"], ["A week", "7"], ["2 weeks", "14"], ["A month", "30"]].map(([label, v]) => (
                  <button type="button" key={v} className={`chip ${days === v ? "chip-on" : ""}`} onClick={() => setDaysForMeter(meter, v)}>{label}</button>
                ))}
              </div>
              <input id="es-sms-days" required inputMode="decimal" type="number" min="0.5" max="366" step="any" placeholder="Or type the number of days" value={days} onChange={(e) => setDaysForMeter(meter, e.target.value)} />
              <p className="hint">Think of a normal top-up: how long until the meter runs low and you buy again?</p>
            </div>
          )}

          {summary.projection ? (
            <div className="sms-projection" aria-live="polite">
              <p className="sms-projection-title">
                {meters.length > 1 ? `Projected spend for ${meterLabel(meter)}` : "Your projected electricity spend"}
                <span>
                  {summary.payments === 1 ? "from 1 payment" : `from ${summary.payments} payments`} at {ugx(summary.pricePerUnit ?? 0)} per unit
                </span>
              </p>
              <div className="projection-grid">
                {([["Per day", "day"], ["Per week", "week"], ["Per month", "month"], ["Per year", "year"]] as const).map(([label, key]) => (
                  <div className={`tile tile-${key}`} key={key}>
                    <span className="tile-label">{label}</span>
                    <span className="tile-value">{ugx(summary.projection!.cost[key])}</span>
                    <span className="tile-sub">{summary.projection!.kwh[key]} kWh</span>
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
