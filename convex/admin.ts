/**
 * Operator-only provisioning.
 *
 * These are `internalMutation`s: they cannot be called from the browser or any
 * client. They can only be run by someone holding the deployment's admin
 * credentials, via the Convex dashboard (Functions → Run) or the CLI, e.g.
 *
 *   npx convex run admin:bootstrapTenant \
 *     '{"companyName":"Acme Solar","slug":"acme-solar","adminEmail":"owner@acme.ug"}'
 *
 * Add `--prod` to run against production. The person must have registered at
 * /sign-in first so that their Solar Switch profile exists.
 */
import { ConvexError, v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation, type MutationCtx } from "./_generated/server";
import { appRole } from "./schema";

const OPERATOR_ACTOR = "operator:cli";
const DEFAULT_CURRENCY = "UGX";

function normaliseEmail(email: string) {
  return email.trim().toLowerCase();
}

function validateSlug(raw: string) {
  const slug = raw.trim().toLowerCase();
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || slug.length > 48) {
    throw new ConvexError(
      "Slug must be 1–48 lowercase letters, digits and single hyphens, e.g. \"acme-solar\"."
    );
  }
  return slug;
}

function validateCurrency(raw: string) {
  const code = raw.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(code)) {
    throw new ConvexError(`"${raw}" is not a three-letter ISO 4217 currency code.`);
  }
  return code;
}

async function findProfileByEmail(ctx: MutationCtx, rawEmail: string) {
  const email = normaliseEmail(rawEmail);
  const matches = await ctx.db
    .query("userProfiles")
    .withIndex("by_email", (q) => q.eq("email", email))
    .take(2);

  if (matches.length === 0) {
    throw new ConvexError(
      `No Solar Switch account exists for ${email}. Ask them to register at /sign-in first.`
    );
  }
  if (matches.length > 1) {
    throw new ConvexError(`More than one profile uses ${email}; resolve this manually.`);
  }
  const profile = matches[0];
  if (profile.status !== "active") {
    throw new ConvexError(`The account for ${email} is disabled.`);
  }
  return profile;
}

async function findTenantBySlug(ctx: MutationCtx, rawSlug: string) {
  const slug = validateSlug(rawSlug);
  const tenant = await ctx.db
    .query("tenants")
    .withIndex("by_slug", (q) => q.eq("slug", slug))
    .unique();
  if (!tenant) throw new ConvexError(`No company with slug "${slug}".`);
  return tenant;
}

async function audit(
  ctx: MutationCtx,
  event: {
    tenantId: Id<"tenants">;
    action: string;
    entityType: string;
    entityId: string;
    summary: string;
    metadata?: unknown;
  }
) {
  await ctx.db.insert("auditEvents", {
    ...event,
    actorSubject: OPERATOR_ACTOR,
    occurredAt: Date.now()
  });
}

/** Creates a company and makes an existing registered user its super administrator. */
export const bootstrapTenant = internalMutation({
  args: {
    companyName: v.string(),
    slug: v.string(),
    adminEmail: v.string(),
    defaultCurrency: v.optional(v.string()),
    supportedCurrencies: v.optional(v.array(v.string()))
  },
  handler: async (ctx, args) => {
    const companyName = args.companyName.trim();
    if (!companyName) throw new ConvexError("Company name is required.");

    const slug = validateSlug(args.slug);
    const defaultCurrency = validateCurrency(args.defaultCurrency ?? DEFAULT_CURRENCY);
    const supportedCurrencies = Array.from(
      new Set([defaultCurrency, ...(args.supportedCurrencies ?? []).map(validateCurrency)])
    );

    const existing = await ctx.db
      .query("tenants")
      .withIndex("by_slug", (q) => q.eq("slug", slug))
      .unique();
    if (existing) throw new ConvexError(`A company with slug "${slug}" already exists.`);

    const admin = await findProfileByEmail(ctx, args.adminEmail);
    const now = Date.now();

    const tenantId = await ctx.db.insert("tenants", {
      name: companyName,
      slug,
      defaultCurrency,
      supportedCurrencies,
      status: "active",
      createdAt: now,
      createdBy: OPERATOR_ACTOR
    });

    const membershipId = await ctx.db.insert("memberships", {
      tenantId,
      userId: admin._id,
      role: "super_admin",
      status: "active",
      createdAt: now,
      createdBy: OPERATOR_ACTOR
    });

    await audit(ctx, {
      tenantId,
      action: "tenant.created",
      entityType: "tenants",
      entityId: tenantId,
      summary: `Company "${companyName}" created by operator.`,
      metadata: { after: { name: companyName, slug, defaultCurrency, supportedCurrencies } }
    });
    await audit(ctx, {
      tenantId,
      action: "membership.granted",
      entityType: "memberships",
      entityId: membershipId,
      summary: `${admin.email} granted super_admin by operator.`,
      metadata: { after: { userId: admin._id, role: "super_admin", status: "active" } }
    });

    return { tenantId, membershipId };
  }
});

/**
 * Grants (or changes) a registered user's role in a company. Interim operator
 * tool until the in-app user administration screen exists.
 */
export const grantMembership = internalMutation({
  args: {
    tenantSlug: v.string(),
    email: v.string(),
    role: appRole
  },
  handler: async (ctx, args) => {
    const tenant = await findTenantBySlug(ctx, args.tenantSlug);
    const profile = await findProfileByEmail(ctx, args.email);

    const existing: Doc<"memberships"> | null = await ctx.db
      .query("memberships")
      .withIndex("by_user_tenant", (q) =>
        q.eq("userId", profile._id).eq("tenantId", tenant._id)
      )
      .unique();

    if (existing) {
      if (existing.role === args.role && existing.status === "active") {
        return { membershipId: existing._id, changed: false };
      }
      const before = { role: existing.role, status: existing.status };
      await ctx.db.patch(existing._id, { role: args.role, status: "active" });
      await audit(ctx, {
        tenantId: tenant._id,
        action: "membership.updated",
        entityType: "memberships",
        entityId: existing._id,
        summary: `${profile.email} set to ${args.role} by operator.`,
        metadata: { before, after: { role: args.role, status: "active" } }
      });
      return { membershipId: existing._id, changed: true };
    }

    const membershipId = await ctx.db.insert("memberships", {
      tenantId: tenant._id,
      userId: profile._id,
      role: args.role,
      status: "active",
      createdAt: Date.now(),
      createdBy: OPERATOR_ACTOR
    });
    await audit(ctx, {
      tenantId: tenant._id,
      action: "membership.granted",
      entityType: "memberships",
      entityId: membershipId,
      summary: `${profile.email} granted ${args.role} by operator.`,
      metadata: { after: { userId: profile._id, role: args.role, status: "active" } }
    });
    return { membershipId, changed: true };
  }
});
