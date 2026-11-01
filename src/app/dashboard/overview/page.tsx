"use client";

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { CompanyPage, ConfiguredOnly, errorMessage } from "../workspace";
import { money, STATUS_LABELS } from "../quotes";

const INSTALL_LABELS: Record<string, string> = {
  pending: "Waiting to be scheduled",
  scheduled: "Scheduled",
  in_progress: "In progress",
  completed: "Completed",
  cancelled: "Cancelled"
};

const perCurrency = (values: Record<string, number>) => {
  const entries = Object.entries(values);
  return entries.length === 0 ? "—" : entries.map(([cur, minor]) => money(minor, cur)).join(" · ");
};

function CommissionPolicy({ tenantId }: { tenantId: Id<"tenants"> }) {
  const settings = useQuery(api.operations.getSettings, { tenantId });
  const save = useMutation(api.operations.setCommissionRate);
  const [value, setValue] = useState<string | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  if (!settings) return null;
  const shown = value ?? String(settings.commissionBps / 100);

  return (
    <form
      className="panel-form"
      onSubmit={async (e) => {
        e.preventDefault();
        try {
          await save({ tenantId, commissionBps: Math.round(Number(shown) * 100) });
          setValue(null);
          setMessage({ ok: true, text: "Saved. It applies to deals won from now on." });
        } catch (err) {
          setMessage({ ok: false, text: errorMessage(err) });
        }
      }}
    >
      <h2>Commission policy</h2>
      <p className="hint">
        A percentage of a won quotation&apos;s value before tax, accrued for the selling agent. Leave at 0 to accrue
        nothing. Each commission keeps the rate it was earned at; changing this never rewrites earlier ones.
      </p>
      <label htmlFor="comm-rate">Commission rate (%)</label>
      <input id="comm-rate" inputMode="decimal" value={shown} onChange={(e) => setValue(e.target.value)} />
      {message ? <p className={message.ok ? "hint" : "auth-message"} role={message.ok ? "status" : "alert"}>{message.text}</p> : null}
      <button className="button" type="submit">Save rate</button>
    </form>
  );
}

function Overview({ tenantId }: { tenantId: Id<"tenants"> }) {
  const [windowDays, setWindowDays] = useState(30);
  const data = useQuery(api.operations.dashboard, { tenantId, windowDays });
  if (!data) return <p className="muted">Loading overview…</p>;

  const stat = (label: string, value: string) => (
    <div className="stat">
      <span className="stat-value">{value}</span>
      <span className="stat-label">{label}</span>
    </div>
  );

  return (
    <>
      <div className="filter-row">
        <label htmlFor="ov-window">Period for wins and losses</label>
        <select id="ov-window" value={windowDays} onChange={(e) => setWindowDays(Number(e.target.value))}>
          <option value={7}>Last 7 days</option>
          <option value={30}>Last 30 days</option>
          <option value={90}>Last 90 days</option>
          <option value={365}>Last 12 months</option>
        </select>
      </div>

      <section aria-labelledby="ov-sales" className="workspace-section">
        <h2 id="ov-sales">Sales in the last {data.windowDays} days</h2>
        <div className="stat-grid">
          {stat("Accepted", String(data.won))}
          {stat("Declined", String(data.lost))}
          {stat("Win rate", data.winRate === null ? "—" : `${Math.round(data.winRate * 100)}%`)}
          {stat("Accepted value", perCurrency(data.wonValueByCurrency))}
          {stat("Issued, unanswered (all time)", perCurrency(data.openValueByCurrency))}
        </div>
        <p className="hint">Values are shown per currency and are never added across currencies. Totals include tax.</p>
      </section>

      <section aria-labelledby="ov-agents" className="workspace-section">
        <h2 id="ov-agents">By agent</h2>
        {data.agents.length === 0 ? (
          <p className="muted">No quotations were answered in this period.</p>
        ) : (
          <div className="table-scroll">
            <table>
              <thead><tr><th>Agent</th><th>Accepted</th><th>Declined</th><th>Accepted value</th></tr></thead>
              <tbody>
                {data.agents.map((a) => (
                  <tr key={a.agentName}>
                    <td>{a.agentName}</td><td>{a.won}</td><td>{a.lost}</td><td>{perCurrency(a.wonValue)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section aria-labelledby="ov-pipeline" className="workspace-section">
        <h2 id="ov-pipeline">Quotation pipeline (all time)</h2>
        <div className="stat-grid">
          {Object.entries(data.quotationsByStatus).map(([status, count]) => stat(STATUS_LABELS[status] ?? status, String(count)))}
        </div>
      </section>

      <section aria-labelledby="ov-ops" className="workspace-section">
        <h2 id="ov-ops">Installations and warranties</h2>
        <div className="stat-grid">
          {Object.entries(data.installationsByStatus).map(([status, count]) => stat(INSTALL_LABELS[status] ?? status, String(count)))}
          {stat("Warranties ending within 60 days", String(data.warrantiesExpiringSoon))}
        </div>
      </section>

      <section aria-labelledby="ov-comm" className="workspace-section">
        <h2 id="ov-comm">Commissions</h2>
        <div className="stat-grid">
          {stat("Accrued, awaiting approval", perCurrency(data.commissionByStatus.accrued ?? {}))}
          {stat("Approved, unpaid", perCurrency(data.commissionByStatus.approved ?? {}))}
          {stat("Paid", perCurrency(data.commissionByStatus.paid ?? {}))}
        </div>
      </section>

      <CommissionPolicy tenantId={tenantId} />
    </>
  );
}

export default function OverviewPage() {
  return (
    <ConfiguredOnly>
      <CompanyPage title="Sales overview" allowedRoles={["super_admin", "sales_manager"]}>
        {(company) => <Overview tenantId={company.tenantId} />}
      </CompanyPage>
    </ConfiguredOnly>
  );
}
