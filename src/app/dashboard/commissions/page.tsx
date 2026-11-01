"use client";

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { CompanyPage, ConfiguredOnly, errorMessage } from "../workspace";
import { money } from "../quotes";

const LABELS: Record<string, string> = {
  accrued: "Accrued — awaiting approval",
  approved: "Approved — unpaid",
  paid: "Paid",
  cancelled: "Cancelled"
};

function Row({ row }: { row: NonNullable<ReturnType<typeof useQuery<typeof api.operations.listCommissions>>>["commissions"][number] }) {
  const decide = useMutation(api.operations.decideCommission);
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const run = async (action: "approve" | "pay" | "cancel") => {
    setError("");
    try {
      await decide({
        commissionId: row.id,
        action,
        paymentReference: action === "pay" ? text : undefined,
        reason: action === "cancel" ? text : undefined
      });
      setText("");
    } catch (e) {
      setError(errorMessage(e));
    }
  };
  const open = row.status === "accrued" || row.status === "approved";

  return (
    <li className="record-card">
      <div>
        <span className="record-title">
          {money(row.amountMinor, row.currency)} · {row.agentName}
        </span>
        <span className="record-meta">
          {row.quotationNumber} · {row.customerName} · {row.rateBps / 100}% of {money(row.baseMinor, row.currency)} before tax
        </span>
        <span className={row.status === "paid" ? "pill" : "pill pill-warn"}>{LABELS[row.status]}</span>
        {row.paymentReference ? <span className="record-meta">Payment reference {row.paymentReference}</span> : null}
        {row.cancelReason ? <span className="record-meta">Cancelled: {row.cancelReason}</span> : null}
        {error ? <span className="auth-message" role="alert">{error}</span> : null}
        {row.canDecide && open ? (
          <div className="inline-form">
            <input
              aria-label="Payment reference or cancellation reason"
              placeholder="Payment reference / reason to cancel"
              maxLength={300}
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
            {row.status === "accrued" ? (
              <button className="button button-small" type="button" onClick={() => void run("approve")}>Approve</button>
            ) : (
              <button className="button button-small" type="button" onClick={() => void run("pay")}>Mark paid</button>
            )}
            <button className="button button-secondary button-small" type="button" onClick={() => void run("cancel")}>Cancel</button>
          </div>
        ) : null}
        {!row.canDecide && open && row.agentName ? (
          <span className="record-meta">Another manager approves and pays this one.</span>
        ) : null}
      </div>
    </li>
  );
}

function Commissions({ tenantId }: { tenantId: Id<"tenants"> }) {
  const data = useQuery(api.operations.listCommissions, { tenantId });
  const settings = useQuery(api.operations.getSettings, { tenantId });
  if (!data || !settings) return <p className="muted">Loading commissions…</p>;
  return (
    <>
      <p className="hint">
        {settings.commissionBps === 0
          ? "No commission rate is configured, so nothing is accruing. A manager sets it on the Overview page."
          : `Current rate: ${settings.commissionBps / 100}% of a won quotation's value before tax. It is recorded on each commission when the customer accepts.`}
      </p>
      {data.commissions.length === 0 ? (
        <p className="muted">No commissions yet.</p>
      ) : (
        <ul className="record-list">
          {data.commissions.map((row) => <Row key={row.id} row={row} />)}
        </ul>
      )}
    </>
  );
}

export default function CommissionsPage() {
  return (
    <ConfiguredOnly>
      <CompanyPage title="Commissions" allowedRoles={["super_admin", "sales_manager", "sales_agent"]}>
        {(company) => <Commissions tenantId={company.tenantId} />}
      </CompanyPage>
    </ConfiguredOnly>
  );
}
