import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
  action,
  internalMutation,
  internalQuery,
  mutation,
  query,
  type MutationCtx,
  type QueryCtx
} from "./_generated/server";
import { recordAudit } from "./lib/audit";
import { findViewerProfile, requireTenantMembership } from "./lib/auth";
import { MAX_IMAGE_BYTES, sniffFile } from "./lib/files";
import { computeLoad, scheduledHours } from "./lib/load";
import { currencyExponent, toMinorUnits } from "./lib/money";
import { productPrice } from "./lib/pricing";
import { matchesWords, searchWords } from "./lib/search";
import { LEAD_MANAGERS, LEAD_VIEWERS } from "./leads";

/** Who may prepare and send a recommendation: every staff role (nobody answers their own request). */
export const RESPONDERS = ["super_admin", "inventory_admin", "sales_manager", "sales_agent", "technician"] as const;

const MAX_OPTIONS = 3;
const MAX_COMPONENTS = 20;
const MAX_IMAGES_PER_OPTION = 4;
const MAX_MESSAGE = 2000;
const MAX_DESCRIPTION = 1000;
const HEAD_BYTES = 16;
// Products shown per catalogue search, and how many are read to find them.
const PICK_RESULTS = 25;
const PICK_SCAN = 3000;

type Ctx = QueryCtx | MutationCtx;

/** Loads a request the caller may see, with the same visibility rules as the request list. */
async function visibleLead(ctx: Ctx, leadId: Id<"quoteRequests">, roles: readonly string[] = LEAD_VIEWERS) {
  const lead = await ctx.db.get(leadId);
  if (!lead) throw new ConvexError("Request not found.");
  const access = await requireTenantMembership(ctx, lead.tenantId, roles as never);
  const role = access.membership.role as string;
  return { lead, ...access };
}

/**
 * True when the request was made by this staff member themselves, for example an agent doing the
 * energy check for a client. They may answer it themselves and share the recommendation.
 */
async function ownRequest(ctx: Ctx, lead: Doc<"quoteRequests">, profileId: Id<"userProfiles">) {
  if (!lead.customerAccountId) return false;
  const account = await ctx.db.get(lead.customerAccountId);
  return account?.userId === profileId;
}

async function responseFor(ctx: Ctx, requestId: Id<"quoteRequests">) {
  return await ctx.db
    .query("requestResponses")
    .withIndex("by_request", (q) => q.eq("requestId", requestId))
    .unique();
}

async function imagesByOption(ctx: Ctx, requestId: Id<"quoteRequests">) {
  const rows = await ctx.db
    .query("responseImages")
    .withIndex("by_request", (q) => q.eq("requestId", requestId))
    .collect();
  const out = new Map<string, { id: Id<"responseImages">; url: string | null }[]>();
  for (const row of rows.sort((a, b) => a.createdAt - b.createdAt)) {
    const list = out.get(row.optionKey) ?? [];
    list.push({ id: row._id, url: await ctx.storage.getUrl(row.storageId) });
    out.set(row.optionKey, list);
  }
  return out;
}

async function presentResponse(ctx: Ctx, response: Doc<"requestResponses">) {
  const images = await imagesByOption(ctx, response.requestId);
  return {
    status: response.status,
    message: response.message,
    sentAt: response.sentAt ?? null,
    updatedAt: response.updatedAt,
    chosenOptionKey: response.chosenOptionKey ?? null,
    chosenAt: response.chosenAt ?? null,
    options: response.options.map((o) => ({
      key: o.key,
      title: o.title,
      description: o.description,
      components: o.components.map((c) => ({ name: c.name, quantity: c.quantity, productId: c.productId ?? null })),
      priceMinor: o.priceMinor ?? null,
      images: (images.get(o.key) ?? []).filter((i) => i.url).map((i) => ({ id: i.id, url: i.url as string }))
    }))
  };
}

/** Everything a technician needs to design a system for one request. */
/** The requested parts at today's list prices, or null when one has no price (or no catalogue link). */
async function equipmentPrice(ctx: QueryCtx, lead: Doc<"quoteRequests">, tenant: Doc<"tenants">) {
  if (lead.components.length === 0) return null;
  let total = 0;
  for (const c of lead.components) {
    const product = c.productId ? await ctx.db.get(c.productId) : null;
    if (!product) return null;
    const price = await productPrice(ctx, product);
    if (!price || price.currency !== tenant.defaultCurrency) return null;
    total += price.listMinor * c.quantity;
  }
  return total;
}

export const getLead = query({
  args: { leadId: v.id("quoteRequests") },
  handler: async (ctx, args) => {
    const { lead, membership, profile, tenant } = await visibleLead(ctx, args.leadId);
    const role = membership.role as string;
    const load = computeLoad(lead.lines);
    const response = await responseFor(ctx, lead._id);
    const preparedBy = response ? await ctx.db.get(response.preparedByUserId) : null;
    return {
      id: lead._id,
      createdAt: lead.createdAt,
      status: lead.status,
      name: lead.name,
      phone: lead.phone,
      email: lead.email ?? null,
      location: lead.location,
      category: lead.category ?? null,
      gridAvailability: lead.gridAvailability,
      inputMode: lead.inputMode,
      systemType: lead.systemType,
      backupHours: lead.backupHours ?? null,
      autonomyDays: lead.autonomyDays ?? null,
      optionTitle: lead.optionTitle,
      isRecommendation: lead.optionKey === "recommendation",
      isUpgrade: lead.inputMode === "existing_system",
      // "What can my money buy?": the budget for equipment, and the chosen parts at today's list prices.
      budget: lead.budget ? { ...lead.budget, equipmentMinor: await equipmentPrice(ctx, lead, tenant) } : null,
      upgradeStudyId: lead.upgradeStudyId ?? null,
      components: lead.components,
      dailyKwh: lead.dailyKwh,
      costPerMonthMinor: lead.costPerMonthMinor ?? null,
      companyName: tenant.name,
      currency: tenant.defaultCurrency,
      exponent: currencyExponent(tenant.defaultCurrency),
      load: {
        connectedW: load.connectedLoadW,
        peakW: load.coincidentPeakW,
        peakWithSurgeW: load.peakWithSurgeW,
        dayKwh: Math.round(load.daytimeEnergyWh / 10) / 100,
        nightKwh: Math.round(load.nighttimeEnergyWh / 10) / 100
      },
      appliances: lead.lines.map((l) => {
        const hours = scheduledHours(l.windows);
        const duty = l.dutyFactor ?? 1;
        return {
          name: l.name,
          quantity: l.quantity,
          powerW: l.powerW,
          hoursPerDay: hours,
          duty,
          surgeW: l.surgeW ?? null,
          kwhPerDay: Math.round((l.quantity * l.powerW * hours * duty) / 10) / 100
        };
      }),
      hasAccount: Boolean(lead.customerAccountId),
      // The WhatsApp follow-up: whose number it went to, when the customer opened it, who replied.
      whatsapp: {
        to: lead.whatsappTo?.name ?? null,
        number: lead.whatsappTo?.number ?? null,
        openedAt: lead.whatsappOpenedAt ?? null,
        repliedAt: lead.whatsappRepliedAt ?? null,
        repliedBy: lead.whatsappRepliedBy ? (await ctx.db.get(lead.whatsappRepliedBy))?.displayName ?? null : null
      },
      // Nameplate photos the customer added, with what each shows.
      photos: await Promise.all(
        (await ctx.db.query("requestPhotos").withIndex("by_request", (q) => q.eq("requestId", lead._id)).collect()).map(async (p) => ({
          id: p._id,
          part: p.part,
          label: p.label,
          url: await ctx.storage.getUrl(p.storageId),
          extracted: p.extracted ?? null
        }))
      ),
      canRespond: (RESPONDERS as readonly string[]).includes(role),
      // The viewer made this request themselves (e.g. for a client) and may answer it.
      ownRequest: await ownRequest(ctx, lead, profile._id),
      assessmentId: lead.assessmentId ?? null,
      response: response
        ? { ...(await presentResponse(ctx, response)), preparedBy: preparedBy?.displayName ?? null }
        : null,
      viewerIsPreparer: response ? response.preparedByUserId === profile._id : false
    };
  }
});

const optionArg = v.object({
  key: v.string(),
  title: v.string(),
  description: v.string(),
  // productId links a part to the catalogue; parts from outside the catalogue have none.
  components: v.array(v.object({ name: v.string(), quantity: v.number(), productId: v.optional(v.id("products")) })),
  // Whole currency units as typed (for example UGX 12500000); empty means "price on request".
  price: v.optional(v.number())
});

/** Saves the response as a draft, or sends it so the customer sees it in the app. */
export const saveResponse = mutation({
  args: {
    leadId: v.id("quoteRequests"),
    message: v.string(),
    options: v.array(optionArg),
    send: v.boolean()
  },
  handler: async (ctx, args) => {
    const { lead, profile, tenant } = await visibleLead(ctx, args.leadId, RESPONDERS);
    if (lead.status === "closed") throw new ConvexError("This request is closed.");

    const message = args.message.trim();
    if (message.length > MAX_MESSAGE) throw new ConvexError(`The message must be ${MAX_MESSAGE} characters or fewer.`);
    if (args.options.length > MAX_OPTIONS) throw new ConvexError(`Offer at most ${MAX_OPTIONS} options.`);
    if (args.send && args.options.length === 0) throw new ConvexError("Add at least one option before sending.");
    if (args.send && !message) throw new ConvexError("Write a short message to the customer before sending.");

    const keys = new Set<string>();
    const options = [];
    for (const [i, o] of args.options.entries()) {
      const label = `Option ${i + 1}`;
      if (!/^[a-z0-9]{4,32}$/i.test(o.key) || keys.has(o.key)) throw new ConvexError("Invalid option.");
      keys.add(o.key);
      const title = o.title.trim();
      if (!title) throw new ConvexError(`${label} needs a title.`);
      if (title.length > 100) throw new ConvexError(`${label}: the title must be 100 characters or fewer.`);
      const description = o.description.trim();
      if (description.length > MAX_DESCRIPTION) {
        throw new ConvexError(`${label}: the description must be ${MAX_DESCRIPTION} characters or fewer.`);
      }
      if (o.components.length > MAX_COMPONENTS) throw new ConvexError(`${label}: list at most ${MAX_COMPONENTS} parts.`);
      const components = o.components
        .map((c) => ({ name: c.name.trim(), quantity: c.quantity, ...(c.productId ? { productId: c.productId } : {}) }))
        .filter((c) => c.name);
      for (const c of components) {
        if (c.productId) {
          const product = await ctx.db.get(c.productId);
          if (!product || product.tenantId !== lead.tenantId) throw new ConvexError(`${label}: "${c.name}" is not in the catalogue.`);
        }
        if (c.name.length > 100) throw new ConvexError(`${label}: part names must be 100 characters or fewer.`);
        if (!Number.isInteger(c.quantity) || c.quantity < 1 || c.quantity > 1000) {
          throw new ConvexError(`${label}: "${c.name}" needs a whole quantity from 1 to 1000.`);
        }
      }
      if (args.send && components.length === 0) throw new ConvexError(`${label}: list the main parts before sending.`);
      const priceMinor = o.price === undefined ? undefined : toMinorUnits(o.price, tenant.defaultCurrency);
      if (priceMinor === 0) throw new ConvexError(`${label}: leave the price empty instead of zero.`);
      options.push({ key: o.key, title, description, components, priceMinor });
    }

    const now = Date.now();
    const existing = await responseFor(ctx, lead._id);
    // Once sent, a response stays visible to the customer; later saves update what they see.
    const status = args.send || existing?.status === "sent" ? ("sent" as const) : ("draft" as const);
    const chosenStillThere = existing?.chosenOptionKey && keys.has(existing.chosenOptionKey);
    const fields = {
      status,
      message,
      options,
      preparedByUserId: profile._id,
      updatedAt: now,
      sentAt: args.send ? now : existing?.sentAt,
      chosenOptionKey: chosenStillThere ? existing?.chosenOptionKey : undefined,
      chosenAt: chosenStillThere ? existing?.chosenAt : undefined
    };
    if (existing) await ctx.db.patch(existing._id, fields);
    else await ctx.db.insert("requestResponses", { tenantId: lead.tenantId, requestId: lead._id, createdAt: now, ...fields });

    // Photos of options that were removed go too.
    const images = await ctx.db
      .query("responseImages")
      .withIndex("by_request", (q) => q.eq("requestId", lead._id))
      .collect();
    for (const img of images) {
      if (!keys.has(img.optionKey)) {
        await ctx.storage.delete(img.storageId);
        await ctx.db.delete(img._id);
      }
    }

    if (args.send) {
      await recordAudit(ctx, profile, {
        tenantId: lead.tenantId,
        action: "lead.response_sent",
        entityType: "quoteRequests",
        entityId: lead._id,
        summary: `Recommendation with ${options.length} option(s) sent to ${lead.name}.`
      });
    }
    return { status };
  }
});

/** List price of a product as customers see it, or null when it has no cost or margin yet. */
async function listPriceMinor(ctx: Ctx, product: Doc<"products">) {
  return (await productPrice(ctx, product))?.listMinor ?? null;
}

/**
 * Catalogue products a technician can add to a recommendation, with the list price customers
 * see in the shop (never cost or margin). Narrowed by words and an optional category.
 */
export const searchCatalogue = query({
  args: { leadId: v.id("quoteRequests"), term: v.string(), categoryId: v.optional(v.id("productCategories")) },
  handler: async (ctx, args) => {
    const { lead } = await visibleLead(ctx, args.leadId, RESPONDERS);
    const categories = (
      await ctx.db.query("productCategories").withIndex("by_tenant", (q) => q.eq("tenantId", lead.tenantId)).collect()
    ).filter((c) => c.status === "active");
    const categoryName = new Map(categories.map((c) => [c._id, c.name]));

    const words = searchWords(args.term);
    const products = await ctx.db
      .query("products")
      .withIndex("by_tenant", (q) => q.eq("tenantId", lead.tenantId))
      .take(PICK_SCAN);
    const matches = products
      .filter((p) => p.status === "active" && categoryName.has(p.categoryId))
      .filter((p) => !args.categoryId || p.categoryId === args.categoryId)
      .filter((p) => matchesWords(`${p.name} ${p.brand} ${p.model} ${p.sku} ${categoryName.get(p.categoryId)}`, words))
      .sort((a, b) => a.name.localeCompare(b.name) || a.brand.localeCompare(b.brand));

    const results = [];
    for (const p of matches.slice(0, PICK_RESULTS)) {
      results.push({
        id: p._id,
        name: p.name,
        brand: p.brand,
        model: p.model,
        sku: p.sku,
        categoryName: categoryName.get(p.categoryId) ?? "",
        listPriceMinor: await listPriceMinor(ctx, p)
      });
    }
    return {
      categories: categories.map((c) => ({ id: c._id, name: c.name })).sort((a, b) => a.name.localeCompare(b.name)),
      total: matches.length,
      results
    };
  }
});

/** Groups, brands and product names for the dropdown under the catalogue search box. */
export const catalogueNames = query({
  args: { leadId: v.id("quoteRequests") },
  handler: async (ctx, args) => {
    const { lead } = await visibleLead(ctx, args.leadId, RESPONDERS);
    const categories = (
      await ctx.db.query("productCategories").withIndex("by_tenant", (q) => q.eq("tenantId", lead.tenantId)).collect()
    ).filter((c) => c.status === "active");
    const active = new Set(categories.map((c) => c._id));
    const products = (
      await ctx.db.query("products").withIndex("by_tenant", (q) => q.eq("tenantId", lead.tenantId)).take(PICK_SCAN)
    ).filter((p) => p.status === "active" && active.has(p.categoryId));
    const tally = (values: string[]) => {
      const out = new Map<string, number>();
      for (const value of values) out.set(value, (out.get(value) ?? 0) + 1);
      return [...out.entries()].map(([value, count]) => ({ value, count }));
    };
    const perCategory = new Map(tally(products.map((p) => p.categoryId)).map((c) => [c.value, c.count]));
    return {
      categories: categories.map((c) => ({ id: c._id, name: c.name, count: perCategory.get(c._id) ?? 0 })).filter((c) => c.count > 0),
      brands: tally(products.map((p) => p.brand)),
      names: tally(products.map((p) => p.name))
    };
  }
});

/** List prices of the catalogue parts already in a recommendation, for a running total. */
export const catalogueParts = query({
  args: { leadId: v.id("quoteRequests"), ids: v.array(v.id("products")) },
  handler: async (ctx, args) => {
    const { lead } = await visibleLead(ctx, args.leadId, RESPONDERS);
    if (args.ids.length > MAX_OPTIONS * MAX_COMPONENTS) throw new ConvexError("Too many parts.");
    const out: Record<string, number | null> = {};
    for (const id of new Set(args.ids)) {
      const product = await ctx.db.get(id);
      if (!product || product.tenantId !== lead.tenantId) continue;
      out[id] = await listPriceMinor(ctx, product);
    }
    return out;
  }
});

/** Step 1 of adding a photo to an option. */
export const generateImageUploadUrl = mutation({
  args: { leadId: v.id("quoteRequests") },
  handler: async (ctx, args) => {
    await visibleLead(ctx, args.leadId, RESPONDERS);
    return await ctx.storage.generateUploadUrl();
  }
});

export const authorizeImage = internalQuery({
  args: { leadId: v.id("quoteRequests"), optionKey: v.string(), storageId: v.id("_storage") },
  handler: async (ctx, args) => {
    await visibleLead(ctx, args.leadId, RESPONDERS);
    const used = await ctx.db
      .query("responseImages")
      .withIndex("by_storage", (q) => q.eq("storageId", args.storageId))
      .first();
    if (used) throw new ConvexError("That photo is already attached.");
    return true;
  }
});

export const recordImage = internalMutation({
  args: {
    leadId: v.id("quoteRequests"),
    optionKey: v.string(),
    storageId: v.id("_storage"),
    contentType: v.string(),
    size: v.number()
  },
  handler: async (ctx, args) => {
    const { lead } = await visibleLead(ctx, args.leadId, RESPONDERS);
    if (!/^[a-z0-9]{4,32}$/i.test(args.optionKey)) throw new ConvexError("Invalid option.");
    const existing = await ctx.db
      .query("responseImages")
      .withIndex("by_request", (q) => q.eq("requestId", lead._id))
      .collect();
    if (existing.filter((i) => i.optionKey === args.optionKey).length >= MAX_IMAGES_PER_OPTION) {
      throw new ConvexError(`An option can have at most ${MAX_IMAGES_PER_OPTION} photos.`);
    }
    return await ctx.db.insert("responseImages", {
      tenantId: lead.tenantId,
      requestId: lead._id,
      optionKey: args.optionKey,
      storageId: args.storageId,
      contentType: args.contentType,
      size: args.size,
      createdAt: Date.now()
    });
  }
});

/** Step 2: checks the uploaded bytes really are a photo, then attaches it to the option. */
export const attachImage = action({
  args: { leadId: v.id("quoteRequests"), optionKey: v.string(), storageId: v.id("_storage") },
  handler: async (ctx, args): Promise<{ imageId: Id<"responseImages"> }> => {
    await ctx.runQuery(internal.responses.authorizeImage, args);
    const reject = async (message: string): Promise<never> => {
      await ctx.storage.delete(args.storageId);
      throw new ConvexError(message);
    };
    const blob = await ctx.storage.get(args.storageId);
    if (!blob) throw new ConvexError("The upload was not found. Please try again.");
    const sniffed = sniffFile(new Uint8Array(await blob.slice(0, HEAD_BYTES).arrayBuffer()));
    if (!sniffed || sniffed.kind !== "image") return await reject("Only PNG, JPEG and WebP photos are allowed.");
    if (blob.size > MAX_IMAGE_BYTES) return await reject(`Photos can be at most ${MAX_IMAGE_BYTES / (1024 * 1024)} MB.`);
    try {
      const imageId: Id<"responseImages"> = await ctx.runMutation(internal.responses.recordImage, {
        ...args,
        contentType: sniffed.contentType,
        size: blob.size
      });
      return { imageId };
    } catch (error) {
      await ctx.storage.delete(args.storageId);
      throw error;
    }
  }
});

export const removeImage = mutation({
  args: { imageId: v.id("responseImages") },
  handler: async (ctx, args) => {
    const image = await ctx.db.get(args.imageId);
    if (!image) return { changed: false };
    await visibleLead(ctx, image.requestId, RESPONDERS);
    await ctx.storage.delete(image.storageId);
    await ctx.db.delete(image._id);
    return { changed: true };
  }
});

// ----- The customer's side -----

async function viewerAccount(ctx: Ctx) {
  const viewer = await findViewerProfile(ctx);
  if (!viewer?.profile || viewer.profile.status !== "active") return null;
  return await ctx.db
    .query("customerAccounts")
    .withIndex("by_user", (q) => q.eq("userId", viewer.profile!._id))
    .first();
}

/** The signed-in customer's requests, with the recommendation once a technician has sent it. */
export const myRequests = query({
  args: {},
  handler: async (ctx) => {
    const account = await viewerAccount(ctx);
    if (!account) return null;
    const tenant = await ctx.db.get(account.tenantId);
    const currency = tenant?.defaultCurrency ?? "UGX";
    const rows = await ctx.db
      .query("quoteRequests")
      .withIndex("by_customer_account", (q) => q.eq("customerAccountId", account._id))
      .order("desc")
      .take(50);
    const out = [];
    for (const r of rows) {
      const response = await responseFor(ctx, r._id);
      out.push({
        id: r._id,
        createdAt: r.createdAt,
        location: r.location,
        dailyKwh: r.dailyKwh,
        isUpgrade: r.inputMode === "existing_system",
        gridAvailability: r.gridAvailability,
        closed: r.status === "closed",
        // Drafts stay private to staff.
        response: response && response.status === "sent" ? await presentResponse(ctx, response) : null
      });
    }
    return { currency, exponent: currencyExponent(currency), contactName: tenant?.name ?? null, requests: out };
  }
});

/** Attaches requests made before signing up, using the codes kept on this phone. */
export const claimRequests = mutation({
  args: { tokens: v.array(v.string()) },
  handler: async (ctx, args) => {
    const account = await viewerAccount(ctx);
    if (!account) throw new ConvexError("Please sign in first.");
    let claimed = 0;
    for (const token of args.tokens.slice(0, 20)) {
      if (!/^[0-9a-f]{32}$/.test(token)) continue;
      const lead = await ctx.db
        .query("quoteRequests")
        .withIndex("by_claim_token", (q) => q.eq("claimToken", token))
        .unique();
      if (!lead || lead.tenantId !== account.tenantId || lead.customerAccountId) continue;
      await ctx.db.patch(lead._id, { customerAccountId: account._id, claimToken: undefined, updatedAt: Date.now() });
      claimed++;
    }
    return { claimed };
  }
});

/** The customer says which option they want; staff see it on the request. */
export const chooseOption = mutation({
  args: { requestId: v.id("quoteRequests"), optionKey: v.string() },
  handler: async (ctx, args) => {
    const account = await viewerAccount(ctx);
    const lead = await ctx.db.get(args.requestId);
    if (!account || !lead || lead.customerAccountId !== account._id) throw new ConvexError("Request not found.");
    const response = await responseFor(ctx, lead._id);
    if (!response || response.status !== "sent") throw new ConvexError("There is no recommendation to choose from yet.");
    if (!response.options.some((o) => o.key === args.optionKey)) throw new ConvexError("That option is no longer offered.");
    await ctx.db.patch(response._id, { chosenOptionKey: args.optionKey, chosenAt: Date.now() });
    await ctx.db.patch(lead._id, { updatedAt: Date.now() });
    return { changed: true };
  }
});
