"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";
import { computeLoad, type LoadResults } from "../../../../../convex/lib/load";
import { CompanyPage, ConfiguredOnly, errorMessage } from "../../workspace";
import {
  formatEnergy,
  formatSchedule,
  GRID_LABELS,
  parseSchedule,
  SOURCE_LABELS,
  SYSTEM_LABELS,
  type SystemType
} from "../../crm";

type Loaded = NonNullable<ReturnType<typeof useQuery<typeof api.assessments.getAssessment>>>;
type Inputs = Loaded["shown"]["inputs"];
type Source = keyof typeof SOURCE_LABELS;

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

function Results({ results }: { results: LoadResults }) {
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
        Indicative only until a technician reviews it. Battery, PV and inverter sizing come in the next phase.
      </p>
    </section>
  );
}

function ReadOnly({ shown }: { shown: Loaded["shown"] }) {
  const { inputs } = shown;
  return (
    <>
      <section className="workspace-section">
        <h2>Inputs (revision {shown.revision})</h2>
        <p className="record-meta">
          {SYSTEM_LABELS[inputs.systemType]}
          {inputs.backupHours !== undefined ? ` · backup ${inputs.backupHours} h` : ""}
          {inputs.autonomyDays !== undefined ? ` · autonomy ${inputs.autonomyDays} days` : ""}
        </p>
        {inputs.criticalCircuits ? <p className="record-meta">Critical circuits: {inputs.criticalCircuits}</p> : null}
        {inputs.budget ? (
          <p className="record-meta">Budget: {inputs.budget.currency} {(inputs.budget.amountMinor / 100).toLocaleString()}</p>
        ) : null}
        <ul className="record-list">
          {inputs.lines.map((l, i) => (
            <li className="record-card" key={i}>
              <div>
                <span className="record-title">{l.quantity} × {l.name}{l.critical ? " (critical)" : ""}</span>
                <span className="record-meta">
                  {l.powerW} W {l.currentType.toUpperCase()} · {SOURCE_LABELS[l.powerSource].toLowerCase()} · hours {formatSchedule(l.windows)}
                  {l.dutyFactor ? ` · duty ${l.dutyFactor} (${l.dutyJustification})` : ""}
                </span>
              </div>
            </li>
          ))}
        </ul>
      </section>
      <Results results={shown.results as LoadResults} />
    </>
  );
}

function Editor({
  loaded,
  tenantId,
  currency
}: {
  loaded: Loaded;
  tenantId: Id<"tenants">;
  currency: string;
}) {
  const save = useMutation(api.assessments.saveAssessment);
  const complete = useMutation(api.assessments.completeAssessment);
  const library = useQuery(api.appliances.listAppliances, { tenantId });
  const { inputs } = loaded.shown;

  const [systemType, setSystemType] = useState<SystemType>(inputs.systemType);
  const [backupHours, setBackupHours] = useState(inputs.backupHours?.toString() ?? "");
  const [autonomyDays, setAutonomyDays] = useState(inputs.autonomyDays?.toString() ?? "");
  const [circuits, setCircuits] = useState(inputs.criticalCircuits ?? "");
  const [budget, setBudget] = useState(inputs.budget ? String(inputs.budget.amountMinor / 100) : "");
  const [notes, setNotes] = useState(inputs.notes ?? "");
  const [lines, setLines] = useState<LineDraft[]>(() => inputs.lines.map(toDraft));
  const [pick, setPick] = useState("");
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const change = (key: number, patch: Partial<LineDraft>) =>
    setLines((all) => all.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  function addLine(from?: NonNullable<typeof library>["appliances"][number]) {
    setLines((all) => [
      ...all,
      {
        key: nextKey++,
        applianceId: from?.id,
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

  async function run(finish: boolean) {
    setNotice(null);
    const collected = collect();
    if (typeof collected === "string") {
      setNotice({ ok: false, text: collected });
      return;
    }
    setBusy(true);
    try {
      const saved = await save({
        assessmentId: loaded.assessment.id,
        expectedRevision: loaded.assessment.currentRevision,
        inputs: collected
      });
      if (finish) {
        await complete({ assessmentId: loaded.assessment.id });
        setNotice({ ok: true, text: "Assessment completed." });
      } else {
        setNotice({ ok: true, text: saved.changed ? `Saved as revision ${saved.revision}.` : "No changes to save." });
      }
    } catch (error) {
      setNotice({ ok: false, text: errorMessage(error) });
    } finally {
      setBusy(false);
    }
  }

  const valid = lines.flatMap((d) => {
    const line = toLine(d);
    return typeof line === "string" ? [] : [{ ...line, name: line.name || "Appliance" }];
  });
  const preview = computeLoad(
    valid.filter((l) => l.quantity >= 1 && l.powerW > 0 && l.windows.every((w) => w.end > w.start && w.start >= 0 && w.end <= 24))
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
            {library?.appliances.filter((a) => a.status === "active").map((a) => (
              <option key={a.id} value={a.id}>{a.name} ({a.powerW} W)</option>
            ))}
          </select>
          <button
            type="button"
            className="button button-secondary button-small"
            disabled={!pick}
            onClick={() => {
              addLine(library?.appliances.find((a) => a.id === pick));
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
        <button type="button" className="button button-secondary" disabled={busy} onClick={() => void run(true)}>
          Save and complete
        </button>
      </div>
    </>
  );
}

function AssessmentView({ assessmentId, tenantId, currency }: { assessmentId: Id<"assessments">; tenantId: Id<"tenants">; currency: string }) {
  const [revision, setRevision] = useState<number | undefined>();
  const loaded = useQuery(api.assessments.getAssessment, { assessmentId, revision });
  const reopen = useMutation(api.assessments.reopenAssessment);
  const [error, setError] = useState("");

  if (!loaded) return <p className="muted">Loading assessment…</p>;
  const { assessment, shown } = loaded;
  const editable = loaded.canWrite && assessment.status === "draft" && shown.isCurrent;

  return (
    <>
      <p><Link href="/dashboard/assessments">← All assessments</Link></p>
      <p className="record-meta">
        {assessment.customerName} · {assessment.siteName}
        {assessment.gridAvailability ? ` · ${GRID_LABELS[assessment.gridAvailability]}` : ""}
      </p>
      <p>
        <span className={assessment.status === "draft" ? "pill pill-warn" : "pill"}>{assessment.status}</span>{" "}
        <span className="record-meta">Revision {shown.revision} of {assessment.currentRevision} · engine {shown.engineVersion}</span>
      </p>

      <div className="filter-row">
        <label htmlFor="rev">Revision</label>
        <select id="rev" value={shown.revision} onChange={(e) => setRevision(Number(e.target.value))}>
          {loaded.history.map((h) => (
            <option key={h.revision} value={h.revision}>
              {h.revision} – {new Date(h.createdAt).toLocaleString()}
            </option>
          ))}
        </select>
      </div>
      {!shown.isCurrent ? (
        <p className="hint">You are viewing an earlier revision. Select the latest revision to edit.</p>
      ) : null}
      {error ? <p className="auth-message" role="alert">{error}</p> : null}
      {assessment.status === "completed" ? (
        <p><Link className="button" href={`/dashboard/assessments/${assessment.id}/sizing`}>Size a system</Link></p>
      ) : null}

      {editable ? (
        <Editor key={`${assessment.id}-${assessment.currentRevision}`} loaded={loaded} tenantId={tenantId} currency={currency} />
      ) : (
        <>
          <ReadOnly shown={shown} />
          {loaded.canWrite && assessment.status === "completed" && shown.isCurrent ? (
            <button
              type="button"
              className="button button-secondary"
              onClick={async () => {
                setError("");
                try {
                  await reopen({ assessmentId });
                } catch (e) {
                  setError(errorMessage(e));
                }
              }}
            >
              Reopen for changes
            </button>
          ) : null}
        </>
      )}
    </>
  );
}

export default function AssessmentPage() {
  const params = useParams<{ id: string }>();
  return (
    <ConfiguredOnly>
      <CompanyPage title="Assessment" allowedRoles={["super_admin", "sales_manager", "sales_agent", "technician"]}>
        {(company) => (
          <AssessmentView
            assessmentId={params.id as Id<"assessments">}
            tenantId={company.tenantId}
            currency={company.defaultCurrency}
          />
        )}
      </CompanyPage>
    </ConfiguredOnly>
  );
}
