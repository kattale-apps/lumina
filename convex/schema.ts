import { authTables } from "@convex-dev/auth/server";
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export const appRole = v.union(
  v.literal("super_admin"),
  v.literal("inventory_admin"),
  v.literal("sales_manager"),
  v.literal("technician"),
  v.literal("sales_agent")
);

export const specFieldType = v.union(
  v.literal("number"),
  v.literal("text"),
  v.literal("boolean"),
  v.literal("choice")
);

/**
 * One typed specification a product in a category can carry. `key` and
 * `type` never change once created, so stored product values stay valid.
 */
export const specField = v.object({
  key: v.string(),
  label: v.string(),
  type: specFieldType,
  // Explicit unit for number fields, e.g. "V", "A", "Wp", "kWh".
  unit: v.optional(v.string()),
  options: v.optional(v.array(v.string())),
  required: v.boolean(),
  // Compatibility and sizing checks need this value; missing means "cannot validate".
  critical: v.boolean(),
  retired: v.boolean()
});

export default defineSchema({
  ...authTables,

  tenants: defineTable({
    name: v.string(),
    slug: v.string(),
    defaultCurrency: v.string(),
    supportedCurrencies: v.array(v.string()),
    status: v.union(v.literal("active"), v.literal("suspended")),
    createdAt: v.number(),
    createdBy: v.string()
  })
    .index("by_slug", ["slug"])
    .index("by_status", ["status"]),

  userProfiles: defineTable({
    // Stable Convex Auth user ID, not the session-specific JWT subject.
    authSubject: v.string(),
    email: v.optional(v.string()),
    displayName: v.string(),
    status: v.union(v.literal("active"), v.literal("disabled")),
    createdAt: v.number(),
    updatedAt: v.number()
  })
    .index("by_auth_subject", ["authSubject"])
    .index("by_email", ["email"]),

  memberships: defineTable({
    tenantId: v.id("tenants"),
    userId: v.id("userProfiles"),
    role: appRole,
    status: v.union(v.literal("active"), v.literal("invited"), v.literal("suspended")),
    createdAt: v.number(),
    createdBy: v.string()
  })
    .index("by_user", ["userId"])
    .index("by_tenant", ["tenantId"])
    .index("by_user_tenant", ["userId", "tenantId"])
    .index("by_tenant_role", ["tenantId", "role"]),

  productCategories: defineTable({
    tenantId: v.id("tenants"),
    // Stable identifier, e.g. "pv_panel". Unique within the company.
    key: v.string(),
    name: v.string(),
    description: v.optional(v.string()),
    status: v.union(v.literal("active"), v.literal("archived")),
    specFields: v.array(specField),
    // Bumped on every specification change so snapshots can cite the definition used.
    schemaVersion: v.number(),
    createdAt: v.number(),
    createdBy: v.string(),
    updatedAt: v.number()
  })
    .index("by_tenant", ["tenantId"])
    .index("by_tenant_key", ["tenantId", "key"]),

  products: defineTable({
    tenantId: v.id("tenants"),
    categoryId: v.id("productCategories"),
    name: v.string(),
    brand: v.string(),
    model: v.string(),
    // Stock-keeping unit, unique within the company.
    sku: v.string(),
    warrantyMonths: v.optional(v.number()),
    description: v.optional(v.string()),
    specValues: v.record(v.string(), v.union(v.number(), v.string(), v.boolean())),
    // Version of the category specification these values were entered against.
    specSchemaVersion: v.number(),
    status: v.union(v.literal("active"), v.literal("archived")),
    createdAt: v.number(),
    createdBy: v.string(),
    updatedAt: v.number()
  })
    .index("by_tenant", ["tenantId"])
    .index("by_tenant_sku", ["tenantId", "sku"])
    .index("by_category", ["categoryId"]),

  // Append-only, effective-dated base costs. Admin-visible only.
  costRecords: defineTable({
    tenantId: v.id("tenants"),
    productId: v.id("products"),
    currency: v.string(),
    amountMinor: v.number(),
    effectiveFrom: v.number(),
    createdAt: v.number(),
    createdBy: v.string()
  }).index("by_product_effective", ["productId", "effectiveFrom"]),

  // Cost-plus-margin rules. The most specific rule wins: product, category, then default.
  marginRules: defineTable({
    tenantId: v.id("tenants"),
    scope: v.union(v.literal("default"), v.literal("category"), v.literal("product")),
    categoryId: v.optional(v.id("productCategories")),
    productId: v.optional(v.id("products")),
    // Target margin added on top of cost, in basis points (1% = 100).
    marginBps: v.number(),
    // Lowest margin any discount may reach. Enforced server-side when quoting.
    floorMarginBps: v.number(),
    updatedAt: v.number(),
    updatedBy: v.string()
  })
    .index("by_tenant", ["tenantId"])
    .index("by_tenant_scope", ["tenantId", "scope"])
    .index("by_category", ["categoryId"])
    .index("by_product", ["productId"]),

  warehouses: defineTable({
    tenantId: v.id("tenants"),
    name: v.string(),
    // Short stable identifier unique within the company, e.g. "KLA-MAIN".
    code: v.string(),
    location: v.optional(v.string()),
    status: v.union(v.literal("active"), v.literal("inactive")),
    createdAt: v.number(),
    createdBy: v.string(),
    updatedAt: v.number()
  })
    .index("by_tenant", ["tenantId"])
    .index("by_tenant_code", ["tenantId", "code"]),

  auditEvents: defineTable({
    tenantId: v.id("tenants"),
    actorUserId: v.optional(v.id("userProfiles")),
    actorSubject: v.string(),
    action: v.string(),
    entityType: v.string(),
    entityId: v.string(),
    occurredAt: v.number(),
    summary: v.string(),
    metadata: v.optional(v.any())
  })
    .index("by_tenant_time", ["tenantId", "occurredAt"])
    .index("by_entity", ["entityType", "entityId"])
    .index("by_actor_time", ["actorSubject", "occurredAt"])
});
