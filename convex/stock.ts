import { ConvexError, v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { mutation, query } from "./_generated/server";
import { recordAudit } from "./lib/audit";
import { requireTenantMembership } from "./lib/auth";
import {
  RESERVERS,
  STOCK_ADMINS,
  activeReserved,
  cleanKey,
  cleanOptional,
  findByKey,
  getBalance,
  loadProduct,
  loadWarehouse,
  postMovement,
  requireQuantity,
  requireStockable
} from "./lib/stock";
import { requireText } from "./lib/validation";

const MAX_ROWS = 3000;
const MAX_HOLD_HOURS = 24 * 30;

/**
 * Availability for everyone; exact on-hand and reserved counts for stock
 * administrators only. Available = on hand minus live reservations.
 */
export const stockOverview = query({
  args: { tenantId: v.id("tenants") },
  handler: async (ctx, args) => {
    const { membership } = await requireTenantMembership(ctx, args.tenantId);
    const admin = (STOCK_ADMINS as readonly string[]).includes(membership.role);
    const now = Date.now();

    const warehouses = (
      await ctx.db
        .query("warehouses")
        .withIndex("by_tenant", (q) => q.eq("tenantId", args.tenantId))
        .collect()
    )
      .filter((w) => admin || w.status === "active")
      .sort((a, b) => a.name.localeCompare(b.name));
    const warehouseIds = new Set(warehouses.map((w) => w._id));

    const balances = await ctx.db
      .query("stockBalances")
      .withIndex("by_tenant", (q) => q.eq("tenantId", args.tenantId))
      .take(MAX_ROWS);
    const holds = await ctx.db
      .query("stockReservations")
      .withIndex("by_tenant_status", (q) => q.eq("tenantId", args.tenantId).eq("status", "active"))
      .take(MAX_ROWS);

    const reserved = new Map<string, number>();
    for (const hold of holds) {
      if (hold.expiresAt <= now) continue;
      const key = `${hold.productId}:${hold.warehouseId}`;
      reserved.set(key, (reserved.get(key) ?? 0) + hold.quantity);
    }

    const products = await ctx.db
      .query("products")
      .withIndex("by_tenant", (q) => q.eq("tenantId", args.tenantId))
      .take(MAX_ROWS);
    const onHandAt = new Map(balances.map((b) => [`${b.productId}:${b.warehouseId}`, b.onHand]));
    const categories = new Map<string, string>();

    const items = [];
    for (const product of products) {
      if (!admin && product.status !== "active") continue;
      if (!categories.has(product.categoryId)) {
        categories.set(product.categoryId, (await ctx.db.get(product.categoryId))?.name ?? "");
      }

      const rows = [];
      let totalAvailable = 0;
      for (const warehouse of warehouses) {
        if (!warehouseIds.has(warehouse._id)) continue;
        const onHand = onHandAt.get(`${product._id}:${warehouse._id}`) ?? 0;
        const held = reserved.get(`${product._id}:${warehouse._id}`) ?? 0;
        const available = Math.max(onHand - held, 0);
        if (warehouse.status === "active") totalAvailable += available;
        if (!admin && onHand === 0) continue;
        rows.push({
          warehouseId: warehouse._id,
          warehouseCode: warehouse.code,
          warehouseName: warehouse.name,
          onHand: admin ? onHand : null,
          reserved: admin ? held : null,
          available
        });
      }
      items.push({
        productId: product._id,
        name: product.name,
        sku: product.sku,
        categoryName: categories.get(product.categoryId) ?? "",
        status: product.status,
        totalAvailable,
        rows
      });
    }

    return {
      canManage: admin,
      canReserve: (RESERVERS as readonly string[]).includes(membership.role),
      warehouses: warehouses.map((w) => ({
        id: w._id,
        code: w.code,
        name: w.name,
        status: w.status
      })),
      items: items.sort((a, b) => a.name.localeCompare(b.name))
    };
  }
});

export const listMovements = query({
  args: {
    tenantId: v.id("tenants"),
    productId: v.optional(v.id("products")),
    limit: v.optional(v.number())
  },
  handler: async (ctx, args) => {
    await requireTenantMembership(ctx, args.tenantId, STOCK_ADMINS);
    const limit = Math.min(Math.max(Math.floor(args.limit ?? 30), 1), 100);

    const { productId } = args;
    const rows = productId
      ? await ctx.db
          .query("stockMovements")
          .withIndex("by_product_time", (q) => q.eq("productId", productId))
          .order("desc")
          .take(limit)
      : await ctx.db
          .query("stockMovements")
          .withIndex("by_tenant_time", (q) => q.eq("tenantId", args.tenantId))
          .order("desc")
          .take(limit);

    const out = [];
    for (const row of rows) {
      if (row.tenantId !== args.tenantId) continue;
      const [product, warehouse, actor] = await Promise.all([
        ctx.db.get(row.productId),
        ctx.db.get(row.warehouseId),
        ctx.db.get(row.actorUserId)
      ]);
      out.push({
        id: row._id,
        at: row.createdAt,
        type: row.type,
        quantity: row.quantity,
        balanceAfter: row.balanceAfter,
        reference: row.reference ?? "",
        reason: row.reason ?? "",
        sku: product?.sku ?? "",
        productName: product?.name ?? "",
        warehouseCode: warehouse?.code ?? "",
        actor: actor?.displayName ?? ""
      });
    }
    return out;
  }
});

const movementArgs = {
  tenantId: v.id("tenants"),
  productId: v.id("products"),
  warehouseId: v.id("warehouses"),
  reference: v.optional(v.string()),
  idempotencyKey: v.optional(v.string())
};

export const receiveStock = mutation({
  args: { ...movementArgs, quantity: v.number() },
  handler: async (ctx, args) => {
    const { profile } = await requireTenantMembership(ctx, args.tenantId, STOCK_ADMINS);
    const key = cleanKey(args.idempotencyKey);
    const repeat = await findByKey(ctx, args.tenantId, key);
    if (repeat) return { movementId: repeat._id, balanceAfter: repeat.balanceAfter, duplicate: true };

    const quantity = requireQuantity(args.quantity);
    const product = await loadProduct(ctx, args.tenantId, args.productId);
    const warehouse = await loadWarehouse(ctx, args.tenantId, args.warehouseId);
    requireStockable(product, warehouse);

    const posted = await postMovement(ctx, profile, {
      tenantId: args.tenantId,
      product,
      warehouse,
      type: "receipt",
      delta: quantity,
      reference: cleanOptional(args.reference, "Reference", 80),
      idempotencyKey: key,
      protectReserved: false
    });
    return { ...posted, duplicate: false };
  }
});

/** Deducts stock on actual issue or dispatch, optionally fulfilling a reservation. */
export const issueStock = mutation({
  args: {
    ...movementArgs,
    quantity: v.optional(v.number()),
    reservationId: v.optional(v.id("stockReservations"))
  },
  handler: async (ctx, args) => {
    const { profile } = await requireTenantMembership(ctx, args.tenantId, STOCK_ADMINS);
    const key = cleanKey(args.idempotencyKey);
    const repeat = await findByKey(ctx, args.tenantId, key);
    if (repeat) return { movementId: repeat._id, balanceAfter: repeat.balanceAfter, duplicate: true };

    const product = await loadProduct(ctx, args.tenantId, args.productId);
    const warehouse = await loadWarehouse(ctx, args.tenantId, args.warehouseId);
    const now = Date.now();

    let quantity: number;
    if (args.reservationId) {
      const hold = await ctx.db.get(args.reservationId);
      if (!hold || hold.tenantId !== args.tenantId) throw new ConvexError("Reservation not found.");
      if (hold.status !== "active") throw new ConvexError(`That reservation is already ${hold.status}.`);
      if (hold.expiresAt <= now) throw new ConvexError("That reservation has expired. Reserve the stock again.");
      if (hold.productId !== product._id || hold.warehouseId !== warehouse._id) {
        throw new ConvexError("The reservation is for a different product or warehouse.");
      }
      if (args.quantity !== undefined && args.quantity !== hold.quantity) {
        throw new ConvexError("An issue against a reservation must match the reserved quantity.");
      }
      quantity = hold.quantity;
      // Resolved first so its own units no longer count as reserved.
      await ctx.db.patch(hold._id, { status: "fulfilled", resolvedAt: now });
    } else {
      if (args.quantity === undefined) throw new ConvexError("Quantity is required.");
      quantity = requireQuantity(args.quantity);
    }

    const posted = await postMovement(ctx, profile, {
      tenantId: args.tenantId,
      product,
      warehouse,
      type: "issue",
      delta: -quantity,
      reference: cleanOptional(args.reference, "Reference", 80),
      idempotencyKey: key,
      protectReserved: true
    });
    return { ...posted, duplicate: false };
  }
});

/** Corrects the counted quantity (stock-take, damage, loss). Always needs a reason. */
export const adjustStock = mutation({
  args: { ...movementArgs, delta: v.number(), reason: v.string() },
  handler: async (ctx, args) => {
    const { profile } = await requireTenantMembership(ctx, args.tenantId, STOCK_ADMINS);
    const key = cleanKey(args.idempotencyKey);
    const repeat = await findByKey(ctx, args.tenantId, key);
    if (repeat) return { movementId: repeat._id, balanceAfter: repeat.balanceAfter, duplicate: true };

    if (!Number.isInteger(args.delta) || args.delta === 0) {
      throw new ConvexError("The adjustment must be a non-zero whole number.");
    }
    requireQuantity(Math.abs(args.delta), "Adjustment");
    const reason = requireText(args.reason, "A reason", 200);
    const product = await loadProduct(ctx, args.tenantId, args.productId);
    const warehouse = await loadWarehouse(ctx, args.tenantId, args.warehouseId);

    const posted = await postMovement(ctx, profile, {
      tenantId: args.tenantId,
      product,
      warehouse,
      type: "adjustment",
      delta: args.delta,
      reference: cleanOptional(args.reference, "Reference", 80),
      reason,
      idempotencyKey: key,
      protectReserved: true
    });
    return { ...posted, duplicate: false };
  }
});

export const transferStock = mutation({
  args: {
    tenantId: v.id("tenants"),
    productId: v.id("products"),
    fromWarehouseId: v.id("warehouses"),
    toWarehouseId: v.id("warehouses"),
    quantity: v.number(),
    reference: v.optional(v.string()),
    idempotencyKey: v.optional(v.string())
  },
  handler: async (ctx, args) => {
    const { profile } = await requireTenantMembership(ctx, args.tenantId, STOCK_ADMINS);
    const key = cleanKey(args.idempotencyKey);
    const repeat = await findByKey(ctx, args.tenantId, key);
    if (repeat) return { movementId: repeat._id, balanceAfter: repeat.balanceAfter, duplicate: true };

    if (args.fromWarehouseId === args.toWarehouseId) {
      throw new ConvexError("Choose two different warehouses.");
    }
    const quantity = requireQuantity(args.quantity);
    const product = await loadProduct(ctx, args.tenantId, args.productId);
    const from = await loadWarehouse(ctx, args.tenantId, args.fromWarehouseId);
    const to = await loadWarehouse(ctx, args.tenantId, args.toWarehouseId);
    requireStockable(product, to);

    const reference = cleanOptional(args.reference, "Reference", 80);
    const transferId = crypto.randomUUID();
    const out = await postMovement(ctx, profile, {
      tenantId: args.tenantId,
      product,
      warehouse: from,
      type: "transfer_out",
      delta: -quantity,
      reference,
      transferId,
      idempotencyKey: key,
      protectReserved: true
    });
    await postMovement(ctx, profile, {
      tenantId: args.tenantId,
      product,
      warehouse: to,
      type: "transfer_in",
      delta: quantity,
      reference,
      transferId,
      protectReserved: false
    });
    return { ...out, duplicate: false };
  }
});

export const reserveStock = mutation({
  args: {
    tenantId: v.id("tenants"),
    productId: v.id("products"),
    warehouseId: v.id("warehouses"),
    quantity: v.number(),
    hours: v.number(),
    reference: v.optional(v.string())
  },
  handler: async (ctx, args) => {
    const { profile } = await requireTenantMembership(ctx, args.tenantId, RESERVERS);

    const quantity = requireQuantity(args.quantity);
    if (!Number.isInteger(args.hours) || args.hours < 1 || args.hours > MAX_HOLD_HOURS) {
      throw new ConvexError(`Hold for between 1 and ${MAX_HOLD_HOURS} hours.`);
    }
    const product = await loadProduct(ctx, args.tenantId, args.productId);
    const warehouse = await loadWarehouse(ctx, args.tenantId, args.warehouseId);
    requireStockable(product, warehouse);

    const now = Date.now();
    const onHand = (await getBalance(ctx, product._id, warehouse._id))?.onHand ?? 0;
    const held = await activeReserved(ctx, product._id, warehouse._id, now);
    const available = onHand - held;
    if (quantity > available) {
      throw new ConvexError(`Only ${Math.max(available, 0)} available in ${warehouse.code}.`);
    }

    const reference = cleanOptional(args.reference, "Reference", 80);
    const reservationId = await ctx.db.insert("stockReservations", {
      tenantId: args.tenantId,
      productId: product._id,
      warehouseId: warehouse._id,
      quantity,
      expiresAt: now + args.hours * 3_600_000,
      status: "active",
      reference,
      createdAt: now,
      createdBy: profile.authSubject
    });
    await recordAudit(ctx, profile, {
      tenantId: args.tenantId,
      action: "stock.reserved",
      entityType: "stockReservations",
      entityId: reservationId,
      summary: `${quantity} ${product.sku} reserved in ${warehouse.code} for ${args.hours}h.`,
      metadata: { after: { quantity, hours: args.hours, reference } }
    });
    return { reservationId };
  }
});

export const releaseReservation = mutation({
  args: { reservationId: v.id("stockReservations") },
  handler: async (ctx, args) => {
    const hold = await ctx.db.get(args.reservationId);
    if (!hold) throw new ConvexError("Reservation not found.");
    const { profile, membership } = await requireTenantMembership(ctx, hold.tenantId, RESERVERS);

    const admin = (STOCK_ADMINS as readonly string[]).includes(membership.role);
    if (!admin && hold.createdBy !== profile.authSubject) {
      throw new ConvexError("You can only release your own reservations.");
    }
    if (hold.status !== "active") return { changed: false };

    await ctx.db.patch(hold._id, { status: "released", resolvedAt: Date.now() });
    await recordAudit(ctx, profile, {
      tenantId: hold.tenantId,
      action: "stock.released",
      entityType: "stockReservations",
      entityId: hold._id,
      summary: `Reservation of ${hold.quantity} released.`,
      metadata: { before: { status: "active" }, after: { status: "released" } }
    });
    return { changed: true };
  }
});

export const listReservations = query({
  args: { tenantId: v.id("tenants") },
  handler: async (ctx, args) => {
    const { profile, membership } = await requireTenantMembership(ctx, args.tenantId, RESERVERS);
    const admin = (STOCK_ADMINS as readonly string[]).includes(membership.role);
    const now = Date.now();

    const holds = await ctx.db
      .query("stockReservations")
      .withIndex("by_tenant_status", (q) => q.eq("tenantId", args.tenantId).eq("status", "active"))
      .take(200);

    const out = [];
    for (const hold of holds) {
      if (hold.expiresAt <= now) continue;
      if (!admin && hold.createdBy !== profile.authSubject) continue;
      const [product, warehouse] = await Promise.all([
        ctx.db.get(hold.productId as Id<"products">),
        ctx.db.get(hold.warehouseId as Id<"warehouses">)
      ]);
      out.push({
        id: hold._id,
        sku: product?.sku ?? "",
        productName: product?.name ?? "",
        warehouseCode: warehouse?.code ?? "",
        quantity: hold.quantity,
        expiresAt: hold.expiresAt,
        reference: hold.reference ?? "",
        mine: hold.createdBy === profile.authSubject
      });
    }
    return out.sort((a, b) => a.expiresAt - b.expiresAt);
  }
});
