"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { CompanyPage, ConfiguredOnly, errorMessage } from "../workspace";
import { CUSTOMER_TYPES, type CustomerType } from "../crm";

function AddCustomer({ tenantId }: { tenantId: Id<"tenants"> }) {
  const create = useMutation(api.customers.createCustomer);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [type, setType] = useState<CustomerType>("residential");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setNotice(null);
    try {
      await create({ tenantId, name, phone, email, type });
      setNotice({ ok: true, text: "Customer added." });
      setName("");
      setPhone("");
      setEmail("");
    } catch (error) {
      setNotice({ ok: false, text: errorMessage(error) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="panel-form" onSubmit={submit}>
      <h2>Add a customer</h2>
      <label htmlFor="cu-name">Name</label>
      <input id="cu-name" required maxLength={120} value={name} onChange={(e) => setName(e.target.value)} />
      <label htmlFor="cu-phone">Phone</label>
      <input id="cu-phone" required type="tel" maxLength={20} placeholder="+256 700 000000" value={phone} onChange={(e) => setPhone(e.target.value)} />
      <label htmlFor="cu-email">Email (optional)</label>
      <input id="cu-email" type="email" maxLength={120} value={email} onChange={(e) => setEmail(e.target.value)} />
      <label htmlFor="cu-type">Customer type</label>
      <select id="cu-type" value={type} onChange={(e) => setType(e.target.value as CustomerType)}>
        {CUSTOMER_TYPES.map((t) => (
          <option key={t} value={t}>{t}</option>
        ))}
      </select>
      {notice ? (
        <p className={notice.ok ? "form-success" : "auth-message"} role="status">{notice.text}</p>
      ) : null}
      <button className="button" type="submit" disabled={busy}>
        {busy ? "Adding…" : "Add customer"}
      </button>
    </form>
  );
}

function CustomerList({ tenantId }: { tenantId: Id<"tenants"> }) {
  const data = useQuery(api.customers.listCustomers, { tenantId });
  if (!data) return <p className="muted">Loading customers…</p>;

  return (
    <>
      {data.canWrite ? <AddCustomer tenantId={tenantId} /> : null}
      <section aria-labelledby="cu-heading" className="workspace-section">
        <h2 id="cu-heading">Customers ({data.customers.length})</h2>
        {data.customers.length === 0 ? (
          <p className="muted">No customers yet.{data.canWrite ? " Add the first one above." : ""}</p>
        ) : (
          <ul className="record-list">
            {data.customers.map((c) => (
              <li key={c.id}>
                <Link className="record-card module-link" href={`/dashboard/customers/${c.id}`}>
                  <div>
                    <span className="record-title">{c.name}</span>
                    <span className="record-meta">{c.type} · {c.phone}</span>
                    {c.status === "archived" ? <span className="pill pill-warn">archived</span> : null}
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

export default function CustomersPage() {
  return (
    <ConfiguredOnly>
      <CompanyPage title="Customers" allowedRoles={["super_admin", "sales_manager", "sales_agent", "technician"]}>
        {(company) => <CustomerList tenantId={company.tenantId} />}
      </CompanyPage>
    </ConfiguredOnly>
  );
}
