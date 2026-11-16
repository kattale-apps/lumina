"use client";

import type { FunctionReturnType } from "convex/server";
import type { api } from "../../../../convex/_generated/api";
import { useT, type MessageKey } from "@/lib/i18n";
import { en } from "@/lib/i18n/en";

export type Report = FunctionReturnType<typeof api.upgrades.simulate>;
export type ReportOption = Report["sections"][number]["options"][number];

export const UNVERIFIED_BANNER = "UNVERIFIED — FOR ILLUSTRATION ONLY";

const STATE_ICON = { pass: "✓", fail: "✗", review: "!" } as const;
const STATE_WORD = { pass: "upgradeReport.stateOk", fail: "upgradeReport.stateProblem", review: "upgradeReport.stateReview" } as const;

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
  const t = useT();
  const open = option.checks.filter((c) => c.state === "review").length;
  return (
    <article className={`option-card upgrade-option ${selected ? "option-on" : ""}`}>
      <h4>{option.title}</h4>
      <p className="pill-row">
        <span className={option.status === "compatible" ? "pill pill-ok" : "pill pill-warn"}>
          {option.status === "compatible" ? t("upgradeReport.fits") : open === 1 ? t("upgradeReport.pointsOne") : t("upgradeReport.points", { count: open })}
        </span>
        {option.tags.map((tag) => <span key={tag} className="pill pill-info">{tag}</span>)}
      </p>
      <p>{option.summary}</p>
      {option.sku || option.brand || option.model ? (
        <p className="record-meta">{[option.brand, option.model, option.sku ? `SKU ${option.sku}` : ""].filter(Boolean).join(" · ")}</p>
      ) : null}
      {option.totalMinor !== null && option.unitListMinor !== null ? (
        <p className="upgrade-price">
          <strong>{money(option.totalMinor, report.exponent, report.currency)}</strong>
          <span className="record-meta">{t("upgradeReport.listPrice", { quantity: option.quantity, unit: money(option.unitListMinor, report.exponent, report.currency) })}</span>
        </p>
      ) : null}
      <details className="upgrade-checks">
        <summary>{t("upgradeReport.checks", { count: option.checks.length })}</summary>
        <ul>
          {option.checks.map((c) => (
            <li key={c.id} className={`upgrade-check upgrade-check-${c.state}`}>
              <span aria-hidden="true">{STATE_ICON[c.state as keyof typeof STATE_ICON]}</span>
              <span><strong>{c.label}: {t(STATE_WORD[c.state as keyof typeof STATE_WORD])}.</strong> {c.detail}</span>
            </li>
          ))}
        </ul>
      </details>
      {onToggle ? (
        <button type="button" className={selected ? "button" : "button button-secondary"} aria-pressed={selected} onClick={onToggle}>
          {selected ? t("upgradeReport.chosen") : t("upgradeReport.choose")}
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
  const t = useT();
  if (report.blockers.length > 0) {
    return (
      <div className="result-block">
        <h3>{t("upgradeReport.notAddUp")}</h3>
        {report.blockers.map((b) => <p key={b} className="auth-message" role="alert">{b}</p>)}
      </div>
    );
  }
  const c = report.current;
  const empty = report.sections.every((s) => s.options.length === 0);

  return (
    <>
      <p className="estimate-banner">
        {t("upgradeReport.banner")}
      </p>

      <div className="result-block result-use">
        <h3>{t("upgradeReport.today")}</h3>
        <div className="projection-grid">
          {c.systemVoltage !== null ? (
            <div className="tile tile-peak"><span className="tile-label">{t("upgradeReport.systemVoltage")}</span><span className="tile-value">{c.systemVoltage} V</span><span className="tile-sub">{t("upgradeReport.batteryBank")}</span></div>
          ) : null}
          {c.arrayWp > 0 ? (
            <div className="tile tile-energy"><span className="tile-label">{t("upgradeReport.solar")}</span><span className="tile-value">{c.arrayWp.toLocaleString("en-US")} Wp</span><span className="tile-sub">{t("upgradeReport.solarPerDay", { kwh: kwh(c.solarWhPerDay) })}</span></div>
          ) : null}
          {c.batteryNominalWh > 0 ? (
            <div className="tile tile-day"><span className="tile-label">{t("upgradeReport.battery")}</span><span className="tile-value">{kwh(c.batteryUsableWh)}</span><span className="tile-sub">{t("upgradeReport.usableOf", { kwh: kwh(c.batteryNominalWh) })}{c.backupHours !== null ? t("upgradeReport.backupHours", { hours: c.backupHours }) : ""}</span></div>
          ) : null}
          {c.inverterW !== null ? (
            <div className="tile tile-month"><span className="tile-label">{t("upgradeReport.inverter")}</span><span className="tile-value">{watts(c.inverterW)}</span><span className="tile-sub">{t("upgradeReport.continuous")}</span></div>
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
          {t("upgradeReport.assumptions", {
            sun: report.assumptions.peakSunHours,
            percent: Math.round(report.assumptions.performanceRatio * 100),
            cold: report.assumptions.minCellTempC,
            hot: report.assumptions.maxCellTempC
          })}
        </p>
      </div>

      {report.sections.map((s) => (
        <div key={s.area} className="result-block upgrade-section">
          <h3>{(`upgradeReport.area.${s.area}` as MessageKey) in en ? t(`upgradeReport.area.${s.area}` as MessageKey) : s.title}</h3>
          {s.messages.map((m) => <p key={m}>{m}</p>)}
          {s.requirements.length > 0 ? (
            <div className="upgrade-requirements">
              <strong>{t("upgradeReport.mustMatch")}</strong>
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
            <p className="muted">{t("upgradeReport.noProduct")}</p>
          )}
          {s.rejected.length > 0 ? (
            <details className="upgrade-checks">
              <summary>{t("upgradeReport.leftOut", { count: s.rejected.length })}</summary>
              <ul>{s.rejected.map((r) => <li key={r}>{r}</li>)}</ul>
            </details>
          ) : null}
        </div>
      ))}
      {empty && report.sections.length > 0 ? (
        <p className="muted">{t("upgradeReport.noneFit")}</p>
      ) : null}
    </>
  );
}
