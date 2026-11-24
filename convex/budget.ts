/**
 * "What can my money buy?": the public enters a budget and their appliances,
 * and sees catalogue systems that fit it, without prices. Prices are confirmed
 * by staff before anyone buys. The budget is for the main equipment only;
 * installation is not included.
 *
 * Matching runs the sizing engine many times, so it is an action: one query
 * loads the priced catalogue, and the action does the work.
 */
import { ConvexError, v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { internal } from "./_generated/api";
import { action, internalQuery, mutation, type QueryCtx } from "./_generated/server";
import {
  applianceInputs,
  applianceItem,
  assertRequestRoom,
  categoryArg,
  gridArg,
  libraryFor,
  newClaimToken,
  publicCompany,
  requestLines,
  sizingCatalogue,
  type LibraryAppliance
} from "./estimator";
import {
  budgetSystems,
  findBudgetSystem,
  groupForBudget,
  publicSystem,
  type BudgetInputs,
  type BudgetSystem,
  type BudgetSystemType,
  type PublicBudgetSystem
} from "./lib/budget";
import { summariseAppliances, type GridAvailability, type ProductLabel } from "./lib/estimate";
import { validateLine } from "./lib/load";
import { currencyExponent, toMinorUnits } from "./lib/money";
import { productPrice } from "./lib/pricing";
import type { CatalogueItem } from "./lib/sizing";
import { validateOptionalEmail, validatePhone } from "./lib/crm";
import { requireText } from "./lib/validation";
import { requesterAccount } from "./lib/requester";
import { findViewerProfile } from "./lib/auth";
import { nextWhatsapp } from "./lib/whatsappRoute";
import { linkCheck } from "./checks";

export const BUDGET_REQUEST_KEY = "budget";
const MAX_BUDGET = 10_000_000_000;
/** The parts a budget is matched on. */
const MAIN_EQUIPMENT = new Set(["inverter", "battery", "pv_panel"]);

const SYSTEM_TITLE: Record<BudgetSystemType, string> = {
  backup_only: "Battery backup charged from UEDCL (no panels)",
  hybrid: "Solar panels with battery",
  off_grid: "Full solar with battery (no grid needed)"
};

/** A design in a few words, for staff and the WhatsApp message. */
export function budgetSystemTitle(s: Pick<BudgetSystem, "level">) {
  const { systemType, backupHours, autonomyDays } = s.level;
  const storage = backupHours ? `about ${backupHours} hours of backup` : autonomyDays === 1 ? "stores a full day's use" : "stores about half a day's use";
  return `${SYSTEM_TITLE[systemType]}, ${storage}`;
}

/** The main equipment with a list price today, in the company currency. Unpriced parts are left out. */
async function pricedCatalogue(ctx: QueryCtx, tenant: Doc<"tenants">) {
  const { catalogue, labels, active } = await sizingCatalogue(ctx, tenant._id);
  const byId = new Map(active.map((p) => [p._id as string, p]));
  const prices = new Map<string, number>();
  for (const item of catalogue) {
    if (!MAIN_EQUIPMENT.has(item.categoryKey)) continue;
    const product = byId.get(item.id);
    if (!product) continue;
    const price = await productPrice(ctx, product);
    // Only the company's own currency is compared, so totals are never mixed.
    if (price && price.currency === tenant.defaultCurrency) prices.set(item.id, price.listMinor);
  }
  return { catalogue: catalogue.filter((c) => prices.has(c.id)), prices, labels };
}

type BudgetData = {
  currency: string;
  library: LibraryAppliance[];
  catalogue: CatalogueItem[];
  prices: [string, number][];
  labels: [string, ProductLabel][];
};

/** Everything the matching needs, in one read. Null when the public check is switched off. */
export const budgetData = internalQuery({
  args: {},
  handler: async (ctx): Promise<BudgetData | null> => {
    const company = await publicCompany(ctx);
    if (!company) return null;
    const { catalogue, prices, labels } = await pricedCatalogue(ctx, company.tenant);
    return {
      currency: company.tenant.defaultCurrency,
      library: await libraryFor(ctx, company.tenant),
      catalogue,
      prices: [...prices],
      labels: [...labels].filter(([id]) => prices.has(id))
    };
  }
});

function budgetMinor(amount: number, currency: string) {
  if (!Number.isFinite(amount) || amount <= 0 || amount > MAX_BUDGET) {
    throw new ConvexError("Enter your budget as an amount above 0.");
  }
  return toMinorUnits(Math.round(amount), currency);
}

function linesFor(items: (typeof applianceItem.type)[], library: LibraryAppliance[]) {
  const { lines, summary } = summariseAppliances(applianceInputs(items, library), null);
  for (const line of lines) {
    const problem = validateLine(line);
    if (problem) throw new ConvexError(problem);
  }
  return { lines, summary };
}

export type BudgetMatch = {
  currency: string;
  exponent: number;
  budgetMinor: number;
  /** "no_prices": nothing in the catalogue has a price yet, so budgets cannot be matched. */
  status: "ok" | "no_prices";
  closest: PublicBudgetSystem | null;
  best: PublicBudgetSystem[];
  below: PublicBudgetSystem[];
  above: PublicBudgetSystem[];
  smallest: PublicBudgetSystem | null;
  roomToSpare: boolean;
};

/** Systems that fit a budget, grouped. Parts and figures only: no prices are returned. */
export const budgetMatch = action({
  args: { budget: v.number(), grid: gridArg, category: categoryArg, items: v.array(applianceItem) },
  handler: async (ctx, args): Promise<BudgetMatch> => {
    const data: BudgetData | null = await ctx.runQuery(internal.budget.budgetData, {});
    if (!data) throw new ConvexError("This check is not available right now.");
    const amountMinor = budgetMinor(args.budget, data.currency);
    const { lines } = linesFor(args.items, data.library);
    const base = {
      currency: data.currency,
      exponent: currencyExponent(data.currency),
      budgetMinor: amountMinor
    };
    if (data.catalogue.length === 0) {
      return { ...base, status: "no_prices", closest: null, best: [], below: [], above: [], smallest: null, roomToSpare: false };
    }
    const inputs: BudgetInputs = {
      lines,
      grid: args.grid,
      catalogue: data.catalogue,
      prices: new Map(data.prices),
      labels: new Map(data.labels)
    };
    const groups = groupForBudget(budgetSystems(inputs), amountMinor);
    const show = (s: BudgetSystem | null) => (s ? publicSystem(s) : null);
    return {
      ...base,
      status: "ok",
      closest: show(groups.closest),
      best: groups.best.map(publicSystem),
      below: groups.below.map(publicSystem),
      above: groups.above.map(publicSystem),
      smallest: show(groups.smallest),
      roomToSpare: groups.roomToSpare
    };
  }
});

/**
 * Sends a budget request: the chosen system, or none ("Send us your budget") so a
 * technician advises. The server rebuilds the chosen system; nothing the browser
 * says about it is trusted.
 */
export const submitBudgetRequest = mutation({
  args: {
    budget: v.number(),
    grid: gridArg,
    category: categoryArg,
    items: v.array(applianceItem),
    systemKey: v.optional(v.string()),
    name: v.optional(v.string()),
    phone: v.optional(v.string()),
    email: v.optional(v.string()),
    location: v.string(),
    // Real people leave this empty; bots tend to fill every field.
    website: v.optional(v.string()),
    checkId: v.optional(v.id("publicChecks"))
  },
  handler: async (ctx, args) => {
    if (args.website) return { ok: true as const, requestId: null, hasAccount: false, claimToken: null, systemTitle: null, whatsappNumber: null };
    const company = await publicCompany(ctx);
    if (!company) throw new ConvexError("Requests are not open right now.");
    const { tenant } = company;

    const viewer = await findViewerProfile(ctx);
    const signedIn = viewer?.profile && viewer.profile.status === "active" ? viewer.profile : null;
    const account = await requesterAccount(ctx, tenant._id, signedIn, { name: args.name, phone: args.phone });
    const name = requireText(account?.name ?? signedIn?.displayName ?? args.name ?? "", "Name", 100);
    const phone = validatePhone(account?.phone ?? args.phone ?? "");
    const email = validateOptionalEmail(signedIn?.email ?? args.email);
    const location = requireText(args.location, "Location", 200);
    const amountMinor = budgetMinor(args.budget, tenant.defaultCurrency);
    const now = Date.now();
    await assertRequestRoom(ctx, tenant._id, phone, now);

    const { lines, summary } = linesFor(args.items, await libraryFor(ctx, tenant));
    let chosen: BudgetSystem | null = null;
    if (args.systemKey) {
      const { catalogue, prices, labels } = await pricedCatalogue(ctx, tenant);
      chosen = findBudgetSystem({ lines, grid: args.grid, catalogue, prices, labels }, args.systemKey);
      if (!chosen) throw new ConvexError("That system is no longer available. Please check again.");
    }
    const fallback = fallbackDesign(args.grid);

    const claimToken = account && account.tenantId === tenant._id ? undefined : newClaimToken();
    const route = await nextWhatsapp(ctx, company.settings);
    const id = await ctx.db.insert("quoteRequests", {
      tenantId: tenant._id,
      whatsappTo: route ?? undefined,
      ...(route?.userId ? { assignedToUserId: route.userId } : {}),
      category: args.category,
      customerAccountId: account && account.tenantId === tenant._id ? account._id : undefined,
      claimToken,
      name,
      phone,
      email,
      location,
      gridAvailability: args.grid,
      inputMode: "appliances",
      dailyKwh: summary.dailyKwh,
      systemType: chosen?.level.systemType ?? fallback.systemType,
      backupHours: chosen ? chosen.level.backupHours : fallback.backupHours,
      autonomyDays: chosen ? chosen.level.autonomyDays : fallback.autonomyDays,
      optionKey: BUDGET_REQUEST_KEY,
      optionTitle: chosen ? budgetSystemTitle(chosen) : "Advice on what my budget can buy",
      components: (chosen?.components ?? []) as Doc<"quoteRequests">["components"],
      lines: requestLines(lines),
      budget: { amountMinor, leavesOut: chosen?.leavesOut ?? [] },
      status: route?.userId ? "assigned" : "new",
      createdAt: now,
      updatedAt: now
    });
    if (args.checkId) await linkCheck(ctx, args.checkId, id);
    return {
      ok: true as const,
      requestId: id,
      hasAccount: claimToken === undefined,
      claimToken: claimToken ?? null,
      systemTitle: chosen ? budgetSystemTitle(chosen) : null,
      whatsappNumber: route?.number ?? null
    };
  }
});

/** Where a technician starts when no system was chosen: a battery always, panels where there is no grid. */
function fallbackDesign(grid: GridAvailability): { systemType: BudgetSystemType; backupHours?: number; autonomyDays?: number } {
  return grid === "none" ? { systemType: "off_grid", autonomyDays: 1 } : { systemType: "hybrid", backupHours: 4 };
}
