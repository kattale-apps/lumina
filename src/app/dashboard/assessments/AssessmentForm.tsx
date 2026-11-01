"use client";

import { useState } from "react";
import type { Infer } from "convex/values";
import type { Id } from "../../../../convex/_generated/dataModel";
import { computeLoad, type LoadResults } from "../../../../convex/lib/load";
import type { assessmentInputs } from "../../../../convex/schema";
import {
  formatEnergy,
  formatSchedule,
  parseSchedule,
  SOURCE_LABELS,
  SYSTEM_LABELS,
  type SystemType
} from "../crm";

export type Inputs = Infer<typeof assessmentInputs>;
type Source = keyof typeof SOURCE_LABELS;

export type LibraryItem = {
  id: string;
  name: string;
  powerW: number;
  surgeW: number | null;
  powerFactor: number | null;
  typicalHoursPerDay: number;
  currentType: "ac" | "dc";
  status?: string;
};

type LineDraft = {
  key: number;
  applianceId?: Id<"appliances">;
  name: string;
  quantity: string;
  powerW: string;
  powerSource: Source;
  powerFactor: string;
  surgeW: string;
  dutyFactor: string;
  dutyJustification: string;
  currentType: "ac" | "dc";
  critical: boolean;
  schedule: string;
};

let nextKey = 1;

function toDraft(line: Inputs["lines"][number]): LineDraft {
  return {
    key: nextKey++,
    applianceId: line.applianceId,
    name: line.name,
    quantity: String(line.quantity),
    powerW: String(line.powerW),
    powerSource: line.powerSource,
    powerFactor: line.powerFactor?.toString() ?? "",
    surgeW: line.surgeW?.toString() ?? "",
    dutyFactor: line.dutyFactor?.toString() ?? "",
    dutyJustification: line.dutyJustification ?? "",
    currentType: line.currentType,
    critical: line.critical,
    schedule: formatSchedule(line.windows)
  };
}

const optionalNumber = (text: string) => (text.trim() === "" ? undefined : Number(text));

/** Converts the typed form into server inputs, or returns the first problem found. */
function toLine(d: LineDraft): Inputs["lines"][number] | string {
  const windows = parseSchedule(d.schedule);
  if (typeof windows === "string") return `${d.name || "Appliance"}: ${windows}`;
  return {
    applianceId: d.applianceId,
    name: d.name,
    quantity: Number(d.quantity),
    powerW: Number(d.powerW),
    powerSource: d.powerSource,
    powerFactor: optionalNumber(d.powerFactor),
    surgeW: optionalNumber(d.surgeW),
    dutyFactor: optionalNumber(d.dutyFactor),
    dutyJustification: d.dutyJustification.trim() || undefined,
    currentType: d.currentType,
    critical: d.critical,
    windows
  };
}

export function Results({ results }: { results: LoadResults }) {
  const peak = Math.max(1, ...results.hourlyDemandW);
  return (
    <section aria-labelledby="res-heading" className="pricing-box">
      <h3 id="res-heading">Load profile</h3>
      <ul className="spec-list">
        <li>Daily energy: <strong>{formatEnergy(results.dailyEnergyWh)}</strong> (AC {formatEnergy(results.acEnergyWh)}, DC {formatEnergy(results.dcEnergyWh)})</li>
        <li>Critical-load energy: <strong>{formatEnergy(results.criticalEnergyWh)}</strong></li>
        <li>Daytime / night-time (06:00–18:00): {formatEnergy(results.daytimeEnergyWh)} / {formatEnergy(results.nighttimeEnergyWh)}</li>
        <li>Connected load: {results.connectedLoadW} W</li>
        <li>Coincident peak demand: <strong>{results.coincidentPeakW} W</strong>; with start-up surge: {results.peakWithSurgeW} W</li>
        <li>Peak apparent power: {results.peakApparentVA ?? "–"} VA</li>
      </ul>
      <div role="img" aria-label="Demand by hour of day" style={{ display: "flex", alignItems: "flex-end", gap: 2, height: 80 }}>
        {results.hourlyDemandW.map((w, hour) => (
          <div
            key={hour}
            title={`${String(hour).padStart(2, "0")}:00 – ${w} W`}
            style={{ flex: 1, height: `${(w / peak) * 100}%`, minHeight: w > 0 ? 2 : 0, background: "var(--green)" }}
          />
        ))}
      </div>
      <p className="hint">Hours 0 to 23 along the bottom. Demand is treated as constant within each hour.</p>
      {results.warnings.map((w) => (
        <p className="auth-message" key={w}>{w}</p>
      ))}
      <p className="hint">
        Indicative only until a technician reviews it. Battery, PV and inverter sizing are done online once the assessment is completed.
      </p>
    </section>
  );
}

/**
 * The assessment entry form. It knows nothing about where the data is saved:
 * the page that uses it supplies `onSave`, so the same form serves the online
 * editor and the offline field screen.
 */
export function AssessmentForm({
  initial,
  library,
  currency,
  onSave,
  allowComplete
}: {
  initial: Inputs;
  library: LibraryItem[];
  currency: string;
  /** Returns a message to show. Throws a readable Error when it cannot save. */
  onSave: (inputs: Inputs, complete: boolean) => Promise<string>;
  allowComplete: boolean;
}) {
  const [systemType, setSystemType] = useState<SystemType>(initial.systemType);
  const [backupHours, setBackupHours] = useState(initial.backupHours?.toString() ?? "");
  const [autonomyDays, setAutonomyDays] = useState(initial.autonomyDays?.toString() ?? "");
  const [circuits, setCircuits] = useState(initial.criticalCircuits ?? "");
  const [budget, setBudget] = useState(initial.budget ? String(initial.budget.amountMinor / 100) : "");
  const [notes, setNotes] = useState(initial.notes ?? "");
  const [lines, setLines] = useState<LineDraft[]>(() => initial.lines.map(toDraft));
  const [pick, setPick] = useState("");
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const change = (key: number, patch: Partial<LineDraft>) =>
    setLines((all) => all.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  function addLine(from?: LibraryItem) {
    setLines((all) => [
      ...all,
      {
        key: nextKey++,
        applianceId: from?.id as Id<"appliances"> | undefined,
        name: from?.name ?? "",
        quantity: "1",
        powerW: from ? String(from.powerW) : "",
        powerSource: "estimate",
        powerFactor: from?.powerFactor?.toString() ?? "",
        surgeW: from?.surgeW?.toString() ?? "",
        dutyFactor: "",
        dutyJustification: "",
        currentType: from?.currentType ?? "ac",
        critical: false,
        schedule: from ? `18-${Math.min(24, 18 + Math.ceil(from.typicalHoursPerDay))}` : ""
      }
    ]);
  }

  function collect(): Inputs | string {
    const built: Inputs["lines"] = [];
    for (const d of lines) {
      const line = toLine(d);
      if (typeof line === "string") return line;
      built.push(line);
    }
    return {
      systemType,
      backupHours: optionalNumber(backupHours),
      autonomyDays: optionalNumber(autonomyDays),
      criticalCircuits: circuits.trim() || undefined,
      budget: budget.trim() ? { currency, amountMinor: Math.round(Number(budget) * 100) } : undefined,
      notes: notes.trim() || undefined,
      lines: built
    };
  }

  async function run(complete: boolean) {
    setNotice(null);
    const collected = collect();
    if (typeof collected === "string") {
      setNotice({ ok: false, text: collected });
      return;
    }
    setBusy(true);
    try {
      setNotice({ ok: true, text: await onSave(collected, complete) });
    } catch (error) {
      setNotice({ ok: false, text: error instanceof Error ? error.message : "Could not save." });
    } finally {
      setBusy(false);
    }
  }

  const preview = computeLoad(
    lines.flatMap((d) => {
      const line = toLine(d);
      if (typeof line === "string") return [];
      const ok = line.quantity >= 1 && line.powerW > 0 && line.windows.every((w) => w.end > w.start && w.start >= 0 && w.end <= 24);
      return ok ? [{ ...line, name: line.name || "Appliance" }] : [];
    })
  );

  return (
    <>
      <form className="panel-form" onSubmit={(e) => { e.preventDefault(); void run(false); }}>
        <h2>System requirements</h2>
        <label htmlFor="as-sys">System type</label>
        <select id="as-sys" value={systemType} onChange={(e) => setSystemType(e.target.value as SystemType)}>
          {(Object.keys(SYSTEM_LABELS) as SystemType[]).map((s) => (
            <option key={s} value={s}>{SYSTEM_LABELS[s]}</option>
          ))}
        </select>
        <label htmlFor="as-backup">Backup duration needed (hours)</label>
        <input id="as-backup" inputMode="decimal" value={backupHours} onChange={(e) => setBackupHours(e.target.value)} />
        <label htmlFor="as-auto">Days of autonomy</label>
        <input id="as-auto" inputMode="decimal" value={autonomyDays} onChange={(e) => setAutonomyDays(e.target.value)} />
        <label htmlFor="as-circuits">Critical circuits</label>
        <input id="as-circuits" maxLength={500} placeholder="e.g. lights, fridge, router" value={circuits} onChange={(e) => setCircuits(e.target.value)} />
        <label htmlFor="as-budget">Budget ({currency}, optional)</label>
        <input id="as-budget" inputMode="decimal" value={budget} onChange={(e) => setBudget(e.target.value)} />
        <p className="hint">Budget is a commercial limit only. It never changes the technical sizing.</p>
        <label htmlFor="as-notes">Notes</label>
        <textarea id="as-notes" rows={3} maxLength={1000} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </form>

      <section aria-labelledby="lines-heading" className="workspace-section">
        <h2 id="lines-heading">Appliances ({lines.length})</h2>
        <div className="inline-form">
          <select aria-label="Library appliance" value={pick} onChange={(e) => setPick(e.target.value)}>
            <option value="">Choose from the library…</option>
            {library.filter((a) => a.status !== "archived").map((a) => (
              <option key={a.id} value={a.id}>{a.name} ({a.powerW} W)</option>
            ))}
          </select>
          <button
            type="button"
            className="button button-secondary button-small"
            disabled={!pick}
            onClick={() => {
              addLine(library.find((a) => a.id === pick));
              setPick("");
            }}
          >
            Add from library
          </button>
          <button type="button" className="button button-secondary button-small" onClick={() => addLine()}>
            Add custom appliance
          </button>
        </div>

        {lines.map((d, index) => (
          <fieldset className="panel-form" key={d.key}>
            <legend>Appliance {index + 1}</legend>
            <label htmlFor={`n-${d.key}`}>Name</label>
            <input id={`n-${d.key}`} maxLength={80} value={d.name} onChange={(e) => change(d.key, { name: e.target.value })} />
            <label htmlFor={`q-${d.key}`}>Quantity</label>
            <input id={`q-${d.key}`} inputMode="numeric" value={d.quantity} onChange={(e) => change(d.key, { quantity: e.target.value })} />
            <label htmlFor={`p-${d.key}`}>Running power each (W)</label>
            <input id={`p-${d.key}`} inputMode="decimal" value={d.powerW} onChange={(e) => change(d.key, { powerW: e.target.value })} />
            <label htmlFor={`s-${d.key}`}>Where did the power figure come from?</label>
            <select id={`s-${d.key}`} value={d.powerSource} onChange={(e) => change(d.key, { powerSource: e.target.value as Source })}>
              {(Object.keys(SOURCE_LABELS) as Source[]).map((s) => (
                <option key={s} value={s}>{SOURCE_LABELS[s]}</option>
              ))}
            </select>
            <label htmlFor={`t-${d.key}`}>Supply</label>
            <select id={`t-${d.key}`} value={d.currentType} onChange={(e) => change(d.key, { currentType: e.target.value as "ac" | "dc" })}>
              <option value="ac">AC</option>
              <option value="dc">DC</option>
            </select>
            <label htmlFor={`h-${d.key}`}>Hours of use (whole hours, e.g. 6-8, 18-23)</label>
            <input id={`h-${d.key}`} value={d.schedule} onChange={(e) => change(d.key, { schedule: e.target.value })} />
            <label htmlFor={`pf-${d.key}`}>Power factor (optional)</label>
            <input id={`pf-${d.key}`} inputMode="decimal" value={d.powerFactor} onChange={(e) => change(d.key, { powerFactor: e.target.value })} />
            <label htmlFor={`su-${d.key}`}>Starting power (W, optional)</label>
            <input id={`su-${d.key}`} inputMode="decimal" value={d.surgeW} onChange={(e) => change(d.key, { surgeW: e.target.value })} />
            <label htmlFor={`d-${d.key}`}>Duty factor (optional, 0–1)</label>
            <input id={`d-${d.key}`} inputMode="decimal" value={d.dutyFactor} onChange={(e) => change(d.key, { dutyFactor: e.target.value })} />
            {d.dutyFactor.trim() !== "" && Number(d.dutyFactor) < 1 ? (
              <>
                <label htmlFor={`dj-${d.key}`}>Why is this duty factor justified?</label>
                <input id={`dj-${d.key}`} maxLength={300} value={d.dutyJustification} onChange={(e) => change(d.key, { dutyJustification: e.target.value })} />
              </>
            ) : null}
            <label className="check-row">
              <input type="checkbox" checked={d.critical} onChange={(e) => change(d.key, { critical: e.target.checked })} />
              Critical load (must keep running)
            </label>
            <button type="button" className="button button-secondary button-small" onClick={() => setLines((all) => all.filter((l) => l.key !== d.key))}>
              Remove
            </button>
          </fieldset>
        ))}
      </section>

      <Results results={preview} />
      {notice ? (
        <p className={notice.ok ? "form-success" : "auth-message"} role="status">{notice.text}</p>
      ) : null}
      <div className="record-actions">
        <button type="button" className="button" disabled={busy} onClick={() => void run(false)}>
          {busy ? "Saving…" : "Save draft"}
        </button>
        {allowComplete ? (
          <button type="button" className="button button-secondary" disabled={busy} onClick={() => void run(true)}>
            Save and complete
          </button>
        ) : null}
      </div>
    </>
  );
}
