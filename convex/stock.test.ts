/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.*s");
type T = ReturnType<typeof convexTest>;

async function registerUser(t: T, email: string) {
  return await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", { email });
    await ctx.db.insert("userProfiles", {
      authSubject: userId, email, displayName: email.split("@")[0], status: "active",
      createdAt: Date.now(), updatedAt: Date.now()
    });
    return { subject: `${userId}|test-session` };
  });
}

type ExtraRole = "inventory_admin" | "sales_agent" | "technician" | "sales_manager";

/** A company with a product and two warehouses, plus optional staff. */
async function setup(extra: { email: string; role: ExtraRole }[] = []) {
  const t = convexTest(schema, modules);
  const owner = await registerUser(t, "owner@acme.ug");
  const { tenantId } = await t.mutation(internal.admin.bootstrapTenant, {
    companyName: "Acme", slug: "acme", adminEmail: "owner@acme.ug"
  });
  const people: Record<string, { subject: string }> = {};
  for (const { email, role } of extra) {
    people[email] = await registerUser(t, email);
    await t.mutation(internal.admin.grantMembership, { tenantSlug: "acme", email, role });
  }
  const asOwner = t.withIdentity({ subject: owner.subject });
  await asOwner.mutation(api.catalogue.loadStandardCategories, { tenantId });
  const panel = (await asOwner.query(api.catalogue.listCategories, { tenantId })).categories.find(
    (c) => c.key === "pv_panel"
  )!;
  const { productId } = await asOwner.mutation(api.products.createProduct, {
    tenantId, categoryId: panel.id, name: "Panel 550W", brand: "Jinko", model: "J550", sku: "PV-550",
    specValues: { rated_power: 550, voc: 49.9, vmp: 41.8, isc: 14, imp: 13.2 }
  });
  const { warehouseId: main } = await asOwner.mutation(api.settings.createWarehouse, {
    tenantId, name: "Main", code: "MAIN"
  });
  const { warehouseId: depot } = await asOwner.mutation(api.settings.createWarehouse, {
    tenantId, name: "Depot", code: "DEP"
  });
  const as = (email: string) => t.withIdentity({ subject: people[email].subject });
  return { t, tenantId, asOwner, productId, main, depot, as };
}

type Ctx = Awaited<ReturnType<typeof setup>>;
const level = async (c: Ctx, warehouseId: Ctx["main"]) => {
  const view = await c.asOwner.query(api.stock.stockOverview, { tenantId: c.tenantId });
  return view.items[0].rows.find((r) => r.warehouseId === warehouseId);
};
const receive = (c: Ctx, quantity: number, warehouseId = c.main, extra: Record<string, unknown> = {}) =>
  c.asOwner.mutation(api.stock.receiveStock, {
    tenantId: c.tenantId, productId: c.productId, warehouseId, quantity, ...extra
  });

describe("receiving, issuing and adjusting", () => {
  test("receipts and issues update the balance and append to the ledger", async () => {
    const c = await setup();
    await receive(c, 50, c.main, { reference: "PO-1001" });
    await c.asOwner.mutation(api.stock.issueStock, {
      tenantId: c.tenantId, productId: c.productId, warehouseId: c.main, quantity: 8, reference: "INV-7"
    });
    expect(await level(c, c.main)).toMatchObject({ onHand: 42, reserved: 0, available: 42 });

    const ledger = await c.asOwner.query(api.stock.listMovements, { tenantId: c.tenantId });
    expect(ledger.map((m) => [m.type, m.quantity, m.balanceAfter, m.reference])).toEqual([
      ["issue", -8, 42, "INV-7"],
      ["receipt", 50, 50, "PO-1001"]
    ]);
    expect(ledger[0]).toMatchObject({ sku: "PV-550", warehouseCode: "MAIN", actor: "owner" });

    const actions = (await c.t.run((ctx) => ctx.db.query("auditEvents").collect())).map((e) => e.action);
    expect(actions).toEqual(expect.arrayContaining(["stock.receipt", "stock.issue"]));
  });

  test("stock can never go negative", async () => {
    const c = await setup();
    await receive(c, 5);
    await expect(
      c.asOwner.mutation(api.stock.issueStock, {
        tenantId: c.tenantId, productId: c.productId, warehouseId: c.main, quantity: 6
      })
    ).rejects.toThrow(/Not enough stock in MAIN: 5 on hand, 6 requested/);
    await expect(
      c.asOwner.mutation(api.stock.adjustStock, {
        tenantId: c.tenantId, productId: c.productId, warehouseId: c.main, delta: -6, reason: "Count"
      })
    ).rejects.toThrow(/Not enough stock/);
    await expect(
      c.asOwner.mutation(api.stock.issueStock, {
        tenantId: c.tenantId, productId: c.productId, warehouseId: c.depot, quantity: 1
      })
    ).rejects.toThrow(/Not enough stock in DEP: 0 on hand/);
    expect((await level(c, c.main))?.onHand).toBe(5);
  });

  test("adjustments need a reason and a non-zero whole number", async () => {
    const c = await setup();
    await receive(c, 10);
    const adjust = (over: Record<string, unknown>) =>
      c.asOwner.mutation(api.stock.adjustStock, {
        tenantId: c.tenantId, productId: c.productId, warehouseId: c.main, delta: -1, reason: "Damaged", ...over
      } as never);

    await expect(adjust({ reason: "  " })).rejects.toThrow(/reason is required/);
    await expect(adjust({ delta: 0 })).rejects.toThrow(/non-zero/);
    await expect(adjust({ delta: 1.5 })).rejects.toThrow(/non-zero whole number/);
    await adjust({ delta: -3, reason: "Cracked in store" });
    await adjust({ delta: 2, reason: "Stock-take found extra" });
    expect((await level(c, c.main))?.onHand).toBe(9);
    const ledger = await c.asOwner.query(api.stock.listMovements, { tenantId: c.tenantId });
    expect(ledger.filter((m) => m.type === "adjustment").map((m) => m.reason)).toEqual([
      "Stock-take found extra", "Cracked in store"
    ]);
  });

  test("quantities must be whole numbers within range", async () => {
    const c = await setup();
    for (const quantity of [0, -1, 1.5, 2_000_000_000, Number.NaN]) {
      await expect(receive(c, quantity)).rejects.toThrow(/whole number/);
    }
  });

  test("archived products and inactive warehouses cannot receive stock", async () => {
    const c = await setup();
    await c.asOwner.mutation(api.settings.updateWarehouse, {
      warehouseId: c.depot, name: "Depot", code: "DEP", status: "inactive"
    });
    await expect(receive(c, 1, c.depot)).rejects.toThrow(/inactive/);

    await c.asOwner.mutation(api.products.updateProduct, {
      productId: c.productId, name: "Panel 550W", brand: "Jinko", model: "J550", sku: "PV-550",
      specValues: { rated_power: 550, voc: 49.9, vmp: 41.8, isc: 14, imp: 13.2 }, status: "archived"
    });
    await expect(receive(c, 1)).rejects.toThrow(/archived/);
  });

  test("the ledger always reconciles to the balance", async () => {
    const c = await setup();
    await receive(c, 100);
    await c.asOwner.mutation(api.stock.issueStock, { tenantId: c.tenantId, productId: c.productId, warehouseId: c.main, quantity: 30 });
    await c.asOwner.mutation(api.stock.adjustStock, { tenantId: c.tenantId, productId: c.productId, warehouseId: c.main, delta: -5, reason: "Loss" });
    await c.asOwner.mutation(api.stock.transferStock, { tenantId: c.tenantId, productId: c.productId, fromWarehouseId: c.main, toWarehouseId: c.depot, quantity: 20 });

    const sums = await c.t.run(async (ctx) => {
      const out: Record<string, number> = {};
      for (const m of await ctx.db.query("stockMovements").collect()) {
        out[m.warehouseId] = (out[m.warehouseId] ?? 0) + m.quantity;
      }
      const balances = await ctx.db.query("stockBalances").collect();
      return balances.map((b) => [out[b.warehouseId], b.onHand]);
    });
    for (const [ledgerSum, onHand] of sums) expect(ledgerSum).toBe(onHand);
    expect([(await level(c, c.main))?.onHand, (await level(c, c.depot))?.onHand]).toEqual([45, 20]);
  });
});

describe("transfers", () => {
  test("move stock atomically as two paired ledger entries", async () => {
    const c = await setup();
    await receive(c, 30);
    await c.asOwner.mutation(api.stock.transferStock, {
      tenantId: c.tenantId, productId: c.productId, fromWarehouseId: c.main, toWarehouseId: c.depot, quantity: 12
    });
    expect((await level(c, c.main))?.onHand).toBe(18);
    expect((await level(c, c.depot))?.onHand).toBe(12);

    const legs = await c.t.run(async (ctx) =>
      (await ctx.db.query("stockMovements").collect()).filter((m) => m.type.startsWith("transfer"))
    );
    expect(legs).toHaveLength(2);
    expect(legs[0].transferId).toBeDefined();
    expect(legs[0].transferId).toBe(legs[1].transferId);
    expect(legs.map((l) => l.quantity).sort((a, b) => a - b)).toEqual([-12, 12]);
  });

  test("fail whole when stock is short or the warehouses are the same", async () => {
    const c = await setup();
    await receive(c, 3);
    const move = (over: Record<string, unknown>) =>
      c.asOwner.mutation(api.stock.transferStock, {
        tenantId: c.tenantId, productId: c.productId, fromWarehouseId: c.main, toWarehouseId: c.depot, quantity: 1, ...over
      } as never);
    await expect(move({ quantity: 4 })).rejects.toThrow(/Not enough stock/);
    await expect(move({ toWarehouseId: c.main })).rejects.toThrow(/two different warehouses/);
    expect((await level(c, c.main))?.onHand).toBe(3);
    expect(await c.t.run((ctx) => ctx.db.query("stockMovements").collect())).toHaveLength(1);
  });
});

describe("idempotency", () => {
  test("a retried request with the same key posts only once", async () => {
    const c = await setup();
    const first = await receive(c, 10, c.main, { idempotencyKey: "form-abc" });
    const retry = await receive(c, 10, c.main, { idempotencyKey: "form-abc" });
    expect(first.duplicate).toBe(false);
    expect(retry).toMatchObject({ duplicate: true, movementId: first.movementId });
    expect((await level(c, c.main))?.onHand).toBe(10);

    await receive(c, 5, c.main, { idempotencyKey: "form-def" });
    expect((await level(c, c.main))?.onHand).toBe(15);

    const issue = () =>
      c.asOwner.mutation(api.stock.issueStock, {
        tenantId: c.tenantId, productId: c.productId, warehouseId: c.main, quantity: 4, idempotencyKey: "issue-1"
      });
    await issue();
    expect((await issue()).duplicate).toBe(true);
    expect((await level(c, c.main))?.onHand).toBe(11);
  });
});

describe("reservations", () => {
  const reserve = (c: Ctx, quantity: number, over: Record<string, unknown> = {}) =>
    c.asOwner.mutation(api.stock.reserveStock, {
      tenantId: c.tenantId, productId: c.productId, warehouseId: c.main, quantity, hours: 24, ...over
    } as never);

  test("reduce availability but not on-hand, and cannot exceed what is available", async () => {
    const c = await setup();
    await receive(c, 10);
    await reserve(c, 6, { reference: "QT-1" });
    expect(await level(c, c.main)).toMatchObject({ onHand: 10, reserved: 6, available: 4 });
    await expect(reserve(c, 5)).rejects.toThrow(/Only 4 available in MAIN/);
    await reserve(c, 4);
    expect((await level(c, c.main))?.available).toBe(0);
    await expect(reserve(c, 1)).rejects.toThrow(/Only 0 available/);
    await expect(reserve(c, 1, { hours: 0 })).rejects.toThrow(/Hold for between/);
  });

  test("issues and adjustments cannot cut into reserved stock", async () => {
    const c = await setup();
    await receive(c, 10);
    await reserve(c, 7);
    const issue = (quantity: number) =>
      c.asOwner.mutation(api.stock.issueStock, {
        tenantId: c.tenantId, productId: c.productId, warehouseId: c.main, quantity
      });
    await expect(issue(4)).rejects.toThrow(/Only 3 available in MAIN; 7 reserved/);
    await issue(3);
    await expect(
      c.asOwner.mutation(api.stock.transferStock, {
        tenantId: c.tenantId, productId: c.productId, fromWarehouseId: c.main, toWarehouseId: c.depot, quantity: 1
      })
    ).rejects.toThrow(/reserved/);
    expect(await level(c, c.main)).toMatchObject({ onHand: 7, reserved: 7, available: 0 });
  });

  test("expired reservations stop holding stock; releasing frees it immediately", async () => {
    const c = await setup();
    await receive(c, 10);
    const { reservationId } = await reserve(c, 10);
    expect((await level(c, c.main))?.available).toBe(0);

    await c.t.run((ctx) => ctx.db.patch(reservationId, { expiresAt: Date.now() - 1000 }));
    expect(await level(c, c.main)).toMatchObject({ reserved: 0, available: 10 });
    expect(await c.asOwner.query(api.stock.listReservations, { tenantId: c.tenantId })).toEqual([]);

    const second = await reserve(c, 4);
    expect((await level(c, c.main))?.available).toBe(6);
    expect(await c.asOwner.mutation(api.stock.releaseReservation, { reservationId: second.reservationId })).toEqual({ changed: true });
    expect(await c.asOwner.mutation(api.stock.releaseReservation, { reservationId: second.reservationId })).toEqual({ changed: false });
    expect((await level(c, c.main))?.available).toBe(10);
  });

  test("issuing against a reservation fulfils it and deducts exactly its quantity", async () => {
    const c = await setup();
    await receive(c, 10);
    const { reservationId } = await reserve(c, 6);
    await reserve(c, 2);

    const issue = (over: Record<string, unknown>) =>
      c.asOwner.mutation(api.stock.issueStock, {
        tenantId: c.tenantId, productId: c.productId, warehouseId: c.main, reservationId, ...over
      } as never);

    await expect(issue({ quantity: 5 })).rejects.toThrow(/must match the reserved quantity/);
    await expect(issue({ warehouseId: c.depot })).rejects.toThrow(/different product or warehouse/);
    await issue({});
    expect(await level(c, c.main)).toMatchObject({ onHand: 4, reserved: 2, available: 2 });
    await expect(issue({})).rejects.toThrow(/already fulfilled/);
  });

  test("an expired reservation cannot be fulfilled", async () => {
    const c = await setup();
    await receive(c, 5);
    const { reservationId } = await reserve(c, 5);
    await c.t.run((ctx) => ctx.db.patch(reservationId, { expiresAt: Date.now() - 1 }));
    await expect(
      c.asOwner.mutation(api.stock.issueStock, {
        tenantId: c.tenantId, productId: c.productId, warehouseId: c.main, reservationId
      })
    ).rejects.toThrow(/expired/);
    expect((await level(c, c.main))?.onHand).toBe(5);
  });
});

describe("visibility and permissions", () => {
  const staff = [
    { email: "agent@acme.ug", role: "sales_agent" as const },
    { email: "other@acme.ug", role: "sales_agent" as const },
    { email: "tech@acme.ug", role: "technician" as const },
    { email: "mgr@acme.ug", role: "sales_manager" as const },
    { email: "stock@acme.ug", role: "inventory_admin" as const }
  ];

  test("agents see availability only; exact counts and the ledger are admin-only", async () => {
    const c = await setup(staff);
    await receive(c, 10);
    await c.asOwner.mutation(api.stock.reserveStock, {
      tenantId: c.tenantId, productId: c.productId, warehouseId: c.main, quantity: 4, hours: 24
    });

    const view = await c.as("agent@acme.ug").query(api.stock.stockOverview, { tenantId: c.tenantId });
    expect(view.canManage).toBe(false);
    expect(view.items[0].totalAvailable).toBe(6);
    expect(view.items[0].rows[0]).toMatchObject({ onHand: null, reserved: null, available: 6 });
    expect(JSON.stringify(view)).not.toContain('"onHand":10');

    await expect(c.as("agent@acme.ug").query(api.stock.listMovements, { tenantId: c.tenantId })).rejects.toThrow(/role does not permit/);
    expect((await c.as("stock@acme.ug").query(api.stock.stockOverview, { tenantId: c.tenantId })).canManage).toBe(true);
  });

  test("only stock administrators can move stock", async () => {
    const c = await setup(staff);
    for (const who of ["agent@acme.ug", "mgr@acme.ug", "tech@acme.ug"]) {
      await expect(
        c.as(who).mutation(api.stock.receiveStock, { tenantId: c.tenantId, productId: c.productId, warehouseId: c.main, quantity: 1 })
      ).rejects.toThrow(/role does not permit/);
      await expect(
        c.as(who).mutation(api.stock.adjustStock, { tenantId: c.tenantId, productId: c.productId, warehouseId: c.main, delta: 1, reason: "x" })
      ).rejects.toThrow(/role does not permit/);
    }
    await c.as("stock@acme.ug").mutation(api.stock.receiveStock, {
      tenantId: c.tenantId, productId: c.productId, warehouseId: c.main, quantity: 3
    });
  });

  test("sales roles can reserve and release their own holds; technicians cannot reserve", async () => {
    const c = await setup(staff);
    await receive(c, 10);
    const args = { tenantId: c.tenantId, productId: c.productId, warehouseId: c.main, quantity: 2, hours: 12 };

    const mine = await c.as("agent@acme.ug").mutation(api.stock.reserveStock, args);
    await expect(c.as("tech@acme.ug").mutation(api.stock.reserveStock, args)).rejects.toThrow(/role does not permit/);

    // Another agent can neither see nor release it; a manager cannot release it either.
    expect(await c.as("other@acme.ug").query(api.stock.listReservations, { tenantId: c.tenantId })).toEqual([]);
    await expect(c.as("other@acme.ug").mutation(api.stock.releaseReservation, { reservationId: mine.reservationId })).rejects.toThrow(/your own/);
    await expect(c.as("mgr@acme.ug").mutation(api.stock.releaseReservation, { reservationId: mine.reservationId })).rejects.toThrow(/your own/);

    expect(await c.as("agent@acme.ug").query(api.stock.listReservations, { tenantId: c.tenantId })).toHaveLength(1);
    expect(await c.as("stock@acme.ug").query(api.stock.listReservations, { tenantId: c.tenantId })).toHaveLength(1);
    expect(await c.as("agent@acme.ug").mutation(api.stock.releaseReservation, { reservationId: mine.reservationId })).toEqual({ changed: true });

    // An administrator can release anyone's hold.
    const again = await c.as("agent@acme.ug").mutation(api.stock.reserveStock, args);
    expect(await c.as("stock@acme.ug").mutation(api.stock.releaseReservation, { reservationId: again.reservationId })).toEqual({ changed: true });
  });

  test("companies are isolated from each other's stock", async () => {
    const c = await setup();
    await receive(c, 10);
    const rival = await registerUser(c.t, "rival@other.ug");
    const { tenantId: otherTenant } = await c.t.mutation(internal.admin.bootstrapTenant, {
      companyName: "Other", slug: "other", adminEmail: "rival@other.ug"
    });
    const asRival = c.t.withIdentity({ subject: rival.subject });

    expect((await asRival.query(api.stock.stockOverview, { tenantId: otherTenant })).items).toEqual([]);
    await expect(asRival.query(api.stock.stockOverview, { tenantId: c.tenantId })).rejects.toThrow(/access/);
    await expect(
      asRival.mutation(api.stock.receiveStock, { tenantId: otherTenant, productId: c.productId, warehouseId: c.main, quantity: 1 })
    ).rejects.toThrow(/not found/);
    await expect(
      asRival.mutation(api.stock.receiveStock, { tenantId: c.tenantId, productId: c.productId, warehouseId: c.main, quantity: 1 })
    ).rejects.toThrow(/access/);
  });
});
