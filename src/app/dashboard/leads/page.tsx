"use client";

import Link from "next/link";
import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { CompanyPage, ConfiguredOnly, errorMessage } from "../workspace";
import { useMarkSeen } from "@/lib/appInbox";

const GRID_LABELS = { none: "No grid", unreliable: "Unreliable grid", reliable: "Reliable grid" } as const;

function LeadList({ tenantId, currency }: { tenantId: Id<"tenants">; currency: string }) {
  const data = useQuery(api.leads.listLeads, { tenantId });
  const assignees = useQuery(api.leads.listAssignees, data?.canAssign ? { tenantId } : "skip");
  const assign = useMutation(api.leads.assignLead);
  const convert = useMutation(api.leads.convertLead);
  const convertUpgrade = useMutation(api.leads.convertUpgradeLead);
  const close = useMutation(api.leads.closeLead);
  const [error, setError] = useState<string | null>(null);
  const inbox = useQuery(api.inbox.myInbox, {});
  useMarkSeen("staff", data !== undefined, inbox?.staff);

  if (!data) return <p className="muted">Loading requests…</p>;

  async function run(action: () => Promise<unknown>) {
    setError(null);
    try {
      await action();
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  return (
    <section className="workspace-section">
      <h2>Quote requests ({data.leads.length})</h2>
      <p className="hint">
        These come from the public power check. Open one to see the customer's full power needs and send them a
        recommendation with options, prices and photos.
      </p>
      {error ? <p className="auth-message" role="alert">{error}</p> : null}
      {data.leads.length === 0 ? <p className="muted">No requests yet.</p> : null}
      <ul className="record-list">
        {data.leads.map((l) => (
          <li key={l.id}>
            <div className="record-card">
              <div>
                <span className="record-title">{l.name} · {l.phone}</span>
                <span className="record-meta">
                  {l.location} · {GRID_LABELS[l.gridAvailability]} · {l.isUpgrade ? "has solar already" : `${l.dailyKwh} kWh/day`}
                  {l.costPerMonthMinor !== null ? ` · ${currency} ${l.costPerMonthMinor.toLocaleString("en-US")}/month` : ""}
                </span>
                <span className="record-meta">
                  {l.isUpgrade ? (
                    <span className="pill pill-warn">Wants to upgrade an existing system</span>
                  ) : l.isRecommendation ? (
                    <span className="pill pill-warn">Needs a system recommendation and quotation</span>
                  ) : (
                    <>Chose: {l.optionTitle}</>
                  )}
                </span>
                <span className="record-meta">
                  {l.components.length
                    ? l.components.map((c) => `${c.quantity} × ${c.name}`).join(", ")
                    : l.isUpgrade
                      ? "No option chosen: recommend from the upgrade check."
                      : "No catalogue option yet: design from the load details."}
                </span>
                <span className="pill-row">
                  <span className={l.status === "new" ? "pill pill-warn" : "pill pill-info"}>{l.status}</span>
                  {l.responseStatus === "sent" ? <span className="pill pill-ok">Recommendation sent</span> : null}
                  {l.responseStatus === "draft" ? <span className="pill pill-warn">Draft response</span> : null}
                  {l.customerChose ? <span className="pill pill-ok">Customer chose an option</span> : null}
                  <span className={l.hasAccount ? "pill pill-info" : "pill pill-muted"}>{l.hasAccount ? "Has an account" : "No account yet"}</span>
                </span>
                {l.assignedTo || l.email ? (
                  <span className="record-meta">
                    {l.assignedTo ? `Assigned to ${l.assignedTo}` : ""}
                    {l.assignedTo && l.email ? " · " : ""}
                    {l.email ?? ""}
                  </span>
                ) : null}
              </div>
              <div className="record-actions">
                <Link className="button button-small" href={`/dashboard/leads/${l.id}`}>
                  {l.responseStatus === "sent" ? "View request and response" : "Review and respond"}
                </Link>
                {l.status === "converted" && l.assessmentId ? (
                  <Link className="button button-small" href={`/dashboard/assessments/${l.assessmentId}`}>Open assessment</Link>
                ) : null}
                {l.status === "converted" && l.upgradeStudyId ? (
                  <Link className="button button-small" href={`/dashboard/upgrades/${l.upgradeStudyId}`}>Open upgrade study</Link>
                ) : null}
                {data.canAssign && (l.status === "new" || l.status === "assigned") ? (
                  <select
                    aria-label={`Assign ${l.name}`}
                    value=""
                    onChange={(e) => {
                      const userId = e.target.value as Id<"userProfiles">;
                      if (userId) void run(() => assign({ leadId: l.id, assigneeUserId: userId }));
                    }}
                  >
                    <option value="">{l.assignedTo ? "Reassign…" : "Assign to…"}</option>
                    {(assignees ?? []).map((a) => (
                      <option key={a.userId} value={a.userId}>{a.name}</option>
                    ))}
                  </select>
                ) : null}
                {data.canAct && (l.status === "new" || l.status === "assigned") ? (
                  <>
                    <button className="button button-small button-secondary" type="button" onClick={() => run(() => (l.isUpgrade ? convertUpgrade({ leadId: l.id }) : convert({ leadId: l.id })))}>
                      Convert
                    </button>
                    <button className="button button-small button-secondary" type="button" onClick={() => run(() => close({ leadId: l.id }))}>
                      Close
                    </button>
                  </>
                ) : null}
              </div>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

export default function LeadsPage() {
  return (
    <ConfiguredOnly>
      <CompanyPage title="Quote requests" allowedRoles={["super_admin", "sales_manager", "sales_agent", "technician"]}>
        {(company) => <LeadList tenantId={company.tenantId} currency={company.defaultCurrency} />}
      </CompanyPage>
    </ConfiguredOnly>
  );
}
