/**
 * Upgrade studies: checking a solar system that is already installed and
 * working out what can be added or swapped.
 *
 * The engine (lib/upgrade.ts) is pure. This file loads the catalogue, runs it,
 * and shapes the result for staff (with list prices) or the public (components
 * only, never prices). A saved study is append-only; a technician records that
 * the reported ratings were checked before any quotation built on it can be
 * approved.
 */
import { ConvexError, v, type Infer } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import {
  MAX_REQUESTS_PER_HOUR,
  MAX_REQUESTS_PER_PHONE_PER_DAY,
  newClaimToken,
  publicCompany
} from "./estimator";
import { recordAudit } from "./lib/audit";
import { findViewerProfile, requireTenantMembership } from "./lib/auth";
import { canAccessOwned, CRM_READERS, CRM_WRITERS, seesAllCustomers, validateOptionalEmail, validatePhone } from "./lib/crm";
import { PUBLIC_ASSUMPTIONS } from "./lib/estimate";
import { currencyExponent } from "./lib/money";
import { productPrice } from "./lib/pricing";
import type { Assumptions, CatalogueItem } from "./lib/sizing";
import { withSafeEstimates } from "./lib/specEstimate";
import {
  buildUpgradeReport,
  optionsOf,
  UPGRADE_ENGINE_VERSION,
  validateExisting,
  type UpgradeArea,
  type UpgradeOption,
  type UpgradeReport
} from "./lib/upgrade";
import { requireText } from "./lib/validation";
import { requesterAccount } from "./lib/requester";
import { attachPhotos, photoArg } from "./requestPhotos";
import { existingSystem, upgradeNeeds } from "./schema";

type Ctx = QueryCtx | MutationCtx;
type System = Infer<typeof existingSystem>;
type Needs = Infer<typeof upgradeNeeds>;

const TECHNICIANS = ["super_admin", "technician"] as const;
const LEAD_VIEWERS = [...CRM_WRITERS, "technician"] as const;
const LEAD_MANAGERS = ["super_admin", "sales_manager"] as const;
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
/** Options shown per part of the system and kind of change. */
const SHOWN_PER_GROUP = 4;
/** Option key stored on a public request for an upgrade. */
export const UPGRADE_REQUEST_KEY = "upgrade";

export const AREA_LABEL: Record<UpgradeArea, string> = {
  battery: "Battery",
  panels: "Solar panel",
  inverter: "Inverter",
  controller: "Charge controller"
};

/** The assumptions every upgrade study uses until per-site figures are supported. */
export function upgradeAssumptions(): Assumptions {
  return { ...PUBLIC_ASSUMPTIONS };
}

async function loadCatalogue(ctx: Ctx, tenantId: Id<"tenants">) {
  const categories = await ctx.db
    .query("productCategories")
    .withIndex("by_tenant", (q) => q.eq("tenantId", tenantId))
    .collect();
  const keyOf = new Map(categories.map((c) => [c._id, c.key]));
  const products = (
    await ctx.db
      .query("products")
      .withIndex("by_tenant", (q) => q.eq("tenantId", tenantId))
      .collect()
  ).filter((p) => p.status === "active");
  const catalogue: CatalogueItem[] = withSafeEstimates(products
    .map((p) => ({
      id: p._id as string,
      sku: p.sku,
      name: p.name,
      categoryKey: keyOf.get(p.categoryId) ?? "",
      specSchemaVersion: p.specSchemaVersion,
      specValues: p.specValues
    }))
    .sort((a, b) => a.sku.localeCompare(b.sku)));
  return { catalogue, products: new Map(products.map((p) => [p._id as string, p])) };
}

function runStudy(system: System, needs: Needs, catalogue: CatalogueItem[]) {
  const problem = validateExisting(system, needs);
  if (problem) throw new ConvexError(problem);
  return buildUpgradeReport(system, needs, upgradeAssumptions(), catalogue);
}

export type ShownOption = UpgradeOption & {
  sku: string;
  brand: string | null;
  model: string | null;
  /** List price of one unit and of the whole option. Null for the public, or when the product has no price yet. */
  unitListMinor: number | null;
  totalMinor: number | null;
  tags: string[];
};

/**
 * Turns an engine report into what a screen shows: the best few options per
 * part of the system, cheapest first where prices are known, with tags for the
 * lowest cost and the best-performing choice. Prices are today's list prices,
 * and are left out entirely when `showPrices` is false.
 */
async function present(ctx: Ctx, tenant: Doc<"tenants">, report: UpgradeReport, showPrices: boolean) {
  const { products } = await loadCatalogue(ctx, tenant._id);
  const priceCache = new Map<string, { currency: string; listMinor: number } | null>();
  const priceOf = async (productId: string) => {
    if (priceCache.has(productId)) return priceCache.get(productId)!;
    const product = products.get(productId);
    let price: { currency: string; listMinor: number } | null = null;
    if (product) {
      const found = await productPrice(ctx, product);
      // Only the company's default currency is compared, so totals are never mixed.
      if (found && found.currency === tenant.defaultCurrency) {
        price = { currency: found.currency, listMinor: found.listMinor };
      }
    }
    priceCache.set(productId, price);
    return price;
  };

  const sections = [];
  for (const section of report.sections) {
    const priced: (ShownOption & { sortTotal: number | null })[] = [];
    for (const option of section.options) {
      const product = products.get(option.productId);
      const price = await priceOf(option.productId);
      const total = price ? price.listMinor * option.quantity : null;
      priced.push({
        ...option,
        sku: product?.sku ?? "",
        brand: product?.brand ?? null,
        model: product?.model ?? null,
        unitListMinor: showPrices && price ? price.listMinor : null,
        totalMinor: showPrices ? total : null,
        tags: [],
        sortTotal: total
      });
    }

    const shown: typeof priced = [];
    // Options are compared within their own kind: additions, replacements, and additions that
    // depend on another replacement each form a group.
    const groupOf = (o: ShownOption) => `${o.action}|${o.requires ?? ""}`;
    for (const groupKey of [...new Set(priced.map(groupOf))]) {
      const group = priced.filter((o) => groupOf(o) === groupKey);
      const rank = (o: ShownOption) => (o.status === "compatible" ? 0 : 1);
      // The engine's order is kept between options that cost the same or have no price.
      const order = new Map(group.map((o, i) => [o.key, i]));
      group.sort(
        (x, y) =>
          rank(x) - rank(y) ||
          (x.figures.shortWp ?? 0) - (y.figures.shortWp ?? 0) ||
          (x.sortTotal ?? Infinity) - (y.sortTotal ?? Infinity) ||
          order.get(x.key)! - order.get(y.key)!
      );
      const top = group.slice(0, SHOWN_PER_GROUP);

      if (top.length > 1) {
        const withPrice = top.filter((o) => o.sortTotal !== null);
        if (withPrice.length > 1) {
          const cheapest = withPrice.reduce((a, b) => (b.sortTotal! < a.sortTotal! ? b : a));
          cheapest.tags.push("Lowest cost");
        }
        const best = (key: string, label: string) => {
          const having = top.filter((o) => o.figures[key] !== undefined);
          if (having.length < 2) return;
          const max = Math.max(...having.map((o) => o.figures[key]));
          const min = Math.min(...having.map((o) => o.figures[key]));
          if (max > min) having.filter((o) => o.figures[key] === max).forEach((o) => o.tags.push(label));
        };
        best("efficiency", "Most efficient");
        best("cycleLife", "Longest cycle life");
      }
      shown.push(...top);
    }
    sections.push({
      area: section.area,
      title: section.title,
      requirements: section.requirements,
      messages: section.messages,
      rejected: section.rejected,
      options: shown.map(({ sortTotal: _sortTotal, ...rest }) => rest as ShownOption)
    });
  }

  return {
    engineVersion: report.engineVersion,
    blockers: report.blockers,
    current: report.current,
    required: report.required,
    findings: report.findings,
    sections,
    currency: tenant.defaultCurrency,
    exponent: currencyExponent(tenant.defaultCurrency),
    assumptions: {
      peakSunHours: PUBLIC_ASSUMPTIONS.peakSunHours,
      performanceRatio: PUBLIC_ASSUMPTIONS.performanceRatio,
      minCellTempC: PUBLIC_ASSUMPTIONS.minCellTempC,
      maxCellTempC: PUBLIC_ASSUMPTIONS.maxCellTempC
    }
  };
}

// ------------------------------------------------------------------ staff

/** Runs a study without saving it, so an agent can try figures during a visit. */
export const simulate = query({
  args: { tenantId: v.id("tenants"), system: existingSystem, needs: upgradeNeeds },
  handler: async (ctx, args) => {
    const { tenant } = await requireTenantMembership(ctx, args.tenantId, CRM_READERS);
    const { catalogue } = await loadCatalogue(ctx, tenant._id);
    return await present(ctx, tenant, runStudy(args.system, args.needs, catalogue), true);
  }
});

/** Writes the append-only study record. Shared by staff saves and converted public requests. */
export async function insertStudy(
  ctx: MutationCtx,
  actor: Doc<"userProfiles">,
  fields: {
    tenantId: Id<"tenants">;
    customerId: Id<"customers">;
    siteId: Id<"customerSites">;
    ownerUserId: Id<"userProfiles">;
    system: System;
    needs: Needs;
    sourceRequestId?: Id<"quoteRequests">;
  }
) {
  const { catalogue } = await loadCatalogue(ctx, fields.tenantId);
  const report = runStudy(fields.system, fields.needs, catalogue);
  const used = new Set(optionsOf(report).map((o) => o.productId));
  const studyId = await ctx.db.insert("upgradeStudies", {
    ...fields,
    assumptions: upgradeAssumptions(),
    engineVersion: UPGRADE_ENGINE_VERSION,
    report,
    productSnapshots: catalogue.filter((c) => used.has(c.id)),
    createdAt: Date.now(),
    createdBy: actor.authSubject,
    actorUserId: actor._id
  });
  await recordAudit(ctx, actor, {
    tenantId: fields.tenantId,
    action: "upgrade.study_saved",
    entityType: "upgradeStudies",
    entityId: studyId,
    summary: `Upgrade study saved: ${fields.needs.goals.join(", ")}.`,
    metadata: { engineVersion: UPGRADE_ENGINE_VERSION, options: used.size, blockers: report.blockers.length }
  });
  return studyId;
}

export const saveStudy = mutation({
  args: {
    customerId: v.id("customers"),
    siteId: v.id("customerSites"),
    system: existingSystem,
    needs: upgradeNeeds
  },
  handler: async (ctx, args) => {
    const customer = await ctx.db.get(args.customerId);
    if (!customer) throw new ConvexError("Customer not found.");
    const { profile, membership } = await requireTenantMembership(ctx, customer.tenantId, CRM_WRITERS);
    if (!canAccessOwned(membership.role, profile, customer.ownerUserId)) {
      throw new ConvexError("Customer not found.");
    }
    const site = await ctx.db.get(args.siteId);
    if (!site || site.customerId !== customer._id) throw new ConvexError("Site not found.");
    const studyId = await insertStudy(ctx, profile, {
      tenantId: customer.tenantId,
      customerId: customer._id,
      siteId: site._id,
      ownerUserId: customer.ownerUserId,
      system: args.system,
      needs: args.needs
    });
    return { studyId };
  }
});

async function loadStudy(ctx: Ctx, studyId: Id<"upgradeStudies">) {
  const study = await ctx.db.get(studyId);
  if (!study) throw new ConvexError("Upgrade study not found.");
  const auth = await requireTenantMembership(ctx, study.tenantId, CRM_READERS);
  if (!canAccessOwned(auth.membership.role, auth.profile, study.ownerUserId)) {
    throw new ConvexError("Upgrade study not found.");
  }
  return { study, ...auth };
}

export const listStudies = query({
  args: { tenantId: v.id("tenants") },
  handler: async (ctx, args) => {
    const { membership, profile } = await requireTenantMembership(ctx, args.tenantId, CRM_READERS);
    const rows = await ctx.db
      .query("upgradeStudies")
      .withIndex("by_tenant_time", (q) => q.eq("tenantId", args.tenantId))
      .order("desc")
      .take(200);
    const visible = seesAllCustomers(membership.role) ? rows : rows.filter((r) => r.ownerUserId === profile._id);
    const names = new Map<string, string>();
    const out = [];
    for (const r of visible) {
      if (!names.has(r.customerId)) names.set(r.customerId, (await ctx.db.get(r.customerId))?.name ?? "Unknown");
      const report = r.report as UpgradeReport;
      out.push({
        id: r._id,
        createdAt: r.createdAt,
        customerName: names.get(r.customerId)!,
        goals: r.needs.goals,
        systemVoltage: r.system.systemVoltage ?? null,
        options: optionsOf(report).length,
        blocked: report.blockers.length > 0,
        verified: Boolean(r.verification),
        fromPublicRequest: Boolean(r.sourceRequestId)
      });
    }
    return { canWrite: (CRM_WRITERS as readonly string[]).includes(membership.role), studies: out };
  }
});

export const getStudy = query({
  args: { studyId: v.id("upgradeStudies") },
  handler: async (ctx, args) => {
    const { study, membership, profile, tenant } = await loadStudy(ctx, args.studyId);
    const customer = await ctx.db.get(study.customerId);
    const site = await ctx.db.get(study.siteId);
    const quotations = (
      await ctx.db
        .query("quotations")
        .withIndex("by_tenant", (q) => q.eq("tenantId", study.tenantId))
        .collect()
    ).filter((q) => q.upgradeStudyId === study._id);
    const role = membership.role as string;
    return {
      id: study._id,
      createdAt: study.createdAt,
      customerId: study.customerId,
      customerName: customer?.name ?? "",
      siteName: site?.name ?? "",
      companyName: tenant.name,
      system: study.system,
      needs: study.needs,
      report: await present(ctx, tenant, study.report as UpgradeReport, true),
      verification: study.verification
        ? { note: study.verification.note, verifiedAt: study.verification.verifiedAt, verifierName: study.verification.verifierName }
        : null,
      quotations: quotations
        .map((q) => ({ id: q._id, status: q.status, createdAt: q.createdAt, officialNumber: q.officialNumber ?? null }))
        .sort((a, b) => b.createdAt - a.createdAt),
      can: {
        quote: (CRM_WRITERS as readonly string[]).includes(role),
        verify: (TECHNICIANS as readonly string[]).includes(role) && study.ownerUserId !== profile._id && !study.verification
      }
    };
  }
});

/**
 * A technician's record that the ratings typed into the study match the real
 * equipment (site visit, nameplate photos or datasheets). Required before a
 * quotation built on the study can be approved.
 */
export const verifyStudy = mutation({
  args: { studyId: v.id("upgradeStudies"), note: v.string() },
  handler: async (ctx, args) => {
    const study = await ctx.db.get(args.studyId);
    if (!study) throw new ConvexError("Upgrade study not found.");
    const { profile } = await requireTenantMembership(ctx, study.tenantId, TECHNICIANS);
    if (study.ownerUserId === profile._id) {
      throw new ConvexError("You cannot verify a study you own. Ask another technician.");
    }
    if (study.verification) throw new ConvexError("This study has already been verified.");
    const note = requireText(args.note, "How the ratings were verified", 500);
    await ctx.db.patch(study._id, {
      verification: { note, verifiedAt: Date.now(), verifiedByUserId: profile._id, verifierName: profile.displayName }
    });
    await recordAudit(ctx, profile, {
      tenantId: study.tenantId,
      action: "upgrade.study_verified",
      entityType: "upgradeStudies",
      entityId: study._id,
      summary: "Existing system ratings verified by a technician.",
      metadata: { note }
    });
    return { ok: true };
  }
});

/** The study for a public upgrade request, for whoever prepares the recommendation. */
export const forLead = query({
  args: { leadId: v.id("quoteRequests") },
  handler: async (ctx, args) => {
    const lead = await ctx.db.get(args.leadId);
    if (!lead) throw new ConvexError("Request not found.");
    const { membership, profile, tenant } = await requireTenantMembership(ctx, lead.tenantId, LEAD_VIEWERS);
    const role = membership.role as string;
    const seesAll = (LEAD_MANAGERS as readonly string[]).includes(role) || role === "technician";
    if (!seesAll && lead.assignedToUserId !== profile._id) throw new ConvexError("Request not found.");
    if (!lead.upgrade) return null;
    const { catalogue } = await loadCatalogue(ctx, tenant._id);
    return {
      system: lead.upgrade.system,
      needs: lead.upgrade.needs,
      studyId: lead.upgradeStudyId ?? null,
      report: await present(ctx, tenant, buildUpgradeReport(lead.upgrade.system, lead.upgrade.needs, upgradeAssumptions(), catalogue), true)
    };
  }
});

// ------------------------------------------------------------------ public

/** Whether the public upgrade check is open, and for which company. */
export const publicConfig = query({
  args: {},
  handler: async (ctx) => {
    const company = await publicCompany(ctx);
    if (!company) return { enabled: false as const };
    return {
      enabled: true as const,
      companyName: company.tenant.name,
      contactPhone: company.settings.contactPhone ?? null,
      whatsappNumber: company.settings.whatsappNumber ?? null
    };
  }
});

/** The upgrade check for someone who is not staff. Components only, never prices. */
export const publicSimulate = query({
  args: { system: existingSystem, needs: upgradeNeeds },
  handler: async (ctx, args) => {
    const company = await publicCompany(ctx);
    if (!company) throw new ConvexError("The upgrade check is not available right now.");
    const { catalogue } = await loadCatalogue(ctx, company.tenant._id);
    return await present(ctx, company.tenant, runStudy(args.system, args.needs, catalogue), false);
  }
});

export const submitUpgradeRequest = mutation({
  args: {
    system: existingSystem,
    needs: upgradeNeeds,
    grid: v.union(v.literal("none"), v.literal("unreliable"), v.literal("reliable")),
    // The options the person is interested in, by key. May be empty: a technician then recommends.
    optionKeys: v.array(v.string()),
    name: v.optional(v.string()),
    phone: v.optional(v.string()),
    email: v.optional(v.string()),
    location: v.string(),
    // Real people leave this empty; bots tend to fill every field.
    website: v.optional(v.string()),
    // Optional nameplate photos, uploaded as they were chosen.
    photos: v.optional(v.array(photoArg))
  },
  handler: async (ctx, args) => {
    if (args.website) return { ok: true as const, requestId: null, hasAccount: false, claimToken: null };
    const company = await publicCompany(ctx);
    if (!company) throw new ConvexError("Quote requests are not open right now.");
    const { tenant } = company;

    const viewer = await findViewerProfile(ctx);
    const signedIn = viewer?.profile && viewer.profile.status === "active" ? viewer.profile : null;
    // Anyone signed in may ask, staff included; their request goes to their own account.
    const account = await requesterAccount(ctx, tenant._id, signedIn, { name: args.name, phone: args.phone });
    const name = requireText(account?.name ?? signedIn?.displayName ?? args.name ?? "", "Name", 100);
    const phone = validatePhone(account?.phone ?? args.phone ?? "");
    const email = validateOptionalEmail(signedIn?.email ?? args.email);
    const location = requireText(args.location, "Location", 200);
    if (args.optionKeys.length > 8) throw new ConvexError("Choose at most 8 options.");

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

    // The server recomputes the study: nothing the browser sends about an option is trusted.
    const { catalogue, products } = await loadCatalogue(ctx, tenant._id);
    const report = runStudy(args.system, args.needs, catalogue);
    const byKey = new Map(optionsOf(report).map((o) => [o.key, o]));
    const chosenKeys = new Set(args.optionKeys);
    // An option that only works with another one brings that one along.
    for (const key of args.optionKeys) {
      const needsAlso = byKey.get(key)?.requires;
      if (needsAlso) chosenKeys.add(needsAlso);
    }
    const components = [...chosenKeys].map((key) => {
      const option = byKey.get(key);
      if (!option) throw new ConvexError("One of the chosen options is no longer available. Please check again.");
      const product = products.get(option.productId);
      return {
        role: AREA_LABEL[option.area],
        name: product?.name ?? option.title,
        brand: product?.brand,
        model: product?.model,
        quantity: option.quantity,
        detail: option.action === "add" ? "Add to the existing system" : "Replaces the existing one"
      };
    });

    const claimToken = account && account.tenantId === tenant._id ? undefined : newClaimToken();
    const id = await ctx.db.insert("quoteRequests", {
      tenantId: tenant._id,
      customerAccountId: account && account.tenantId === tenant._id ? account._id : undefined,
      claimToken,
      name,
      phone,
      email,
      location,
      gridAvailability: args.grid,
      inputMode: "existing_system",
      dailyKwh: args.needs.dailyKwh ?? 0,
      systemType: args.system.systemType,
      backupHours: args.needs.backupHours,
      optionKey: UPGRADE_REQUEST_KEY,
      optionTitle: "Upgrade of an existing solar system",
      components,
      lines: [],
      upgrade: { system: args.system, needs: args.needs },
      status: "new",
      createdAt: now,
      updatedAt: now
    });
    await attachPhotos(ctx, tenant._id, id, args.photos);
    return { ok: true as const, requestId: id, hasAccount: claimToken === undefined, claimToken: claimToken ?? null };
  }
});
