"use client";

import Link from "next/link";
import { useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { CompanyPage, ConfiguredOnly } from "../workspace";

function AssessmentList({ tenantId }: { tenantId: Id<"tenants"> }) {
  const data = useQuery(api.assessments.listAssessments, { tenantId });
  if (!data) return <p className="muted">Loading assessments…</p>;

  return (
    <section aria-labelledby="as-heading" className="workspace-section">
      <h2 id="as-heading">Assessments ({data.assessments.length})</h2>
      <p className="hint">
        Start an assessment from a customer&apos;s site. <Link href="/dashboard/customers">Go to customers</Link>
      </p>
      {data.assessments.length === 0 ? (
        <p className="muted">No assessments yet.</p>
      ) : (
        <ul className="record-list">
          {data.assessments.map((a) => (
            <li key={a.id}>
              <Link className="record-card module-link" href={`/dashboard/assessments/${a.id}`}>
                <div>
                  <span className="record-title">{a.customerName} · {a.siteName}</span>
                  <span className="record-meta">
                    Revision {a.currentRevision} · updated {new Date(a.updatedAt).toLocaleString()}
                  </span>
                  <span className={a.status === "draft" ? "pill pill-warn" : "pill"}>{a.status}</span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export default function AssessmentsPage() {
  return (
    <ConfiguredOnly>
      <CompanyPage title="Assessments" allowedRoles={["super_admin", "sales_manager", "sales_agent", "technician"]}>
        {(company) => <AssessmentList tenantId={company.tenantId} />}
      </CompanyPage>
    </ConfiguredOnly>
  );
}
