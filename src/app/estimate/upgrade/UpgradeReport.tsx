"use client";

import type { FunctionReturnType } from "convex/server";
import type { api } from "../../../../convex/_generated/api";

export type Report = FunctionReturnType<typeof api.upgrades.simulate>;
export type ReportOption = Report["sections"][number]["options"][number];

export const UNVERIFIED_BANNER = "UNVERIFIED — FOR ILLUSTRATION ONLY";

const STATE_ICON = { pass: "✓", fail: "✗", review: "!" } as const;
const STATE_WORD = { pass: "OK", fail: "Problem", review: "Needs a technician" } as const;

export function money(minor: number, exponent: number, currency: string) {
  return `${currency} ${(minor / 10 ** exponent).toLocaleString("en-US", { maximumFractionDigits: exponent })}`;
}
const kwh = (wh: number) => `${(wh / 1000).toLocaleString("en-US", { maximumFractionDigits: 1 })} kWh`;
const watts = (w: number) => `${Math.round(w).toLocaleString("en-US")} W`;

/**
 * Applies a tap on an option to the current selection. Only one option per part
 * of the system can be chosen; an option that depends on another brings it
 * along, and removing an option removes whatever depended on it.
 */
export function toggleOption(report: Report, selected: string[], key: string): string[] {
  const all = report.sections.flatMap((s) => s.options);
  const byKey = new Map(all.map((o) => [o.key, o]));
  const option = byKey.get(key);
  if (!option) return selected;

  let next: string[];
  if (selected.includes(key)) {
    next = selected.filter((k) => k !== key);
  } else {
    const add = [key, ...(option.requires ? [option.requires] : [])];
    const areas = new Set(add.map((k) => byKey.get(k)?.area));
    next = [...selected.filter((k) => !areas.has(byKey.get(k)?.area)), ...add];
  }
  // Drop anything whose partner is no longer chosen.
  return next.filter((k) => {
    const needs = byKey.get(k)?.requires;
    return !needs || next.includes(needs);
  });
}

/** List-price total of the chosen options, or null when any of them has no price shown. */
export function selectionTotal(report: Report, selected: string[]) {
  const chosen = report.sections.flatMap((s) => s.options).filter((o) => selected.includes(o.key));
  if (chosen.length === 0 || chosen.some((o) => o.totalMinor === null)) return null;
  return chosen.reduce((sum, o) => sum + (o.totalMinor ?? 0), 0);
}

function OptionCard({
  option, report, selected, onToggle
}: {
  option: ReportOption;
  report: Report;
  selected: boolean;
  onToggle?: () => void;
}) {
  const open = option.checks.filter((c) => c.state === "review").length;
  return (
    <article className={`option-card upgrade-option ${selected ? "option-on" : ""}`}>
      <h4>{option.title}</h4>
      <p className="pill-row">
        <span className={option.status === "compatible" ? "pill pill-ok" : "pill pill-warn"}>
          {option.status === "compatible" ? "Fits the ratings given" : `${open} point${open === 1 ? "" : "s"} for a technician to confirm`}
        </span>
        {option.tags.map((t) => <span key={t} className="pill pill-info">{t}</span>)}
      </p>
      <p>{option.summary}</p>
      {option.sku || option.brand || option.model ? (
        <p className="record-meta">{[option.brand, option.model, option.sku ? `SKU ${option.sku}` : ""].filter(Boolean).join(" · ")}</p>
      ) : null}
      {option.totalMinor !== null && option.unitListMinor !== null ? (
        <p className="upgrade-price">
          <strong>{money(option.totalMinor, report.exponent, report.currency)}</strong>
          <span className="record-meta"> list price · {option.quantity} × {money(option.unitListMinor, report.exponent, report.currency)}</span>
        </p>
      ) : null}
      <details className="upgrade-checks">
        <summary>Checks ({option.checks.length})</summary>
        <ul>
          {option.checks.map((c) => (
            <li key={c.id} className={`upgrade-check upgrade-check-${c.state}`}>
              <span aria-hidden="true">{STATE_ICON[c.state as keyof typeof STATE_ICON]}</span>
              <span><strong>{c.label}: {STATE_WORD[c.state as keyof typeof STATE_WORD]}.</strong> {c.detail}</span>
            </li>
          ))}
        </ul>
      </details>
      {onToggle ? (
        <button type="button" className={selected ? "button" : "button button-secondary"} aria-pressed={selected} onClick={onToggle}>
          {selected ? "✓ Chosen" : "Choose this"}
        </button>
      ) : null}
    </article>
  );
}

/**
 * The result of an upgrade check. With `onToggle` the options can be chosen,
 * for a quotation or a quote request; without it the report is read-only.
 */
export function UpgradeReport({
  report, selected = [], onToggle
}: {
  report: Report;
  selected?: string[];
  onToggle?: (key: string) => void;
}) {
  if (report.blockers.length > 0) {
    return (
      <div className="result-block">
        <h3>The details do not add up yet</h3>
        {report.blockers.map((b) => <p key={b} className="auth-message" role="alert">{b}</p>)}
      </div>
    );
  }
  const c = report.current;
  const empty = report.sections.every((s) => s.options.length === 0);

  return (
    <>
      <p className="estimate-banner">
        {UNVERIFIED_BANNER}. This is worked out from the ratings typed in. A technician must check the real equipment
        before anything here is final.
      </p>

      <div className="result-block result-use">
        <h3>The system today</h3>
        <div className="projection-grid">
          {c.systemVoltage !== null ? (
            <div className="tile tile-peak"><span className="tile-label">System voltage</span><span className="tile-value">{c.systemVoltage} V</span><span className="tile-sub">battery bank</span></div>
          ) : null}
          {c.arrayWp > 0 ? (
            <div className="tile tile-energy"><span className="tile-label">Solar</span><span className="tile-value">{c.arrayWp.toLocaleString("en-US")} Wp</span><span className="tile-sub">about {kwh(c.solarWhPerDay)} a day</span></div>
          ) : null}
          {c.batteryNominalWh > 0 ? (
            <div className="tile tile-day"><span className="tile-label">Battery</span><span className="tile-value">{kwh(c.batteryUsableWh)}</span><span className="tile-sub">usable of {kwh(c.batteryNominalWh)}{c.backupHours !== null ? ` · about ${c.backupHours} h backup` : ""}</span></div>
          ) : null}
          {c.inverterW !== null ? (
            <div className="tile tile-month"><span className="tile-label">Inverter</span><span className="tile-value">{watts(c.inverterW)}</span><span className="tile-sub">continuous</span></div>
          ) : null}
        </div>
        {report.findings.length > 0 ? (
          <ul className="upgrade-findings">
            {report.findings.map((f) => (
              <li key={f.id} className={`upgrade-check upgrade-check-${f.state}`}>
                <span aria-hidden="true">{STATE_ICON[f.state as keyof typeof STATE_ICON]}</span>
                <span><strong>{f.label}.</strong> {f.detail}</span>
              </li>
            ))}
          </ul>
        ) : null}
        <p className="hint">
          Solar figures assume {report.assumptions.peakSunHours} useful sun hours a day and {Math.round(report.assumptions.performanceRatio * 100)}% system
          performance, a cautious figure for Uganda. Cold-morning and hot-day voltages use {report.assumptions.minCellTempC} °C and {report.assumptions.maxCellTempC} °C cells.
        </p>
      </div>

      {report.sections.map((s) => (
        <div key={s.area} className="result-block upgrade-section">
          <h3>{s.title}</h3>
          {s.messages.map((m) => <p key={m}>{m}</p>)}
          {s.requirements.length > 0 ? (
            <div className="upgrade-requirements">
              <strong>What anything added here must match</strong>
              <ul>{s.requirements.map((r) => <li key={r}>{r}</li>)}</ul>
            </div>
          ) : null}
          {s.options.length > 0 ? (
            <div className="option-list">
              {s.options.map((o) => (
                <OptionCard key={o.key} option={o} report={report} selected={selected.includes(o.key)} onToggle={onToggle ? () => onToggle(o.key) : undefined} />
              ))}
            </div>
          ) : (
            <p className="muted">No product in the catalogue fits here yet. A technician can recommend one.</p>
          )}
          {s.rejected.length > 0 ? (
            <details className="upgrade-checks">
              <summary>Why some products were left out ({s.rejected.length})</summary>
              <ul>{s.rejected.map((r) => <li key={r}>{r}</li>)}</ul>
            </details>
          ) : null}
        </div>
      ))}
      {empty && report.sections.length > 0 ? (
        <p className="muted">None of the catalogue products fit the system as described. Send the details and a technician will advise.</p>
      ) : null}
    </>
  );
}
