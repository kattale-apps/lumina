"use client";

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { CompanyPage, ConfiguredOnly, errorMessage } from "../workspace";
import { describeItem } from "../../request-item/describeItem";
import { requestReference } from "@/components/WhatsAppSend";
import { whatsappDigits, whatsappLink } from "@/lib/whatsapp";

type Status = "new" | "contacted" | "closed";
const STATUS_LABEL: Record<Status, string> = { new: "New", contacted: "Contacted", closed: "Closed" };

function ItemRequests({ tenantId, companyName }: { tenantId: Id<"tenants">; companyName: string }) {
  const [filter, setFilter] = useState<Status | "">("new");
  const rows = useQuery(api.itemRequests.list, { tenantId, status: filter || undefined });
  const setStatus = useMutation(api.itemRequests.setStatus);
  const [error, setError] = useState<string | null>(null);

  async function change(requestId: Id<"itemRequests">, status: Status) {
    setError(null);
    try {
      await setStatus({ requestId, status });
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  return (
    <section className="workspace-section">
      <h2>Item price requests{rows ? ` (${rows.length})` : ""}</h2>
      <p className="hint">
        Parts people asked prices for on the public &ldquo;Request Item Prices&rdquo; page. Call or WhatsApp them with what you have and the price, then mark the request.
      </p>
      <div className="quick-row" role="group" aria-label="Show">
        {(["new", "contacted", "closed", ""] as const).map((s) => (
          <button key={s || "all"} type="button" className={`chip${filter === s ? " chip-on" : ""}`} aria-pressed={filter === s} onClick={() => setFilter(s)}>
            {s ? STATUS_LABEL[s] : "All"}
          </button>
        ))}
      </div>
      {error ? <p className="auth-message" role="alert">{error}</p> : null}
      {rows === undefined ? <p className="muted">Loading…</p> : rows.length === 0 ? <p className="muted">No requests here.</p> : null}
      <ul className="record-list">
        {(rows ?? []).map((r) => {
          const wa = whatsappDigits(r.phone);
          const reference = requestReference(r.id);
          return (
            <li key={r.id}>
              <div className="record-card">
                <div>
                  <span className="record-title">{r.name} · <a href={`tel:${r.phone.replace(/\s/g, "")}`}>{r.phone}</a></span>
                  <span className="record-meta">
                    {r.location} · {new Date(r.createdAt).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })} · reference <strong>{reference}</strong>{" "}
                    <span className={r.status === "new" ? "pill pill-warn" : "pill pill-info"}>{STATUS_LABEL[r.status]}</span>
                  </span>
                  <ol className="item-request-items">
                    {r.items.map((item, i) => <li key={i}>{describeItem(item)}</li>)}
                  </ol>
                  {r.note ? <span className="record-meta">Note: {r.note}</span> : null}
                  {r.handledBy ? <span className="record-meta">Last updated by {r.handledBy}</span> : null}
                </div>
                <div className="record-actions">
                  {wa ? (
                    <a className="button button-small button-whatsapp" target="_blank" rel="noopener noreferrer"
                      href={whatsappLink(wa, `Hello ${r.name.split(" ")[0]}, this is ${companyName} about your request ${reference}.`)}>
                      💬 WhatsApp
                    </a>
                  ) : null}
                  {r.status !== "contacted" ? <button className="button button-small" type="button" onClick={() => change(r.id, "contacted")}>Mark contacted</button> : null}
                  {r.status !== "closed" ? <button className="button button-small button-secondary" type="button" onClick={() => change(r.id, "closed")}>Close</button> : null}
                  {r.status !== "new" ? <button className="button button-small button-secondary" type="button" onClick={() => change(r.id, "new")}>Back to new</button> : null}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export default function ItemRequestsPage() {
  return (
    <ConfiguredOnly>
      <CompanyPage title="Item price requests" allowedRoles={["super_admin", "inventory_admin", "sales_manager", "sales_agent", "technician"]}>
        {(company) => <ItemRequests tenantId={company.tenantId} companyName={company.companyName} />}
      </CompanyPage>
    </ConfiguredOnly>
  );
}
