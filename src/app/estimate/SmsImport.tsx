"use client";

import { useEffect, useMemo, useState } from "react";
import { parseUedclSms, summarisePurchases, type ParsedSms, type Purchase, type SmsSummary } from "./uedclSms";
import { Rich, useT } from "@/lib/i18n";

const PAGE_SIZE = 5;

const fmtDate = (d: Date | null) =>
  d ? d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : null;
const ugx = (n: number) => `UGX ${Math.round(n).toLocaleString("en-US")}`;
const meterTail = (account: string) => account.slice(-4);

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
  const t = useT();
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
              <span>{fmtDate(p.date) ?? t("sms.payment", { number: ordered.length - (current * PAGE_SIZE + i) })}</span>
            </div>
            <div className="payment-units">
              <strong>{p.units} kWh</strong>
              <span>{t("sms.perUnit", { price: ugx(p.amount / p.units) })}</span>
            </div>
          </li>
        ))}
      </ul>
      {pages > 1 ? (
        <nav className="pager" aria-label={t("sms.pages")}>
          <button type="button" className="button button-secondary button-small" disabled={current === 0} onClick={() => setPage(current - 1)}>{t("sms.newer")}</button>
          <span>
            {t("sms.range", { from: current * PAGE_SIZE + 1, to: Math.min(ordered.length, (current + 1) * PAGE_SIZE), total: ordered.length })}
          </span>
          <button type="button" className="button button-secondary button-small" disabled={current >= pages - 1} onClick={() => setPage(current + 1)}>{t("sms.older")}</button>
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
  const t = useT();
  const meterLabel = (account: string) => t("sms.meter", { tail: meterTail(account) });
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
        <li><Rich text={t("sms.step1")} /></li>
        <li><Rich text={t("sms.step2")} /></li>
        <li>{t("sms.step3")}</li>
      </ol>

      <div className="sms-paste-row">
        <button type="button" className="button button-secondary" onClick={pasteFromClipboard}>{t("sms.paste")}</button>
        {text ? <button type="button" className="link-button" onClick={() => setText("")}>{t("sms.clear")}</button> : null}
      </div>
      <label htmlFor="es-sms" className="visually-hidden">{t("sms.label")}</label>
      <textarea
        id="es-sms"
        rows={parsed.purchases.length ? 3 : 6}
        placeholder={"Dear Customer, payment of 2,000.00 for a/c 14532984490 received by UEDCL. Token no. …, Units 2.20 KWh.Thank you for paying."}
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      <p className="hint">{t("sms.private")}</p>

      {text.trim() && parsed.purchases.length === 0 ? (
        <p className="auth-message" role="alert">
          {t("sms.notFound")}
        </p>
      ) : null}

      {meters.length > 1 ? (
        <div className="meter-tabs" role="tablist" aria-label={t("sms.meters")}>
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
                {m.payments === 1 ? t("sms.paymentsOne") : t("sms.paymentsMany", { count: m.payments })}
                {m.summary.projection ? ` · ${t("sms.perMonth", { amount: ugx(m.summary.projection.cost.month) })}` : ""}
              </span>
            </button>
          ))}
        </div>
      ) : null}

      {purchases.length > 0 && meter ? (
        <div className="sms-found" aria-live="polite">
          <div className="sms-found-head">
            <p className="sms-found-title">
              <Rich text={purchases.length === 1 ? t("sms.foundOne") : t("sms.foundMany", { count: purchases.length })} />
              {meters.length > 1 ? t("sms.forMeter", { meter: meterLabel(meter) }) : ""}
            </p>
            <p className="sms-found-totals">
              {ugx(summary.totalAmount)} · {summary.totalUnits} kWh{summary.pricePerUnit ? ` · ${t("sms.perUnit", { price: ugx(summary.pricePerUnit) })}` : ""}
            </p>
          </div>
          {parsed.duplicates || parsed.unreadable ? (
            <p className="hint">
              {parsed.duplicates ? `${parsed.duplicates === 1 ? t("sms.repeatOne") : t("sms.repeats", { count: parsed.duplicates })} ` : ""}
              {parsed.unreadable ? (parsed.unreadable === 1 ? t("sms.unreadableOne") : t("sms.unreadable", { count: parsed.unreadable })) : ""}
            </p>
          ) : null}

          <PaymentList purchases={purchases} />

          {summary.basis === "dates" ? (
            <p className="form-success">
              <Rich text={t("sms.usedBetween", { from: fmtDate(summary.firstDate) ?? "", to: fmtDate(summary.lastDate) ?? "", days: summary.days ?? 0, kwh: summary.units })} />
            </p>
          ) : (
            <div className="sms-days">
              <label htmlFor="es-sms-days">
                {summary.payments === 1
                  ? t("sms.daysOne")
                  : t("sms.daysTypical", { amount: ugx(summary.typicalAmount), kwh: summary.typicalUnits })}
              </label>
              <div className="quick-row" role="group" aria-label={t("sms.quickDays")}>
                {([["sms.day1", "1"], ["sms.days2", "2"], ["sms.days3", "3"], ["sms.days5", "5"], ["sms.week", "7"], ["sms.weeks2", "14"], ["sms.month", "30"]] as const).map(([key, v]) => [t(key), v] as const).map(([label, v]) => (
                  <button type="button" key={v} className={`chip ${days === v ? "chip-on" : ""}`} onClick={() => setDaysForMeter(meter, v)}>{label}</button>
                ))}
              </div>
              <input id="es-sms-days" required inputMode="decimal" type="number" min="0.5" max="366" step="any" placeholder={t("sms.daysPlaceholder")} value={days} onChange={(e) => setDaysForMeter(meter, e.target.value)} />
              <p className="hint">{t("sms.daysHint")}</p>
            </div>
          )}

          {summary.projection ? (
            <div className="sms-projection" aria-live="polite">
              <p className="sms-projection-title">
                {meters.length > 1 ? t("sms.projectedFor", { meter: meterLabel(meter) }) : t("sms.projected")}
                <span>
                  {summary.payments === 1
                    ? t("sms.fromOne", { price: ugx(summary.pricePerUnit ?? 0) })
                    : t("sms.fromMany", { count: summary.payments, price: ugx(summary.pricePerUnit ?? 0) })}
                </span>
              </p>
              <div className="projection-grid">
                {([["sms.perDay", "day"], ["sms.perWeek", "week"], ["sms.perMonthTile", "month"], ["sms.perYear", "year"]] as const).map(([labelKey, key]) => [t(labelKey), key] as const).map(([label, key]) => (
                  <div className={`tile tile-${key}`} key={key}>
                    <span className="tile-label">{label}</span>
                    <span className="tile-value">{ugx(summary.projection!.cost[key])}</span>
                    <span className="tile-sub">{summary.projection!.kwh[key]} kWh</span>
                  </div>
                ))}
              </div>
              <p className="hint">
                {t("sms.estimateNote")}
                {summary.payments < 3 ? ` ${t("sms.moreForSteady")}` : ""}
              </p>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
