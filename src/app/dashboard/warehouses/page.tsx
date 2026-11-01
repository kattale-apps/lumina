"use client";

import { useState, type FormEvent } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { CompanyPage, ConfiguredOnly, errorMessage } from "../workspace";

function AddWarehouse({ tenantId }: { tenantId: Id<"tenants"> }) {
  const create = useMutation(api.settings.createWarehouse);
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [location, setLocation] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setNotice(null);
    try {
      await create({ tenantId, name, code, location });
      setNotice({ ok: true, text: "Warehouse added." });
      setName("");
      setCode("");
      setLocation("");
    } catch (error) {
      setNotice({ ok: false, text: errorMessage(error) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="panel-form" onSubmit={submit}>
      <h2>Add a warehouse</h2>
      <label htmlFor="wh-name">Name</label>
      <input id="wh-name" required maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />
      <label htmlFor="wh-code">Code</label>
      <input
        id="wh-code"
        required
        maxLength={20}
        placeholder="KLA-MAIN"
        autoCapitalize="characters"
        value={code}
        onChange={(e) => setCode(e.target.value.toUpperCase())}
      />
      <p className="hint">A short unique code used on stock records. It cannot be reused.</p>
      <label htmlFor="wh-location">Location (optional)</label>
      <input
        id="wh-location"
        maxLength={160}
        value={location}
        onChange={(e) => setLocation(e.target.value)}
      />
      {notice ? (
        <p className={notice.ok ? "form-success" : "auth-message"} role="status">
          {notice.text}
        </p>
      ) : null}
      <button className="button" type="submit" disabled={busy}>
        {busy ? "Adding…" : "Add warehouse"}
      </button>
    </form>
  );
}

function WarehouseList({ tenantId }: { tenantId: Id<"tenants"> }) {
  const data = useQuery(api.settings.listWarehouses, { tenantId });
  const update = useMutation(api.settings.updateWarehouse);
  const [error, setError] = useState("");

  if (!data) return <p className="muted">Loading warehouses…</p>;

  return (
    <>
      {data.canManage ? <AddWarehouse tenantId={tenantId} /> : null}
      <section aria-labelledby="wh-heading" className="workspace-section">
        <h2 id="wh-heading">Warehouses ({data.warehouses.length})</h2>
        {error ? (
          <p className="auth-message" role="alert">
            {error}
          </p>
        ) : null}
        {data.warehouses.length === 0 ? (
          <p className="muted">
            No warehouses yet.{data.canManage ? " Add your first one above." : ""}
          </p>
        ) : (
          <ul className="record-list">
            {data.warehouses.map((warehouse) => (
              <li className="record-card" key={warehouse.id}>
                <div>
                  <span className="record-title">
                    {warehouse.name} <span className="record-code">{warehouse.code}</span>
                  </span>
                  {warehouse.location ? (
                    <span className="record-meta">{warehouse.location}</span>
                  ) : null}
                  {warehouse.status === "inactive" ? (
                    <span className="pill pill-warn">inactive</span>
                  ) : null}
                </div>
                {data.canManage ? (
                  <div className="record-actions">
                    <button
                      type="button"
                      className="button button-secondary button-small"
                      onClick={async () => {
                        setError("");
                        try {
                          await update({
                            warehouseId: warehouse.id,
                            name: warehouse.name,
                            code: warehouse.code,
                            location: warehouse.location,
                            status: warehouse.status === "active" ? "inactive" : "active"
                          });
                        } catch (e) {
                          setError(errorMessage(e));
                        }
                      }}
                    >
                      {warehouse.status === "active" ? "Deactivate" : "Activate"}
                    </button>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}

export default function WarehousesPage() {
  return (
    <ConfiguredOnly>
      <CompanyPage title="Warehouses">
        {(company) => <WarehouseList tenantId={company.tenantId} />}
      </CompanyPage>
    </ConfiguredOnly>
  );
}
