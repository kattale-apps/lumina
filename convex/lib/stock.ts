import { ConvexError } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { recordAudit } from "./audit";

/** Roles that move stock. Reading availability is open to every member. */
export const STOCK_ADMINS = ["super_admin", "inventory_admin"] as const;
/** Roles that may place holds, e.g. while preparing a quotation. */
export const RESERVERS = [
  "super_admin",
  "inventory_admin",
  "sales_manager",
  "sales_agent"
] as const;

const MAX_QUANTITY = 1_000_000_000;

export function requireQuantity(value: number, label = "Quantity") {
  if (!Number.isInteger(value) || value < 1 || value > MAX_QUANTITY) {
    throw new ConvexError(`${label} must be a whole number between 1 and ${MAX_QUANTITY.toLocaleString()}.`);
  }
  return value;
}

export function cleanOptional(raw: string | undefined, label: string, max: number) {
  const text = raw?.trim();
  if (!text) return undefined;
  if (text.length > max) throw new ConvexError(`${label} must be ${max} characters or fewer.`);
  return text;
}

export function cleanKey(raw: string | undefined) {
  const key = raw?.trim();
  if (!key) return undefined;
  if (key.length > 64) throw new ConvexError("The request key is too long.");
  return key;
}

export async function loadProduct(ctx: QueryCtx, tenantId: Id<"tenants">, productId: Id<"products">) {
  const product = await ctx.db.get(productId);
  if (!product || product.tenantId !== tenantId) throw new ConvexError("Product not found.");
  return product;
}

export async function loadWarehouse(ctx: QueryCtx, tenantId: Id<"tenants">, warehouseId: Id<"warehouses">) {
  const warehouse = await ctx.db.get(warehouseId);
  if (!warehouse || warehouse.tenantId !== tenantId) throw new ConvexError("Warehouse not found.");
  return warehouse;
}

export function requireStockable(product: Doc<"products">, warehouse: Doc<"warehouses">) {
  if (product.status !== "active") throw new ConvexError("This product is archived.");
  if (warehouse.status !== "active") throw new ConvexError(`Warehouse ${warehouse.code} is inactive.`);
}

export async function getBalance(
  ctx: QueryCtx,
  productId: Id<"products">,
  warehouseId: Id<"warehouses">
) {
  return await ctx.db
    .query("stockBalances")
    .withIndex("by_product_warehouse", (q) =>
      q.eq("productId", productId).eq("warehouseId", warehouseId)
    )
    .unique();
}

/** Units held by reservations that are still active and have not expired. */
export async function activeReserved(
  ctx: QueryCtx,
  productId: Id<"products">,
  warehouseId: Id<"warehouses">,
  now = Date.now()
) {
  const holds = await ctx.db
    .query("stockReservations")
    .withIndex("by_product_warehouse", (q) =>
      q.eq("productId", productId).eq("warehouseId", warehouseId).eq("status", "active")
    )
    .collect();
  return holds.filter((h) => h.expiresAt > now).reduce((sum, h) => sum + h.quantity, 0);
}

export async function findByKey(ctx: QueryCtx, tenantId: Id<"tenants">, key: string | undefined) {
  if (!key) return null;
  return await ctx.db
    .query("stockMovements")
    .withIndex("by_tenant_key", (q) => q.eq("tenantId", tenantId).eq("idempotencyKey", key))
    .first();
}

type Movement = {
  tenantId: Id<"tenants">;
  product: Doc<"products">;
  warehouse: Doc<"warehouses">;
  type: Doc<"stockMovements">["type"];
  delta: number;
  reference?: string;
  reason?: string;
  transferId?: string;
  idempotencyKey?: string;
  /** Removals may not cut into units reserved for someone else. */
  protectReserved: boolean;
};

/**
 * The only place stock changes. Updates the balance and appends the ledger
 * entry in the same transaction, and refuses to go negative.
 */
export async function postMovement(
  ctx: MutationCtx,
  actor: Doc<"userProfiles">,
  m: Movement
) {
  const now = Date.now();
  const balance = await getBalance(ctx, m.product._id, m.warehouse._id);
  const onHand = balance?.onHand ?? 0;
  const next = onHand + m.delta;

  if (next < 0) {
    throw new ConvexError(
      `Not enough stock in ${m.warehouse.code}: ${onHand} on hand, ${-m.delta} requested.`
    );
  }
  if (m.delta < 0 && m.protectReserved) {
    const reserved = await activeReserved(ctx, m.product._id, m.warehouse._id, now);
    if (next < reserved) {
      throw new ConvexError(
        `Only ${Math.max(onHand - reserved, 0)} available in ${m.warehouse.code}; ${reserved} reserved.`
      );
    }
  }

  if (balance) await ctx.db.patch(balance._id, { onHand: next, updatedAt: now });
  else {
    await ctx.db.insert("stockBalances", {
      tenantId: m.tenantId,
      productId: m.product._id,
      warehouseId: m.warehouse._id,
      onHand: next,
      updatedAt: now
    });
  }

  const movementId = await ctx.db.insert("stockMovements", {
    tenantId: m.tenantId,
    productId: m.product._id,
    warehouseId: m.warehouse._id,
    type: m.type,
    quantity: m.delta,
    balanceAfter: next,
    reference: m.reference,
    reason: m.reason,
    transferId: m.transferId,
    idempotencyKey: m.idempotencyKey,
    createdAt: now,
    createdBy: actor.authSubject,
    actorUserId: actor._id
  });

  await recordAudit(ctx, actor, {
    tenantId: m.tenantId,
    action: `stock.${m.type}`,
    entityType: "stockMovements",
    entityId: movementId,
    summary: `${m.delta > 0 ? "+" : ""}${m.delta} ${m.product.sku} in ${m.warehouse.code} (${m.type}).`,
    metadata: {
      before: { onHand },
      after: { onHand: next },
      reference: m.reference,
      reason: m.reason,
      transferId: m.transferId
    }
  });
  return { movementId, balanceAfter: next };
}
