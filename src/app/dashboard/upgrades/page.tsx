"use client";

import Link from "next/link";
import { useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { GOAL_LABEL } from "../../estimate/upgrade/describe";
import { CompanyPage, ConfiguredOnly } from "../workspace";

function StudyList({ tenantId }: { tenantId: Id<"tenants"> }) {
  const data = useQuery(api.upgrades.listStudies, { tenantId });
  if (!data) return <p className="muted">Loading upgrade studies…</p>;

  return (
    <>
      <p className="muted">
        For customers who already have solar. Describe what is installed and what they want, and see what the system
        can take: the battery voltage it needs, how many more panels fit, and which catalogue parts match.
      </p>
      <p>
        <Link className="button" href="/dashboard/upgrades/new">New upgrade check</Link>
      </p>
      <section aria-labelledby="up-list" className="workspace-section">
        <h2 id="up-list">Saved studies ({data.studies.length})</h2>
        {data.studies.length === 0 ? (
          <p className="muted">No upgrade studies saved yet.</p>
        ) : (
          <ul className="record-list">
            {data.studies.map((s) => (
              <li key={s.id}>
                <Link className="record-card module-link" href={`/dashboard/upgrades/${s.id}`}>
                  <div>
                    <span className="record-title">{s.customerName}</span>
                    <span className="record-meta">
                      {s.systemVoltage ? `${s.systemVoltage} V system · ` : ""}
                      {s.goals.map((g) => GOAL_LABEL[g]).join(", ")} · {new Date(s.createdAt).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}
                    </span>
                    <span className="pill-row">
                      {s.blocked ? <span className="pill pill-warn">Details do not add up</span> : <span className="pill pill-info">{s.options} option{s.options === 1 ? "" : "s"}</span>}
                      <span className={s.verified ? "pill pill-ok" : "pill pill-warn"}>{s.verified ? "Ratings verified" : "Not yet verified"}</span>
                      {s.fromPublicRequest ? <span className="pill pill-muted">From a public request</span> : null}
                    </span>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}

export default function UpgradesPage() {
  return (
    <ConfiguredOnly>
      <CompanyPage title="Upgrade checks" allowedRoles={["super_admin", "sales_manager", "sales_agent", "technician"]}>
        {(company) => <StudyList tenantId={company.tenantId} />}
      </CompanyPage>
    </ConfiguredOnly>
  );
}
