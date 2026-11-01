"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";
import type { LoadResults } from "../../../../../convex/lib/load";
import { CompanyPage, ConfiguredOnly, errorMessage } from "../../workspace";
import { formatSchedule, GRID_LABELS, SOURCE_LABELS, SYSTEM_LABELS } from "../../crm";
import { AssessmentForm, Results } from "../AssessmentForm";

type Loaded = NonNullable<ReturnType<typeof useQuery<typeof api.assessments.getAssessment>>>;

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

function Editor({ loaded, tenantId, currency }: { loaded: Loaded; tenantId: Id<"tenants">; currency: string }) {
  const save = useMutation(api.assessments.saveAssessment);
  const complete = useMutation(api.assessments.completeAssessment);
  const library = useQuery(api.appliances.listAppliances, { tenantId });

  return (
    <AssessmentForm
      initial={loaded.shown.inputs}
      library={library?.appliances ?? []}
      currency={currency}
      allowComplete
      onSave={async (inputs, finish) => {
        try {
          const saved = await save({
            assessmentId: loaded.assessment.id,
            expectedRevision: loaded.assessment.currentRevision,
            inputs
          });
          if (finish) {
            await complete({ assessmentId: loaded.assessment.id });
            return "Assessment completed.";
          }
          return saved.changed ? `Saved as revision ${saved.revision}.` : "No changes to save.";
        } catch (error) {
          throw new Error(errorMessage(error));
        }
      }}
    />
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
