"use client";

import Link from "next/link";
import { useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { CompanyPage, ConfiguredOnly } from "../workspace";
import { money, STATUS_HELP, STATUS_LABELS } from "../quotes";

function QuotationList({ tenantId, role }: { tenantId: Id<"tenants">; role: string }) {
  const data = useQuery(api.quotations.listQuotations, { tenantId });
  if (!data) return <p className="muted">Loading quotations…</p>;

  const waiting = (status: string) =>
    status === "submitted_for_technical_review" || status === "under_technical_review"
      ? ["technician", "super_admin"].includes(role)
      : status === "pending_commercial_approval" && ["sales_manager", "super_admin"].includes(role);
  const queue = data.quotations.filter((q) => waiting(q.status));
  const rest = data.quotations.filter((q) => !waiting(q.status));

  const list = (items: typeof data.quotations) => (
    <ul className="record-list">
      {items.map((q) => (
        <li key={q.id}>
          <Link className="record-card module-link" href={`/dashboard/quotations/${q.id}`}>
            <div>
              <span className="record-title">
                {q.officialNumber ?? "Draft"} · {q.customerName}
              </span>
              <span className="record-meta">
                {money(q.totalMinor, q.currency)} · revision {q.revision} · updated{" "}
                {new Date(q.updatedAt).toLocaleString()}
              </span>
              <span className={q.status === "officially_issued" ? "pill" : "pill pill-warn"} title={STATUS_HELP[q.status]}>
                {STATUS_LABELS[q.status]}
              </span>
            </div>
          </Link>
        </li>
      ))}
    </ul>
  );

  return (
    <>
      <p className="hint">Start a quotation from a configuration on an assessment&apos;s sizing page.</p>
      {queue.length > 0 ? (
        <section aria-labelledby="q-queue" className="workspace-section">
          <h2 id="q-queue">Waiting for you ({queue.length})</h2>
          {list(queue)}
        </section>
      ) : null}
      <section aria-labelledby="q-all" className="workspace-section">
        <h2 id="q-all">Quotations ({rest.length})</h2>
        {rest.length === 0 ? <p className="muted">No quotations yet.</p> : list(rest)}
      </section>
    </>
  );
}

export default function QuotationsPage() {
  return (
    <ConfiguredOnly>
      <CompanyPage title="Quotations" allowedRoles={["super_admin", "sales_manager", "sales_agent", "technician"]}>
        {(company) => <QuotationList tenantId={company.tenantId} role={company.role} />}
      </CompanyPage>
    </ConfiguredOnly>
  );
}
