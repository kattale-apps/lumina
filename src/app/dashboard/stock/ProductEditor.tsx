"use client";

import Link from "next/link";
import { useState } from "react";
import { useMutation } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { errorMessage } from "../workspace";

type Overview = FunctionReturnType<typeof api.stock.stockOverview>;
type Item = Overview["items"][number];
type Notice = { ok: boolean; text: string } | null;

export const amountText = (n: number) => n.toLocaleString("en-US");
const digitsOf = (text: string) => Number(text.replace(/[^\d]/g, "")) || 0;
/** A fresh key per attempt: a retried click cannot post a movement twice. */
const newKey = () => crypto.randomUUID();

/**
 * Change a product's selling price, availability for sale, location (warehouse) and stock count,
 * straight from the stock list. Shown to stock administrators (super admin, inventory admin) only;
 * the server checks the role again for every change.
 */
export function ProductEditor({ tenantId, item, overview }: { tenantId: Id<"tenants">; item: Item; overview: Overview }) {
  const setPrice = useMutation(api.stock.setSellingPrice);
  const setAvailability = useMutation(api.stock.setProductAvailability);
  const transfer = useMutation(api.stock.transferStock);
  const adjust = useMutation(api.stock.adjustStock);
  const active = overview.warehouses.filter((w) => w.status === "active");
  const held = item.rows.filter((r) => (r.onHand ?? 0) > 0);

  const [price, setPriceText] = useState(item.price ? amountText(item.price.listMinor) : "");
  // Where stock is moved from: the chosen warehouse while it still holds stock, else the first that does.
  const [fromChoice, setFrom] = useState<string>("");
  const from = held.some((r) => r.warehouseId === fromChoice) ? fromChoice : (held[0]?.warehouseId ?? "");
  const [to, setTo] = useState("");
  const [moveChoice, setMoveQty] = useState<string | null>(null);
  const moveQty = moveChoice ?? String(item.rows.find((r) => r.warehouseId === from)?.available ?? "");
  const [countWh, setCountWh] = useState<string>(item.rows[0]?.warehouseId ?? active[0]?.id ?? "");
  const countRow = item.rows.find((r) => r.warehouseId === countWh);
  // The count box shows the current count until someone types a new one.
  const [countChoice, setCount] = useState<string | null>(null);
  const count = countChoice ?? String(countRow?.onHand ?? 0);
  const [reason, setReason] = useState("Stock count");
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const forSale = item.status === "active";

  async function run(label: string, action: () => Promise<string>) {
    setBusy(label);
    setNotice(null);
    try {
      setNotice({ ok: true, text: await action() });
    } catch (error) {
      setNotice({ ok: false, text: errorMessage(error) });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="stock-editor">
      <section className="stock-edit-block">
        <h3>Selling price</h3>
        <p className="hint">
          {item.price
            ? `Now ${item.price.currency} ${amountText(item.price.listMinor)} · ${item.price.fixed ? "fixed price" : "cost plus margin"}`
            : "No price yet: no cost and margin, and no fixed price."}
        </p>
        <div className="stock-edit-row">
          <label className="visually-hidden" htmlFor={`price-${item.productId}`}>Selling price</label>
          <input
            id={`price-${item.productId}`}
            inputMode="numeric"
            placeholder="e.g. 1,250,000"
            value={price}
            onChange={(e) => setPriceText(digitsOf(e.target.value) ? amountText(digitsOf(e.target.value)) : "")}
          />
          <button
            type="button"
            className="button button-small"
            disabled={busy !== null || digitsOf(price) <= 0}
            onClick={() =>
              run("price", async () => {
                const r = await setPrice({ productId: item.productId, price: digitsOf(price) });
                return r.changed ? `Selling price set to ${amountText(digitsOf(price))}.` : "That is already the price.";
              })
            }
          >
            {busy === "price" ? "Saving…" : "Set price"}
          </button>
          {item.price?.fixed ? (
            <button
              type="button"
              className="button button-small button-secondary"
              disabled={busy !== null}
              onClick={() =>
                run("clear", async () => {
                  await setPrice({ productId: item.productId, price: null });
                  return "Back to cost plus margin.";
                })
              }
            >
              Use cost plus margin
            </button>
          ) : null}
        </div>
        <p className="hint">A fixed price replaces cost plus margin in quotations, the shop and recommendations.</p>
      </section>

      <section className="stock-edit-block">
        <h3>Availability</h3>
        <p className="hint">
          {forSale
            ? "Available for sale: it appears in quotations, the shop and the energy checks."
            : "Off sale: hidden from quotations, the shop and the energy checks. Stock records are kept."}
        </p>
        <div className="stock-edit-row">
          <button
            type="button"
            className={`button button-small${forSale ? " button-secondary" : ""}`}
            disabled={busy !== null}
            onClick={() =>
              run("sale", async () => {
                await setAvailability({ productId: item.productId, forSale: !forSale });
                return forSale ? "Taken off sale." : "Available for sale again.";
              })
            }
          >
            {busy === "sale" ? "Saving…" : forSale ? "Take off sale" : "Make available for sale"}
          </button>
        </div>
      </section>

      <section className="stock-edit-block">
        <h3>Location</h3>
        {!forSale ? (
          <p className="hint">Make it available for sale to move its stock.</p>
        ) : active.length < 2 ? (
          <p className="hint">
            Stock can be moved once there are two active warehouses. <Link href="/dashboard/warehouses"><u>Warehouses</u></Link>
          </p>
        ) : held.length === 0 ? (
          <p className="hint">No stock to move yet. Set a stock count below first.</p>
        ) : (
          <div className="stock-edit-row">
            <span>Move</span>
            <input
              className="stock-qty"
              aria-label="Quantity to move"
              inputMode="numeric"
              value={moveQty}
              onChange={(e) => setMoveQty(e.target.value.replace(/[^\d]/g, ""))}
            />
            <span>from</span>
            <select
              aria-label="Move from"
              value={from}
              onChange={(e) => {
                setFrom(e.target.value);
                setMoveQty(null);
              }}
            >
              {held.map((r) => (
                <option key={r.warehouseId} value={r.warehouseId}>
                  {r.warehouseName} ({r.available} free)
                </option>
              ))}
            </select>
            <span>to</span>
            <select aria-label="Move to" value={to} onChange={(e) => setTo(e.target.value)}>
              <option value="">Choose…</option>
              {active
                .filter((w) => w.id !== from)
                .map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
            </select>
            <button
              type="button"
              className="button button-small"
              disabled={busy !== null || !to || Number(moveQty) <= 0}
              onClick={() =>
                run("move", async () => {
                  await transfer({
                    tenantId,
                    productId: item.productId,
                    fromWarehouseId: from as Id<"warehouses">,
                    toWarehouseId: to as Id<"warehouses">,
                    quantity: Number(moveQty),
                    reference: "Moved from the stock list",
                    idempotencyKey: newKey()
                  });
                  setMoveQty(null);
                  return `Moved ${moveQty} to ${active.find((w) => w.id === to)?.name ?? "the new location"}.`;
                })
              }
            >
              {busy === "move" ? "Moving…" : "Move"}
            </button>
          </div>
        )}
      </section>

      <section className="stock-edit-block">
        <h3>Stock count</h3>
        <p className="hint">Set how many are on hand in a warehouse, e.g. after counting. The difference is recorded as an adjustment.</p>
        {overview.warehouses.length === 0 ? (
          <p className="hint">
            No warehouses yet. <Link href="/dashboard/warehouses"><u>Add a warehouse</u></Link> first, then set the count here.
          </p>
        ) : (
        <div className="stock-edit-row">
          <select
            aria-label="Warehouse"
            value={countWh}
            onChange={(e) => {
              setCountWh(e.target.value);
              setCount(null);
            }}
          >
            {overview.warehouses.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </select>
          <input className="stock-qty" aria-label="On hand" inputMode="numeric" value={count} onChange={(e) => setCount(e.target.value.replace(/[^\d]/g, ""))} />
          <input aria-label="Reason" maxLength={200} value={reason} onChange={(e) => setReason(e.target.value)} />
          <button
            type="button"
            className="button button-small"
            disabled={busy !== null || count === "" || !reason.trim()}
            onClick={() =>
              run("count", async () => {
                const delta = Number(count) - (countRow?.onHand ?? 0);
                if (delta === 0) return "No change: that is already the count.";
                await adjust({ tenantId, productId: item.productId, warehouseId: countWh as Id<"warehouses">, delta, reason, reference: "", idempotencyKey: newKey() });
                setCount(null);
                return `On hand set to ${count}.`;
              })
            }
          >
            {busy === "count" ? "Saving…" : "Set count"}
          </button>
        </div>
        )}
      </section>
      {notice ? (
        <p className={notice.ok ? "form-success" : "auth-message"} role="status">
          {notice.text}
        </p>
      ) : null}
    </div>
  );
}
