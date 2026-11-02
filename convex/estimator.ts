import { ConvexError, v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { mutation, query, type QueryCtx } from "./_generated/server";
import { recordAudit } from "./lib/audit";
import { requireTenantMembership } from "./lib/auth";
import { DEFAULT_APPLIANCES } from "./lib/applianceDefaults";
import {
  ESTIMATE_ENGINE_VERSION,
  optionsFor,
  PUBLIC_ASSUMPTIONS,
  summariseAppliances,
  summariseBill,
  templateByKey,
  toPublicOption,
  type ApplianceInput,
  type GridAvailability,
  type ProductLabel,
  type PublicOption
} from "./lib/estimate";
import { currencyExponent, toMinorUnits } from "./lib/money";
import { buildCandidates, computeRequirements, type CatalogueItem } from "./lib/sizing";
import { validateLine } from "./lib/load";
import { optionalText, validateOptionalEmail, validatePhone } from "./lib/crm";
import { requireText } from "./lib/validation";

/** Public, unauthenticated limits. Convex gives no IP address, so limits are per phone and overall. */
const MAX_ITEMS = 30;
const MAX_REQUESTS_PER_PHONE_PER_DAY = 3;
const MAX_REQUESTS_PER_HOUR = 300;
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

const SETTINGS_ADMINS = ["super_admin"] as const;
const SETTINGS_READERS = ["super_admin", "sales_manager"] as const;

const gridArg = v.union(v.literal("none"), v.literal("unreliable"), v.literal("reliable"));

const estimateInput = v.union(
  v.object({
    mode: v.literal("bill"),
    units: v.number(),
    days: v.number(),
    // What the customer paid for those units, in whole currency units (e.g. UGX).
    amount: v.optional(v.number())
  }),
  v.object({
    mode: v.literal("appliances"),
    items: v.array(v.object({ name: v.string(), quantity: v.number(), hoursPerDay: v.number() })),
    // Optional: the customer's own price per kWh instead of the company default.
    ratePerKwh: v.optional(v.number())
  })
);
type EstimateInput = typeof estimateInput.type;

/** The one company that has switched the public power check on, with its settings. */
async function publicCompany(ctx: QueryCtx) {
  const settings = await ctx.db
    .query("publicEstimatorSettings")
    .withIndex("by_enabled", (q) => q.eq("enabled", true))
    .first();
  if (!settings) return null;
  const tenant = await ctx.db.get(settings.tenantId);
  if (!tenant || tenant.status !== "active") return null;
  return { settings, tenant };
}

type LibraryAppliance = ApplianceInput & { category: string };

async function libraryFor(ctx: QueryCtx, tenant: Doc<"tenants">): Promise<LibraryAppliance[]> {
  const rows = await ctx.db
    .query("appliances")
    .withIndex("by_tenant", (q) => q.eq("tenantId", tenant._id))
    .collect();
  const active = rows.filter((a) => a.status === "active");
  const source = active.length > 0 ? active : DEFAULT_APPLIANCES;
  return source
    .map((a) => ({
      name: a.name,
      category: a.category,
      quantity: 1,
      hoursPerDay: a.typicalHoursPerDay,
      powerW: a.powerW,
      surgeW: a.surgeW,
      powerFactor: a.powerFactor,
      currentType: a.currentType
    }))
    .sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));
}

function positive(n: number, label: string, max: number) {
  if (!Number.isFinite(n) || n <= 0 || n > max) throw new ConvexError(`${label} must be above 0 and at most ${max}.`);
  return n;
}

async function compute(
  ctx: QueryCtx,
  company: { settings: Doc<"publicEstimatorSettings">; tenant: Doc<"tenants"> },
  input: EstimateInput,
  grid: GridAvailability
) {
  const { settings, tenant } = company;
  const currency = tenant.defaultCurrency;
  const exponent = currencyExponent(currency);

  let built;
  if (input.mode === "bill") {
    const units = positive(input.units, "Units", 100_000);
    const days = positive(input.days, "Number of days", 366);
    const amountMinor = input.amount === undefined ? undefined : toMinorUnits(positive(input.amount, "Amount", 1e10), currency);
    built = summariseBill({ units, days, amountMinor }, settings.tariffMinorPerKwh);
  } else {
    if (input.items.length === 0) throw new ConvexError("Choose at least one appliance.");
    if (input.items.length > MAX_ITEMS) throw new ConvexError(`Choose at most ${MAX_ITEMS} appliances.`);
    const library = await libraryFor(ctx, tenant);
    const byName = new Map(library.map((a) => [a.name, a]));
    const seen = new Set<string>();
    const items: ApplianceInput[] = input.items.map((item) => {
      const base = byName.get(item.name);
      if (!base) throw new ConvexError(`${item.name.slice(0, 40)} is not in the appliance list.`);
      if (seen.has(item.name)) throw new ConvexError(`${item.name} is listed twice.`);
      seen.add(item.name);
      if (!Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > 100) {
        throw new ConvexError(`${item.name}: quantity must be a whole number from 1 to 100.`);
      }
      const hours = positive(item.hoursPerDay, `${item.name}: hours per day`, 24);
      return { ...base, quantity: item.quantity, hoursPerDay: hours };
    });
    const rate =
      input.ratePerKwh === undefined
        ? settings.tariffMinorPerKwh
        : toMinorUnits(positive(input.ratePerKwh, "Price per kWh", 1e7), currency);
    built = summariseAppliances(items, rate);
  }
  for (const line of built.lines) {
    const problem = validateLine(line);
    if (problem) throw new ConvexError(problem);
  }

  const categories = await ctx.db
    .query("productCategories")
    .withIndex("by_tenant", (q) => q.eq("tenantId", tenant._id))
    .collect();
  const keyOf = new Map(categories.map((c) => [c._id, c.key]));
  const products = await ctx.db
    .query("products")
    .withIndex("by_tenant", (q) => q.eq("tenantId", tenant._id))
    .collect();
  const active = products.filter((p) => p.status === "active");
  const catalogue: CatalogueItem[] = active
    .map((p) => ({
      id: p._id as string,
      sku: p.sku,
      name: p.name,
      categoryKey: keyOf.get(p.categoryId) ?? "",
      specSchemaVersion: p.specSchemaVersion,
      specValues: p.specValues
    }))
    .sort((a, b) => a.sku.localeCompare(b.sku));
  const labels = new Map<string, ProductLabel>(
    active.map((p) => [p._id as string, { name: p.name, brand: p.brand, model: p.model }])
  );

  const options: PublicOption[] = [];
  const unavailable: string[] = [];
  const optionInputs = new Map<string, { systemType: string; backupHours?: number; autonomyDays?: number }>();
  for (const template of optionsFor(grid)) {
    const sizingInputs = {
      systemType: template.systemType,
      backupHours: template.backupHours,
      autonomyDays: template.autonomyDays,
      lines: built.lines
    };
    const requirements = computeRequirements(sizingInputs, PUBLIC_ASSUMPTIONS);
    const outcome = buildCandidates(sizingInputs, requirements, PUBLIC_ASSUMPTIONS, catalogue);
    const best = outcome.candidates[0];
    if (!best) {
      unavailable.push(template.title);
      continue;
    }
    options.push(toPublicOption(template, best, catalogue, labels, built.summary, PUBLIC_ASSUMPTIONS));
    optionInputs.set(template.key, sizingInputs);
  }

  return {
    engineVersion: ESTIMATE_ENGINE_VERSION,
    currency,
    exponent,
    summary: built.summary,
    options,
    unavailable,
    lines: built.lines,
    optionInputs
  };
}

/** What the public page needs to start: company name, currency and the appliance list. */
export const publicConfig = query({
  args: {},
  handler: async (ctx) => {
    const company = await publicCompany(ctx);
    if (!company) return { enabled: false as const };
    const library = await libraryFor(ctx, company.tenant);
    return {
      enabled: true as const,
      companyName: company.tenant.name,
      currency: company.tenant.defaultCurrency,
      exponent: currencyExponent(company.tenant.defaultCurrency),
      tariffMinorPerKwh: company.settings.tariffMinorPerKwh,
      contactPhone: company.settings.contactPhone ?? null,
      contactEmail: company.settings.contactEmail ?? null,
      appliances: library.map((a) => ({
        name: a.name,
        category: a.category,
        powerW: a.powerW,
        defaultHours: a.hoursPerDay
      }))
    };
  }
});

/** Power use, running cost and solar options for a customer. Components only, never prices. */
export const recommend = query({
  args: { input: estimateInput, grid: gridArg },
  handler: async (ctx, args) => {
    const company = await publicCompany(ctx);
    if (!company) throw new ConvexError("The power check is not available right now.");
    const { lines: _lines, optionInputs: _inputs, ...result } = await compute(ctx, company, args.input, args.grid);
    return result;
  }
});

export const submitRequest = mutation({
  args: {
    input: estimateInput,
    grid: gridArg,
    optionKey: v.string(),
    name: v.string(),
    phone: v.string(),
    email: v.optional(v.string()),
    location: v.string(),
    // Real people leave this empty; bots tend to fill every field.
    website: v.optional(v.string())
  },
  handler: async (ctx, args) => {
    if (args.website) return { ok: true as const };
    const company = await publicCompany(ctx);
    if (!company) throw new ConvexError("Quote requests are not open right now.");
    const { tenant } = company;

    const name = requireText(args.name, "Name", 100);
    const phone = validatePhone(args.phone);
    const email = validateOptionalEmail(args.email);
    const location = requireText(args.location, "Location", 200);
    if (!templateByKey(args.optionKey)) throw new ConvexError("Choose one of the options.");

    const now = Date.now();
    const recent = await ctx.db
      .query("quoteRequests")
      .withIndex("by_tenant_phone_time", (q) =>
        q.eq("tenantId", tenant._id).eq("phone", phone).gte("createdAt", now - DAY)
      )
      .collect();
    if (recent.length >= MAX_REQUESTS_PER_PHONE_PER_DAY) {
      throw new ConvexError("We already have your requests. Our team will contact you.");
    }
    const lastHour = await ctx.db
      .query("quoteRequests")
      .withIndex("by_tenant_time", (q) => q.eq("tenantId", tenant._id).gte("createdAt", now - HOUR))
      .collect();
    if (lastHour.length >= MAX_REQUESTS_PER_HOUR) {
      throw new ConvexError("We are receiving a lot of requests. Please try again later.");
    }

    // The server recomputes everything: nothing the browser sends about the option is trusted.
    const result = await compute(ctx, company, args.input, args.grid);
    const option = result.options.find((o) => o.key === args.optionKey);
    const sizing = result.optionInputs.get(args.optionKey);
    if (!option || !sizing) throw new ConvexError("That option is not available. Please choose another.");

    const id = await ctx.db.insert("quoteRequests", {
      tenantId: tenant._id,
      name,
      phone,
      email,
      location,
      gridAvailability: args.grid,
      inputMode: result.summary.basis,
      dailyKwh: result.summary.dailyKwh,
      costPerMonthMinor: result.summary.costPerMonthMinor ?? undefined,
      systemType: sizing.systemType as Doc<"quoteRequests">["systemType"],
      backupHours: sizing.backupHours,
      autonomyDays: sizing.autonomyDays,
      optionKey: option.key,
      optionTitle: option.title,
      components: option.components,
      lines: result.lines.map((l) => ({
        name: l.name,
        quantity: l.quantity,
        powerW: l.powerW,
        powerSource: "estimate" as const,
        powerFactor: l.powerFactor,
        surgeW: l.surgeW,
        dutyFactor: l.dutyFactor,
        dutyJustification: l.dutyFactor !== undefined ? "Customer-reported hours per day." : undefined,
        currentType: l.currentType,
        critical: false,
        windows: l.windows
      })),
      status: "new",
      createdAt: now,
      updatedAt: now
    });
    return { ok: true as const, requestId: id };
  }
});

export const getEstimatorSettings = query({
  args: { tenantId: v.id("tenants") },
  handler: async (ctx, args) => {
    const { tenant } = await requireTenantMembership(ctx, args.tenantId, SETTINGS_READERS);
    const row = await ctx.db
      .query("publicEstimatorSettings")
      .withIndex("by_tenant", (q) => q.eq("tenantId", tenant._id))
      .unique();
    return {
      currency: tenant.defaultCurrency,
      exponent: currencyExponent(tenant.defaultCurrency),
      enabled: row?.enabled ?? false,
      tariffMinorPerKwh: row?.tariffMinorPerKwh ?? 0,
      contactPhone: row?.contactPhone ?? "",
      contactEmail: row?.contactEmail ?? ""
    };
  }
});

export const updateEstimatorSettings = mutation({
  args: {
    tenantId: v.id("tenants"),
    enabled: v.boolean(),
    // Whole currency units per kWh as typed by the admin.
    tariffPerKwh: v.number(),
    contactPhone: v.optional(v.string()),
    contactEmail: v.optional(v.string())
  },
  handler: async (ctx, args) => {
    const { profile, tenant } = await requireTenantMembership(ctx, args.tenantId, SETTINGS_ADMINS);
    const tariffMinorPerKwh = toMinorUnits(args.tariffPerKwh, tenant.defaultCurrency);
    if (args.enabled && tariffMinorPerKwh <= 0) {
      throw new ConvexError("Set the price per kWh before switching the power check on.");
    }
    const contactPhone = args.contactPhone?.trim() ? validatePhone(args.contactPhone) : undefined;
    const contactEmail = validateOptionalEmail(args.contactEmail);

    if (args.enabled) {
      const other = await ctx.db
        .query("publicEstimatorSettings")
        .withIndex("by_enabled", (q) => q.eq("enabled", true))
        .first();
      if (other && other.tenantId !== tenant._id) {
        throw new ConvexError("Another company already runs the public power check.");
      }
    }

    const existing = await ctx.db
      .query("publicEstimatorSettings")
      .withIndex("by_tenant", (q) => q.eq("tenantId", tenant._id))
      .unique();
    const fields = {
      enabled: args.enabled,
      tariffMinorPerKwh,
      contactPhone: optionalText(contactPhone, "Phone", 30),
      contactEmail,
      updatedAt: Date.now(),
      updatedBy: profile.authSubject
    };
    const id = existing
      ? (await ctx.db.patch(existing._id, fields), existing._id)
      : await ctx.db.insert("publicEstimatorSettings", { tenantId: tenant._id, ...fields });
    await recordAudit(ctx, profile, {
      tenantId: tenant._id,
      action: "estimator.settings",
      entityType: "publicEstimatorSettings",
      entityId: id,
      summary: `Public power check ${args.enabled ? "enabled" : "disabled"}; tariff ${args.tariffPerKwh} per kWh.`
    });
    return { changed: true };
  }
});
