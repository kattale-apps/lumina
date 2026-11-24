"use client";

import Link from "next/link";
import { useState } from "react";
import { useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { CompanyPage, ConfiguredOnly } from "../workspace";

type Entry = { at: number; type: string; title: string; detail: string; link: string | null; by?: string | null };

const TONE: Record<string, string> = {
  Inquiry: "pill-warn",
  Response: "pill-ok",
  "WhatsApp reply": "pill-ok",
  Quotation: "pill-info",
  "Proforma invoice": "pill-info",
  Receipt: "pill-ok",
  Payment: "pill-ok"
};

/** Entries grouped by day, newest first, each with its time. */
function Timeline({ entries }: { entries: Entry[] }) {
  if (entries.length === 0) return <p className="muted">Nothing recorded yet.</p>;
  const days = new Map<string, Entry[]>();
  for (const e of entries) {
    const day = new Date(e.at).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric" });
    days.set(day, [...(days.get(day) ?? []), e]);
  }
  return (
    <div className="book">
      {[...days.entries()].map(([day, list]) => (
        <section key={day} className="book-day">
          <h3>{day}</h3>
          <ul className="record-list">
            {list.map((e, i) => (
              <li key={i} className="record-card book-entry">
                <span className="book-time">{new Date(e.at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}</span>
                <div>
                  <span className={`pill ${TONE[e.type] ?? ""}`}>{e.type}</span>{" "}
                  <span className="record-title">{e.link ? <Link href={e.link}><u>{e.title}</u></Link> : e.title}</span>
                  <span className="record-meta">{e.detail}{e.by ? ` · ${e.by}` : ""}</span>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function StaffBook({ tenantId }: { tenantId: Id<"tenants"> }) {
  const people = useQuery(api.salesLog.bookPeople, { tenantId });
  const [userId, setUserId] = useState<string>("");
  const book = useQuery(api.salesLog.staffBook, { tenantId, userId: (userId || undefined) as Id<"userProfiles"> | undefined });
  return (
    <>
      {people && people.length > 1 ? (
        <div className="filter-row">
          <label htmlFor="book-person">Record book of</label>
          <select id="book-person" value={userId} onChange={(e) => setUserId(e.target.value)}>
            {people.map((p) => <option key={p.userId} value={p.self ? "" : p.userId}>{p.name}{p.self ? " (me)" : ""}</option>)}
          </select>
        </div>
      ) : null}
      {book ? (
        <>
          <p className="muted">{book.name}: {book.entries.length} entries — inquiries, responses, WhatsApp replies, quotations, invoices, receipts and payments.</p>
          <Timeline entries={book.entries} />
        </>
      ) : <p className="muted">Loading…</p>}
    </>
  );
}

function CustomerBook({ tenantId }: { tenantId: Id<"tenants"> }) {
  const customers = useQuery(api.salesLog.customerIndex, { tenantId });
  const [search, setSearch] = useState("");
  const [phone, setPhone] = useState<string | null>(null);
  const book = useQuery(api.salesLog.customerBook, phone ? { tenantId, phone } : "skip");
  const term = search.trim().toLowerCase();
  const matches = (customers ?? []).filter((c) => !term || `${c.name} ${c.phone}`.toLowerCase().includes(term)).slice(0, 30);
  return (
    <>
      <div className="filter-row">
        <label htmlFor="cust-search">Find a customer</label>
        <input id="cust-search" type="search" placeholder="Name or phone" value={search} onChange={(e) => { setSearch(e.target.value); setPhone(null); }} />
        {search.replace(/\D/g, "").length >= 9 ? <button type="button" className="button button-small" onClick={() => setPhone(search)}>Open this number</button> : null}
      </div>
      {phone && book ? (
        <>
          <h2>{book.name || "Customer"} · {book.phone}</h2>
          <button type="button" className="button button-small button-secondary" onClick={() => setPhone(null)}>← All customers</button>
          <Timeline entries={book.entries} />
        </>
      ) : phone ? <p className="muted">Loading…</p> : (
        <ul className="record-list">
          {matches.map((c) => (
            <li key={c.phone} className="record-card">
              <button type="button" className="link-button book-customer" onClick={() => setPhone(c.phone)}>
                <span className="record-title">{c.name}</span>
                <span className="record-meta">{c.phone} · {c.count} record(s) · last {new Date(c.last).toLocaleDateString("en-GB", { dateStyle: "medium" })}</span>
              </button>
            </li>
          ))}
          {customers && matches.length === 0 ? <p className="muted">No customer matches.</p> : null}
        </ul>
      )}
    </>
  );
}

function RecordBook({ tenantId }: { tenantId: Id<"tenants"> }) {
  const [tab, setTab] = useState<"staff" | "customer">("staff");
  return (
    <>
      <p className="muted">A dated record of sales work: by staff member, or by customer.</p>
      <div className="tab-row" role="tablist">
        <button type="button" role="tab" aria-selected={tab === "staff"} className={`chip ${tab === "staff" ? "chip-on" : ""}`} onClick={() => setTab("staff")}>Staff record book</button>
        <button type="button" role="tab" aria-selected={tab === "customer"} className={`chip ${tab === "customer" ? "chip-on" : ""}`} onClick={() => setTab("customer")}>Customer record book</button>
      </div>
      <section className="workspace-section">{tab === "staff" ? <StaffBook tenantId={tenantId} /> : <CustomerBook tenantId={tenantId} />}</section>
    </>
  );
}

export default function RecordBookPage() {
  return (
    <ConfiguredOnly>
      <CompanyPage title="Sales record book" allowedRoles={["super_admin", "inventory_admin", "sales_manager", "sales_agent", "technician"]}>
        {(company) => <RecordBook tenantId={company.tenantId} />}
      </CompanyPage>
    </ConfiguredOnly>
  );
}
