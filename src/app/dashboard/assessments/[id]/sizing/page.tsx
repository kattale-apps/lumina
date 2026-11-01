"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../../../../convex/_generated/api";
import type { Id } from "../../../../../../convex/_generated/dataModel";
import { CompanyPage, ConfiguredOnly, errorMessage } from "../../../workspace";
import { formatEnergy } from "../../../crm";

type View = NonNullable<ReturnType<typeof useQuery<typeof api.sizing.getSizing>>>;
type Run = NonNullable<View["run"]>;

const FIELDS = [
  ["peakSunHours", "Peak sun hours (design month)"],
  ["performanceRatio", "PV performance ratio (0–1)"],
  ["defaultDod", "Depth of discharge if the battery states none (0–1)"],
  ["dischargeEfficiency", "Battery discharge efficiency (0–1)"],
  ["roundTripEfficiency", "Battery round-trip efficiency (0–1)"],
  ["inverterEfficiency", "Inverter efficiency (0–1)"],
  ["inverterHeadroom", "Inverter headroom over AC peak (1 = none)"],
  ["minCellTempC", "Coldest cell temperature (°C)"],
  ["maxCellTempC", "Hottest cell temperature (°C)"],
  ["gridTiedOffset", "Grid-tied share of energy to offset (0–1)"]
] as const;

const DEFAULTS: Record<(typeof FIELDS)[number][0], string> = {
  peakSunHours: "4",
  performanceRatio: "0.75",
  defaultDod: "0.5",
  dischargeEfficiency: "0.95",
  roundTripEfficiency: "0.9",
  inverterEfficiency: "0.92",
  inverterHeadroom: "1.2",
  minCellTempC: "15",
  maxCellTempC: "65",
  gridTiedOffset: "1"
};

const STATE_LABEL = { pass: "Pass", fail: "Fail", review: "Needs review" } as const;
const STATUS_LABEL = {
  compatible: "Compatible",
  incompatible: "Incompatible",
  requires_review: "Requires technician review"
} as const;

function RunForm({ assessmentId, onRun }: { assessmentId: Id<"assessments">; onRun: (id: Id<"sizingRuns">) => void }) {
  const run = useMutation(api.sizing.runSizing);
  const [values, setValues] = useState(DEFAULTS);
  const [source, setSource] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  return (
    <form
      className="panel-form"
      onSubmit={async (e) => {
        e.preventDefault();
        setError("");
        setBusy(true);
        try {
          const n = (k: keyof typeof DEFAULTS) => Number(values[k]);
          const { runId } = await run({
            assessmentId,
            assumptions: {
              peakSunHours: n("peakSunHours"),
              solarResourceSource: source,
              performanceRatio: n("performanceRatio"),
              defaultDod: n("defaultDod"),
              dischargeEfficiency: n("dischargeEfficiency"),
              roundTripEfficiency: n("roundTripEfficiency"),
              inverterEfficiency: n("inverterEfficiency"),
              inverterHeadroom: n("inverterHeadroom"),
              minCellTempC: n("minCellTempC"),
              maxCellTempC: n("maxCellTempC"),
              gridTiedOffset: n("gridTiedOffset")
            }
          });
          onRun(runId);
        } catch (err) {
          setError(errorMessage(err));
        } finally {
          setBusy(false);
        }
      }}
    >
      <h2>Run sizing</h2>
      <p className="hint">
        These assumptions are saved with the result. Use conservative values for the site and have a
        technician confirm them.
      </p>
      <label htmlFor="sz-source">Where did the peak sun hours come from?</label>
      <input id="sz-source" required maxLength={200} placeholder="e.g. site survey, lowest month" value={source} onChange={(e) => setSource(e.target.value)} />
      {FIELDS.map(([key, label]) => (
        <div key={key} style={{ display: "grid", gap: 8 }}>
          <label htmlFor={`sz-${key}`}>{label}</label>
          <input id={`sz-${key}`} inputMode="decimal" value={values[key]} onChange={(e) => setValues({ ...values, [key]: e.target.value })} />
        </div>
      ))}
      {error ? <p className="auth-message" role="alert">{error}</p> : null}
      <button className="button" type="submit" disabled={busy}>{busy ? "Calculating…" : "Run sizing"}</button>
    </form>
  );
}

function Candidate({ run, index, canResolve, canQuote }: { run: Run; index: number; canResolve: boolean; canQuote: boolean }) {
  const resolve = useMutation(api.sizing.resolveCheck);
  const createQuotation = useMutation(api.quotations.createQuotation);
  const router = useRouter();
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const c = run.outcome.candidates[index];
  const name = (id: string | null) => run.products.find((p) => p.id === id);
  const resolved = (checkId: string) => run.resolutions.find((r) => r.candidateIndex === index && r.checkId === checkId);
  const open = c.checks.filter((k: { id: string; state: string }) => k.state === "review" && !resolved(k.id)).length;
  const inv = name(c.inverterId);
  const bat = name(c.batteryId);
  const pan = name(c.panelId);

  return (
    <li className="product-card">
      <h3>Configuration {index + 1}</h3>
      <p>
        <span className={c.status === "compatible" ? "pill" : "pill pill-warn"}>{STATUS_LABEL[c.status as keyof typeof STATUS_LABEL]}</span>{" "}
        {c.status === "requires_review" ? (
          <span className="record-meta">{open === 0 ? "All review items resolved by a technician." : `${open} item(s) awaiting a technician.`}</span>
        ) : null}
      </p>
      <ul className="spec-list">
        <li>Inverter: <strong>{inv?.name}</strong> ({inv?.sku})</li>
        {pan ? <li>Panels: <strong>{c.counts.panels} × {pan.name}</strong> ({pan.sku}) — {c.counts.parallelStrings} string(s) of {c.counts.panelsPerString}, {c.counts.arrayWp} Wp</li> : null}
        {bat ? <li>Batteries: <strong>{c.counts.batteries} × {bat.name}</strong> ({bat.sku}) — {c.counts.batteriesInSeries} in series × {c.counts.batteryStrings} string(s), {formatEnergy(c.counts.batteryNominalWh)} nominal</li> : null}
      </ul>
      {error ? <p className="auth-message" role="alert">{error}</p> : null}
      {canQuote && !run.stale ? (
        <button
          type="button"
          className="button"
          onClick={async () => {
            setError("");
            try {
              const { quotationId } = await createQuotation({ sizingRunId: run.id, candidateIndex: index });
              router.push(`/dashboard/quotations/${quotationId}`);
            } catch (e) {
              setError(errorMessage(e));
            }
          }}
        >
          Create quotation from this configuration
        </button>
      ) : null}
      <ul className="spec-list">
        {c.checks.map((k: { id: string; label: string; state: keyof typeof STATE_LABEL; detail: string }) => {
          const res = resolved(k.id);
          return (
            <li key={k.id}>
              <strong>{k.label}: {STATE_LABEL[k.state]}</strong> — {k.detail}
              {res ? <div className="hint">Technician note: {res.note}</div> : null}
              {k.state === "review" && !res && canResolve ? (
                <div className="inline-form">
                  <input aria-label={`Resolution note for ${k.label}`} maxLength={500} placeholder="Resolution note" value={notes[k.id] ?? ""} onChange={(e) => setNotes({ ...notes, [k.id]: e.target.value })} />
                  <button
                    type="button"
                    className="button button-secondary button-small"
                    onClick={async () => {
                      setError("");
                      try {
                        await resolve({ runId: run.id, candidateIndex: index, checkId: k.id, note: notes[k.id] ?? "" });
                      } catch (e) {
                        setError(errorMessage(e));
                      }
                    }}
                  >
                    Resolve
                  </button>
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </li>
  );
}

function RunView({ view }: { view: View }) {
  const run = view.run!;
  const r = run.requirements;
  return (
    <>
      {run.stale ? (
        <p className="auth-message" role="alert">
          The assessment has changed since this run (it used revision {run.assessmentRevision}). Run sizing again.
        </p>
      ) : null}
      <section className="pricing-box">
        <h3>Requirements (assessment revision {run.assessmentRevision}, engine {run.engineVersion})</h3>
        <ul className="spec-list">
          <li>Daily energy: {formatEnergy(r.dailyEnergyWh)}</li>
          <li>Battery must deliver: {r.batteryDeliveredWh === null ? "no battery" : formatEnergy(r.batteryDeliveredWh)}</li>
          <li>PV array: {r.pvWp === null ? "not sized" : `${r.pvWp} Wp (from ${formatEnergy(r.pvEnergyWh)} per day)`}</li>
          <li>AC peak {r.acPeakW} W, with start-up surge {r.acSurgePeakW} W; inverter must supply {r.requiredInverterW} W / {r.requiredInverterVA} VA</li>
          <li>Solar resource: {run.assumptions.peakSunHours} peak sun hours — {run.assumptions.solarResourceSource}</li>
        </ul>
        {r.warnings.map((w: string) => <p className="hint" key={w}>⚠ {w}</p>)}
      </section>

      {run.outcome.messages.map((m: string) => <p className="auth-message" key={m}>{m}</p>)}
      <ul className="record-list">
        {run.outcome.candidates.map((_: unknown, i: number) => (
          <Candidate key={i} run={run} index={i} canResolve={view.canResolve} canQuote={view.canQuote} />
        ))}
      </ul>

      {run.outcome.rejected.length > 0 ? (
        <details className="category-card">
          <summary><strong>Why other products were not offered ({run.outcome.rejected.length})</strong></summary>
          <ul className="category-body">
            {run.outcome.rejected.map((x: { reason: string }) => <li key={x.reason}>{x.reason}</li>)}
          </ul>
        </details>
      ) : null}
      <p className="hint">
        Indicative only until a technician reviews it. Cables, protection, earthing, mounting and charge
        controllers are not yet part of these configurations, and stock and prices are checked when quoting.
      </p>
    </>
  );
}

function Sizing({ assessmentId }: { assessmentId: Id<"assessments"> }) {
  const [runId, setRunId] = useState<Id<"sizingRuns"> | undefined>();
  const view = useQuery(api.sizing.getSizing, { assessmentId, runId });
  if (!view) return <p className="muted">Loading…</p>;

  return (
    <>
      <p><Link href={`/dashboard/assessments/${assessmentId}`}>← Back to assessment</Link></p>
      {view.assessmentStatus !== "completed" ? (
        <p className="muted">Complete the assessment before sizing a system.</p>
      ) : (
        <RunForm assessmentId={assessmentId} onRun={(id) => setRunId(id)} />
      )}
      {view.runs.length > 0 ? (
        <div className="filter-row">
          <label htmlFor="sz-run">Run</label>
          <select id="sz-run" value={view.run?.id} onChange={(e) => setRunId(e.target.value as Id<"sizingRuns">)}>
            {view.runs.map((r) => (
              <option key={r.id} value={r.id}>
                {new Date(r.createdAt).toLocaleString()} — revision {r.assessmentRevision} — {r.status}
              </option>
            ))}
          </select>
        </div>
      ) : null}
      {view.run ? <RunView view={view} /> : null}
    </>
  );
}

export default function SizingPage() {
  const params = useParams<{ id: string }>();
  return (
    <ConfiguredOnly>
      <CompanyPage title="System sizing" allowedRoles={["super_admin", "sales_manager", "sales_agent", "technician"]}>
        {() => <Sizing assessmentId={params.id as Id<"assessments">} />}
      </CompanyPage>
    </ConfiguredOnly>
  );
}
