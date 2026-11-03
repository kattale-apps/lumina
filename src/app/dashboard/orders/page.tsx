"use client";

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { CompanyPage, ConfiguredOnly, errorMessage } from "../workspace";

const STATUS_LABEL = { new: "New", confirmed: "Confirmed", cancelled: "Cancelled" } as const;

function OrderList({ tenantId }: { tenantId: Id<"tenants"> }) {
  const orders = useQuery(api.shop.listOrders, { tenantId });
  const setStatus = useMutation(api.shop.setOrderStatus);
  const [error, setError] = useState<string | null>(null);

  if (!orders) return <p className="muted">Loading orders…</p>;

  async function change(orderId: Id<"shopOrders">, status: "new" | "confirmed" | "cancelled") {
    setError(null);
    try {
      await setStatus({ tenantId, orderId, status });
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  return (
    <section className="workspace-section">
      <h2>Customer orders ({orders.length})</h2>
      <p className="hint">Orders placed by customers from the catalogue. Call the customer to confirm before you mark an order confirmed.</p>
      {error ? <p className="auth-message" role="alert">{error}</p> : null}
      {orders.length === 0 ? <p className="muted">No orders yet.</p> : null}
      <ul className="record-list">
        {orders.map((o) => (
          <li key={o.id}>
            <div className="record-card">
              <div>
                <span className="record-title">{o.customerName} · {o.customerPhone}</span>
                <span className="record-meta">
                  {o.deliveryLocation} · {new Date(o.createdAt).toLocaleString()}
                </span>
                <span className="record-meta">{o.items.map((i) => `${i.quantity} × ${i.name} (${i.sku})`).join(", ")}</span>
                <span className="record-meta">
                  Total {o.currency} {(o.totalMinor / 10 ** o.exponent).toLocaleString("en-US", { maximumFractionDigits: o.exponent })}{" "}
                  <span className={o.status === "new" ? "pill pill-warn" : "pill pill-info"}>{STATUS_LABEL[o.status]}</span>
                </span>
                {o.note ? <span className="record-meta">Note: {o.note}</span> : null}
              </div>
              <div className="record-actions">
                {o.status !== "confirmed" ? (
                  <button className="button button-small" type="button" onClick={() => change(o.id, "confirmed")}>Confirm</button>
                ) : null}
                {o.status !== "cancelled" ? (
                  <button className="button button-small button-secondary" type="button" onClick={() => change(o.id, "cancelled")}>Cancel</button>
                ) : null}
              </div>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

export default function OrdersPage() {
  return (
    <ConfiguredOnly>
      <CompanyPage title="Customer orders" allowedRoles={["super_admin", "sales_manager", "sales_agent"]}>
        {(company) => <OrderList tenantId={company.tenantId} />}
      </CompanyPage>
    </ConfiguredOnly>
  );
}
