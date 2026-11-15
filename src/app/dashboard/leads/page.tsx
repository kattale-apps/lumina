"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
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
  // Power check requests and upgrade requests are separate lists; ?type=upgrade opens the second.
  const [tab, setTab] = useState<"power" | "upgrade">("power");
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("type") === "upgrade") setTab("upgrade");
  }, []);
  function choose(next: "power" | "upgrade") {
    setTab(next);
    const url = new URL(window.location.href);
    if (next === "upgrade") url.searchParams.set("type", "upgrade");
    else url.searchParams.delete("type");
    window.history.replaceState(null, "", url);
  }
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

  const powerChecks = data.leads.filter((l) => !l.isUpgrade);
  const upgrades = data.leads.filter((l) => l.isUpgrade);
  const shown = tab === "upgrade" ? upgrades : powerChecks;
  const fresh = (list: typeof data.leads) => list.filter((l) => l.status === "new").length;

  return (
    <section className="workspace-section">
      <div className="lead-tabs" role="tablist" aria-label="Kind of request">
        {([
          ["power", "Power check requests", powerChecks],
          ["upgrade", "System upgrade requests", upgrades]
        ] as const).map(([key, label, list]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            className={tab === key ? `lead-tab lead-tab-on lead-tab-${key}` : `lead-tab lead-tab-${key}`}
            onClick={() => choose(key)}
          >
            <span>{label}</span>
            <span className="lead-tab-counts">
              {list.length}
              {fresh(list) ? <span className="nav-count" aria-label={`${fresh(list)} new`}>{fresh(list)} new</span> : null}
            </span>
          </button>
        ))}
      </div>
      <p className="hint">
        {tab === "upgrade"
          ? "From people who already have solar and want to extend it, or fix or replace a faulty part. Open one to see their system, what they want and the upgrade check."
          : "From the public power check, by people who want a new system. Open one to see the customer's full power needs and send them a recommendation with options, prices and photos."}
      </p>
      {error ? <p className="auth-message" role="alert">{error}</p> : null}
      {shown.length === 0 ? <p className="muted">{tab === "upgrade" ? "No upgrade requests yet." : "No power check requests yet."}</p> : null}
      <ul className="record-list">
        {shown.map((l) => (
          <li key={l.id}>
            <div className="record-card">
              <div>
                <span className="record-title">{l.name} · {l.phone}</span>
                <span className="record-meta">
                  {l.location} · {GRID_LABELS[l.gridAvailability]} · {l.isUpgrade ? "has solar already" : `${l.dailyKwh} kWh/day`}
                  {l.costPerMonthMinor !== null ? ` · ${currency} ${l.costPerMonthMinor.toLocaleString("en-US")}/month` : ""}
                </span>
                <span className="record-meta">
                  {l.isRepair ? (
                    <span className="pill pill-bad">
                      Faulty or worn out: {l.faultyParts.map((p) => ({ battery: "batteries", panels: "panels", inverter: "inverter", controller: "charge controller" })[p]).join(", ")}
                    </span>
                  ) : l.isUpgrade ? (
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
