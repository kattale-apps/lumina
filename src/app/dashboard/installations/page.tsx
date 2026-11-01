"use client";

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { CompanyPage, ConfiguredOnly, errorMessage } from "../workspace";

const LABELS: Record<string, string> = {
  pending: "Waiting to be scheduled",
  scheduled: "Scheduled",
  in_progress: "In progress",
  completed: "Completed",
  cancelled: "Cancelled"
};

type Job = NonNullable<ReturnType<typeof useQuery<typeof api.operations.listInstallations>>>[number];

function JobCard({ job, tenantId }: { job: Job; tenantId: Id<"tenants"> }) {
  const technicians = useQuery(api.operations.listTechnicians, job.canManage && job.status !== "completed" && job.status !== "cancelled" ? { tenantId } : "skip");
  const schedule = useMutation(api.operations.scheduleInstallation);
  const start = useMutation(api.operations.startInstallation);
  const complete = useMutation(api.operations.completeInstallation);
  const cancel = useMutation(api.operations.cancelInstallation);
  const [tech, setTech] = useState("");
  const [date, setDate] = useState("");
  const [text, setText] = useState("");
  const [why, setWhy] = useState("");
  const [error, setError] = useState("");
  const run = async (fn: () => Promise<unknown>) => {
    setError("");
    try {
      await fn();
      setText("");
      setWhy("");
    } catch (e) {
      setError(errorMessage(e));
    }
  };
  const finished = job.status === "completed" || job.status === "cancelled";

  return (
    <li className="record-card">
      <div>
        <span className="record-title">{job.customerName} · {job.quotationNumber}</span>
        <span className="record-meta">{job.siteName}{job.siteAddress ? ` — ${job.siteAddress}` : ""}</span>
        <span className={job.status === "completed" ? "pill" : "pill pill-warn"}>{LABELS[job.status]}</span>
        <span className="record-meta">
          {job.technicianName ? `Technician ${job.technicianName}` : "No technician yet"}
          {job.scheduledFor ? ` · ${new Date(job.scheduledFor).toLocaleDateString()}` : ""}
          {job.completedAt ? ` · finished ${new Date(job.completedAt).toLocaleDateString()}` : ""}
        </span>
        {job.notes ? <span className="record-meta">Notes: {job.notes}</span> : null}
        {job.cancelReason ? <span className="record-meta">Cancelled: {job.cancelReason}</span> : null}
        {error ? <span className="auth-message" role="alert">{error}</span> : null}

        {job.canManage && !finished && technicians ? (
          <div className="inline-form">
            <select aria-label="Technician" value={tech} onChange={(e) => setTech(e.target.value)}>
              <option value="">Choose technician…</option>
              {technicians.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
            <input aria-label="Installation date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            <button
              className="button button-small"
              type="button"
              disabled={!tech || !date}
              onClick={() =>
                run(() =>
                  schedule({
                    installationId: job.id,
                    technicianUserId: tech as Id<"userProfiles">,
                    scheduledFor: new Date(`${date}T08:00:00`).getTime()
                  })
                )
              }
            >
              {job.status === "pending" ? "Schedule" : "Reschedule"}
            </button>
          </div>
        ) : null}

        {job.canWork && !finished ? (
          <div className="inline-form">
            {job.status !== "in_progress" ? (
              <button className="button button-small" type="button" onClick={() => run(() => start({ installationId: job.id }))}>
                Start installation
              </button>
            ) : (
              <>
                <input aria-label="Completion notes" placeholder="Completion notes (optional)" maxLength={1000} value={text} onChange={(e) => setText(e.target.value)} />
                <button className="button button-small" type="button" onClick={() => run(() => complete({ installationId: job.id, notes: text || undefined }))}>
                  Complete — issue stock, start warranties
                </button>
              </>
            )}
          </div>
        ) : null}

        {job.canManage && !finished ? (
          <div className="inline-form">
            <input aria-label="Reason for cancelling" placeholder="Reason for cancelling" maxLength={300} value={why} onChange={(e) => setWhy(e.target.value)} />
            <button className="button button-secondary button-small" type="button" onClick={() => run(() => cancel({ installationId: job.id, reason: why }))}>
              Cancel job
            </button>
          </div>
        ) : null}
      </div>
    </li>
  );
}

function Warranties({ tenantId }: { tenantId: Id<"tenants"> }) {
  const rows = useQuery(api.operations.listWarranties, { tenantId });
  if (!rows) return null;
  const order = { expiring: 0, active: 1, expired: 2 } as const;
  const sorted = [...rows].sort((a, b) => order[a.state] - order[b.state] || a.endsAt - b.endsAt);
  return (
    <section aria-labelledby="warr" className="workspace-section">
      <h2 id="warr">Warranties ({rows.length})</h2>
      {rows.length === 0 ? (
        <p className="muted">Warranties begin when an installation is completed.</p>
      ) : (
        <ul className="record-list">
          {sorted.map((w) => (
            <li key={w.id} className="record-card">
              <div>
                <span className="record-title">{w.quantity} × {w.description}{w.sku ? ` (${w.sku})` : ""}</span>
                <span className="record-meta">
                  {w.customerName} · {w.quotationNumber} · {w.months} months · ends {new Date(w.endsAt).toLocaleDateString()}
                </span>
                <span className={w.state === "active" ? "pill" : "pill pill-warn"}>
                  {w.state === "active" ? "In warranty" : w.state === "expiring" ? "Ends within 60 days" : "Expired"}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Installations({ tenantId }: { tenantId: Id<"tenants"> }) {
  const jobs = useQuery(api.operations.listInstallations, { tenantId });
  if (!jobs) return <p className="muted">Loading installations…</p>;
  const open = jobs.filter((j) => j.status !== "completed" && j.status !== "cancelled");
  const closed = jobs.filter((j) => j.status === "completed" || j.status === "cancelled");
  return (
    <>
      <p className="hint">
        An installation job opens when a customer accepts an official quotation. Completing it issues the held stock
        and starts each product&apos;s quoted warranty from that day.
      </p>
      <section aria-labelledby="inst-open" className="workspace-section">
        <h2 id="inst-open">Open jobs ({open.length})</h2>
        {open.length === 0 ? <p className="muted">Nothing waiting.</p> : (
          <ul className="record-list">{open.map((j) => <JobCard key={j.id} job={j} tenantId={tenantId} />)}</ul>
        )}
      </section>
      {closed.length > 0 ? (
        <section aria-labelledby="inst-closed" className="workspace-section">
          <h2 id="inst-closed">Finished ({closed.length})</h2>
          <ul className="record-list">{closed.map((j) => <JobCard key={j.id} job={j} tenantId={tenantId} />)}</ul>
        </section>
      ) : null}
      <Warranties tenantId={tenantId} />
    </>
  );
}

export default function InstallationsPage() {
  return (
    <ConfiguredOnly>
      <CompanyPage title="Installations" allowedRoles={["super_admin", "sales_manager", "sales_agent", "technician"]}>
        {(company) => <Installations tenantId={company.tenantId} />}
      </CompanyPage>
    </ConfiguredOnly>
  );
}
