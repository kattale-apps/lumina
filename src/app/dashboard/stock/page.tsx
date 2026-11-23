"use client";

import { useState, type FormEvent } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { CompanyPage, ConfiguredOnly, errorMessage } from "../workspace";
import { Pager, pageFor } from "../../../components/Pager";
import { amountText, ProductEditor } from "./ProductEditor";

const STOCK_PAGE_SIZE = 25;

type Overview = NonNullable<ReturnType<typeof useQuery<typeof api.stock.stockOverview>>>;
type Notice = { ok: boolean; text: string } | null;
type MovementKind = "receive" | "issue" | "adjust" | "transfer";

const KIND_LABELS: Record<MovementKind, string> = {
  receive: "Receive stock",
  issue: "Issue / dispatch",
  adjust: "Adjust (stock-take, damage, loss)",
  transfer: "Transfer between warehouses"
};

const TYPE_LABELS: Record<string, string> = {
  receipt: "Received",
  issue: "Issued",
  adjustment: "Adjusted",
  transfer_out: "Transferred out",
  transfer_in: "Transferred in"
};

function NoticeText({ notice }: { notice: Notice }) {
  if (!notice) return null;
  return (
    <p className={notice.ok ? "form-success" : "auth-message"} role="status">
      {notice.text}
    </p>
  );
}

/** A fresh key per form attempt: retries of the same attempt cannot post twice. */
const newKey = () => crypto.randomUUID();

function MovementForm({ tenantId, overview }: { tenantId: Id<"tenants">; overview: Overview }) {
  const receive = useMutation(api.stock.receiveStock);
  const issue = useMutation(api.stock.issueStock);
  const adjust = useMutation(api.stock.adjustStock);
  const transfer = useMutation(api.stock.transferStock);

  const activeWarehouses = overview.warehouses.filter((w) => w.status === "active");
  const [kind, setKind] = useState<MovementKind>("receive");
  const [productId, setProductId] = useState("");
  const [warehouseId, setWarehouseId] = useState("");
  const [toWarehouseId, setToWarehouseId] = useState("");
  const [quantity, setQuantity] = useState("");
  const [reason, setReason] = useState("");
  const [reference, setReference] = useState("");
  const [key, setKey] = useState(newKey);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setNotice(null);
    try {
      const base = {
        tenantId,
        productId: productId as Id<"products">,
        reference,
        idempotencyKey: key
      };
      const wh = warehouseId as Id<"warehouses">;
      const qty = Number(quantity);
      let result;
      if (kind === "receive") result = await receive({ ...base, warehouseId: wh, quantity: qty });
      else if (kind === "issue") result = await issue({ ...base, warehouseId: wh, quantity: qty });
      else if (kind === "adjust") result = await adjust({ ...base, warehouseId: wh, delta: qty, reason });
      else {
        result = await transfer({
          ...base,
          fromWarehouseId: wh,
          toWarehouseId: toWarehouseId as Id<"warehouses">,
          quantity: qty
        });
      }
      setNotice({
        ok: true,
        text: result.duplicate
          ? "That request was already recorded."
          : `Recorded. Balance in the source warehouse is now ${result.balanceAfter}.`
      });
      setQuantity("");
      setReason("");
      setReference("");
      setKey(newKey());
    } catch (error) {
      // The key is kept so pressing the button again cannot double-post.
      setNotice({ ok: false, text: errorMessage(error) });
    } finally {
      setBusy(false);
    }
  }

  if (overview.items.length === 0 || activeWarehouses.length === 0) {
    return (
      <p className="muted">
        Add at least one product and one active warehouse before recording stock.
      </p>
    );
  }

  return (
    <form className="panel-form" onSubmit={submit}>
      <h2>Record a stock movement</h2>

      <label htmlFor="mv-kind">Movement</label>
      <select id="mv-kind" value={kind} onChange={(e) => setKind(e.target.value as MovementKind)}>
        {Object.entries(KIND_LABELS).map(([value, text]) => (
          <option key={value} value={value}>
            {text}
          </option>
        ))}
      </select>

      <label htmlFor="mv-product">Product</label>
      <select id="mv-product" required value={productId} onChange={(e) => setProductId(e.target.value)}>
        <option value="">Choose a product…</option>
        {overview.items
          .filter((i) => i.status === "active" || kind === "issue" || kind === "adjust")
          .map((item) => (
            <option key={item.productId} value={item.productId}>
              {item.name} ({item.sku})
            </option>
          ))}
      </select>

      <label htmlFor="mv-wh">{kind === "transfer" ? "From warehouse" : "Warehouse"}</label>
      <select id="mv-wh" required value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)}>
        <option value="">Choose a warehouse…</option>
        {(kind === "issue" || kind === "adjust" || kind === "transfer"
          ? overview.warehouses
          : activeWarehouses
        ).map((w) => (
          <option key={w.id} value={w.id}>
            {w.name} ({w.code})
          </option>
        ))}
      </select>

      {kind === "transfer" ? (
        <>
          <label htmlFor="mv-to">To warehouse</label>
          <select id="mv-to" required value={toWarehouseId} onChange={(e) => setToWarehouseId(e.target.value)}>
            <option value="">Choose a warehouse…</option>
            {activeWarehouses
              .filter((w) => w.id !== warehouseId)
              .map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name} ({w.code})
                </option>
              ))}
          </select>
        </>
      ) : null}

      <label htmlFor="mv-qty">
        {kind === "adjust" ? "Change in quantity (negative to remove)" : "Quantity"}
      </label>
      <input
        id="mv-qty"
        type="number"
        required
        step={1}
        min={kind === "adjust" ? undefined : 1}
        inputMode="numeric"
        value={quantity}
        onChange={(e) => setQuantity(e.target.value)}
      />

      {kind === "adjust" ? (
        <>
          <label htmlFor="mv-reason">Reason</label>
          <input id="mv-reason" required maxLength={200} value={reason} onChange={(e) => setReason(e.target.value)} />
        </>
      ) : null}

      <label htmlFor="mv-ref">Reference (optional)</label>
      <input
        id="mv-ref"
        maxLength={80}
        placeholder="PO, delivery note or invoice number"
        value={reference}
        onChange={(e) => setReference(e.target.value)}
      />

      <NoticeText notice={notice} />
      <button className="button" type="submit" disabled={busy}>
        {busy ? "Recording…" : "Record movement"}
      </button>
    </form>
  );
}

function ReserveForm({ tenantId, overview }: { tenantId: Id<"tenants">; overview: Overview }) {
  const reserve = useMutation(api.stock.reserveStock);
  const [productId, setProductId] = useState("");
  const [warehouseId, setWarehouseId] = useState("");
  const [quantity, setQuantity] = useState("");
  const [hours, setHours] = useState("48");
  const [reference, setReference] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const active = overview.warehouses.filter((w) => w.status === "active");

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setNotice(null);
    try {
      await reserve({
        tenantId,
        productId: productId as Id<"products">,
        warehouseId: warehouseId as Id<"warehouses">,
        quantity: Number(quantity),
        hours: Number(hours),
        reference
      });
      setNotice({ ok: true, text: "Stock reserved." });
      setQuantity("");
      setReference("");
    } catch (error) {
      setNotice({ ok: false, text: errorMessage(error) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="panel-form" onSubmit={submit}>
      <h2>Reserve stock</h2>
      <p className="hint">
        A reservation holds stock for a limited time without removing it. It frees itself when it
        expires.
      </p>
      <label htmlFor="rs-product">Product</label>
      <select id="rs-product" required value={productId} onChange={(e) => setProductId(e.target.value)}>
        <option value="">Choose a product…</option>
        {overview.items
          .filter((i) => i.status === "active" && i.totalAvailable > 0)
          .map((item) => (
            <option key={item.productId} value={item.productId}>
              {item.name} ({item.sku}) · {item.totalAvailable} available
            </option>
          ))}
      </select>
      <label htmlFor="rs-wh">Warehouse</label>
      <select id="rs-wh" required value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)}>
        <option value="">Choose a warehouse…</option>
        {active.map((w) => (
          <option key={w.id} value={w.id}>
            {w.name} ({w.code})
          </option>
        ))}
      </select>
      <label htmlFor="rs-qty">Quantity</label>
      <input id="rs-qty" type="number" required min={1} step={1} inputMode="numeric" value={quantity} onChange={(e) => setQuantity(e.target.value)} />
      <label htmlFor="rs-hours">Hold for (hours)</label>
      <input id="rs-hours" type="number" required min={1} max={720} step={1} inputMode="numeric" value={hours} onChange={(e) => setHours(e.target.value)} />
      <label htmlFor="rs-ref">Reference (optional)</label>
      <input id="rs-ref" maxLength={80} value={reference} onChange={(e) => setReference(e.target.value)} />
      <NoticeText notice={notice} />
      <button className="button" type="submit" disabled={busy}>
        {busy ? "Reserving…" : "Reserve"}
      </button>
    </form>
  );
}

function Reservations({ tenantId }: { tenantId: Id<"tenants"> }) {
  const holds = useQuery(api.stock.listReservations, { tenantId });
  const release = useMutation(api.stock.releaseReservation);
  const [error, setError] = useState("");

  if (!holds) return null;
  return (
    <section aria-labelledby="holds-heading" className="workspace-section">
      <h2 id="holds-heading">Active reservations ({holds.length})</h2>
      {error ? (
        <p className="auth-message" role="alert">
          {error}
        </p>
      ) : null}
      {holds.length === 0 ? (
        <p className="muted">No active reservations.</p>
      ) : (
        <ul className="record-list">
          {holds.map((hold) => (
            <li className="record-card" key={hold.id}>
              <div>
                <span className="record-title">
                  {hold.quantity} × {hold.productName}{" "}
                  <span className="record-code">{hold.sku}</span>
                </span>
                <span className="record-meta">
                  {hold.warehouseCode} · expires {new Date(hold.expiresAt).toLocaleString()}
                  {hold.reference ? ` · ${hold.reference}` : ""}
                </span>
              </div>
              <div className="record-actions">
                <button
                  type="button"
                  className="button button-secondary button-small"
                  onClick={async () => {
                    setError("");
                    try {
                      await release({ reservationId: hold.id });
                    } catch (e) {
                      setError(errorMessage(e));
                    }
                  }}
                >
                  Release
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Ledger({ tenantId }: { tenantId: Id<"tenants"> }) {
  const movements = useQuery(api.stock.listMovements, { tenantId, limit: 30 });
  if (!movements) return null;
  return (
    <section aria-labelledby="ledger-heading" className="workspace-section">
      <h2 id="ledger-heading">Recent movements</h2>
      {movements.length === 0 ? (
        <p className="muted">No stock movements yet.</p>
      ) : (
        <ul className="record-list">
          {movements.map((m) => (
            <li className="record-card" key={m.id}>
              <div>
                <span className="record-title">
                  {TYPE_LABELS[m.type] ?? m.type}: {m.quantity > 0 ? "+" : ""}
                  {m.quantity} {m.sku}
                </span>
                <span className="record-meta">
                  {m.warehouseCode} · balance {m.balanceAfter} · {m.actor} ·{" "}
                  {new Date(m.at).toLocaleString()}
                </span>
                {m.reference || m.reason ? (
                  <span className="record-meta">{[m.reference, m.reason].filter(Boolean).join(" · ")}</span>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Stock({ tenantId }: { tenantId: Id<"tenants"> }) {
  const overview = useQuery(api.stock.stockOverview, { tenantId });
  const [search, setSearch] = useState("");
  const [inStockOnly, setInStockOnly] = useState(false);
  const [paging, setPaging] = useState({ key: "", page: 1 });
  const [editing, setEditing] = useState<string | null>(null);
  if (!overview) return <p className="muted">Loading stock…</p>;

  const term = search.trim().toLowerCase();
  const shown = overview.items.filter(
    (i) => (!term || `${i.name} ${i.sku} ${i.categoryName}`.toLowerCase().includes(term)) && (!inStockOnly || i.totalAvailable > 0)
  );
  const filterKey = `${term}|${inStockOnly}`;
  const pageCount = Math.ceil(shown.length / STOCK_PAGE_SIZE);
  const page = pageFor(paging, filterKey, pageCount);
  const onPage = shown.slice((page - 1) * STOCK_PAGE_SIZE, page * STOCK_PAGE_SIZE);
  function goTo(next: number) {
    setPaging({ key: filterKey, page: next });
    document.getElementById("levels-heading")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  return (
    <>
      <p className="muted">
        Available = on hand minus live reservations. Quotations never deduct stock; stock is
        deducted only when it is actually issued.
      </p>

      <section aria-labelledby="levels-heading" className="workspace-section">
        <h2 id="levels-heading">
          Stock levels ({shown.length === overview.items.length ? overview.items.length : `${shown.length} of ${overview.items.length}`})
        </h2>
        <div className="filter-row">
          <label htmlFor="stock-search">Search</label>
          <input id="stock-search" type="search" placeholder="Name, SKU or category" value={search} onChange={(e) => setSearch(e.target.value)} />
          <label>
            <input type="checkbox" checked={inStockOnly} onChange={(e) => setInStockOnly(e.target.checked)} /> In stock only
          </label>
        </div>
        {overview.items.length === 0 ? (
          <p className="muted">No products yet.</p>
        ) : shown.length === 0 ? (
          <p className="muted">No products match.</p>
        ) : (
          <>
          <ul className="record-list">
            {onPage.map((item) => (
              <li className="product-card" key={item.productId}>
                <div className="field-head">
                  <div>
                    <span className="record-title">{item.name}</span>
                    <span className="record-meta">
                      <span className="record-code">{item.sku}</span> · {item.categoryName}
                    </span>
                    {item.status === "archived" ? <span className="pill pill-warn">Archived</span> : null}
                  </div>
                  <div className="price-block">
                    <span className="price">{item.totalAvailable}</span>
                    <span className="record-meta">Available</span>
                    {item.price ? <span className="record-meta">{item.price.currency} {amountText(item.price.listMinor)}{item.price.fixed ? " (fixed)" : ""}</span> : null}
                    {overview.canManage ? (
                      <button type="button" className="button button-small button-secondary stock-edit-toggle" aria-expanded={editing === item.productId} onClick={() => setEditing(editing === item.productId ? null : item.productId)}>
                        {editing === item.productId ? "Close" : "Edit"}
                      </button>
                    ) : null}
                  </div>
                </div>
                {item.rows.length > 0 ? (
                  <dl className="spec-list">
                    {item.rows.map((row) => (
                      <div key={row.warehouseId}>
                        <dt>
                          {row.warehouseName} ({row.warehouseCode})
                        </dt>
                        <dd>
                          {row.onHand !== null
                            ? `${row.onHand} on hand · ${row.reserved} reserved · ${row.available} available`
                            : `${row.available} available`}
                        </dd>
                      </div>
                    ))}
                  </dl>
                ) : (
                  <p className="hint">No stock held.</p>
                )}
                {overview.canManage && editing === item.productId ? <ProductEditor key={item.productId} tenantId={tenantId} item={item} overview={overview} /> : null}
              </li>
            ))}
          </ul>
          <Pager page={page} pageCount={pageCount} onPage={goTo} />
          </>
        )}
      </section>

      {overview.canManage ? <MovementForm tenantId={tenantId} overview={overview} /> : null}
      {overview.canReserve ? <ReserveForm tenantId={tenantId} overview={overview} /> : null}
      {overview.canReserve ? <Reservations tenantId={tenantId} /> : null}
      {overview.canManage ? <Ledger tenantId={tenantId} /> : null}
    </>
  );
}

export default function StockPage() {
  return (
    <ConfiguredOnly>
      <CompanyPage title="Stock">{(company) => <Stock tenantId={company.tenantId} />}</CompanyPage>
    </ConfiguredOnly>
  );
}
