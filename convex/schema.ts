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

export const customerType = v.union(
  v.literal("residential"),
  v.literal("commercial"),
  v.literal("institutional"),
  v.literal("agricultural"),
  v.literal("industrial")
);

/** One appliance line in an assessment. Power is in watts, schedule in whole hours of the day. */
export const assessmentLine = v.object({
  name: v.string(),
  applianceId: v.optional(v.id("appliances")),
  quantity: v.number(),
  powerW: v.number(),
  powerSource: v.union(v.literal("nameplate"), v.literal("measured"), v.literal("estimate")),
  powerFactor: v.optional(v.number()),
  surgeW: v.optional(v.number()),
  // Only where rated input is not continuous consumption; needs a justification.
  dutyFactor: v.optional(v.number()),
  dutyJustification: v.optional(v.string()),
  currentType: v.union(v.literal("ac"), v.literal("dc")),
  critical: v.boolean(),
  // Half-open hour windows [start, end) within one day, 0 to 24.
  windows: v.array(v.object({ start: v.number(), end: v.number() }))
});

export const assessmentInputs = v.object({
  systemType: v.union(
    v.literal("off_grid"),
    v.literal("hybrid"),
    v.literal("grid_tied"),
    v.literal("backup_only")
  ),
  backupHours: v.optional(v.number()),
  autonomyDays: v.optional(v.number()),
  criticalCircuits: v.optional(v.string()),
  // A commercial constraint only; it never substitutes for technical sizing.
  budget: v.optional(v.object({ currency: v.string(), amountMinor: v.number() })),
  notes: v.optional(v.string()),
  lines: v.array(assessmentLine)
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

  // Current quantity per product per warehouse. Only changed together with a movement.
  stockBalances: defineTable({
    tenantId: v.id("tenants"),
    productId: v.id("products"),
    warehouseId: v.id("warehouses"),
    onHand: v.number(),
    updatedAt: v.number()
  })
    .index("by_tenant", ["tenantId"])
    .index("by_product_warehouse", ["productId", "warehouseId"]),

  // Append-only stock ledger. Quantities are signed whole units.
  stockMovements: defineTable({
    tenantId: v.id("tenants"),
    productId: v.id("products"),
    warehouseId: v.id("warehouses"),
    type: v.union(
      v.literal("receipt"),
      v.literal("issue"),
      v.literal("adjustment"),
      v.literal("transfer_out"),
      v.literal("transfer_in")
    ),
    quantity: v.number(),
    balanceAfter: v.number(),
    reference: v.optional(v.string()),
    reason: v.optional(v.string()),
    // Pairs the two legs of a transfer.
    transferId: v.optional(v.string()),
    // Client-generated key so a retried submission cannot post twice.
    idempotencyKey: v.optional(v.string()),
    createdAt: v.number(),
    createdBy: v.string(),
    actorUserId: v.id("userProfiles")
  })
    .index("by_tenant_time", ["tenantId", "createdAt"])
    .index("by_product_time", ["productId", "createdAt"])
    .index("by_tenant_key", ["tenantId", "idempotencyKey"]),

  // Explicit, expiring holds. Quotations never deduct stock; they reserve it.
  stockReservations: defineTable({
    tenantId: v.id("tenants"),
    productId: v.id("products"),
    warehouseId: v.id("warehouses"),
    quantity: v.number(),
    expiresAt: v.number(),
    status: v.union(v.literal("active"), v.literal("released"), v.literal("fulfilled")),
    reference: v.optional(v.string()),
    createdAt: v.number(),
    createdBy: v.string(),
    resolvedAt: v.optional(v.number())
  })
    .index("by_tenant_status", ["tenantId", "status"])
    .index("by_product_warehouse", ["productId", "warehouseId", "status"]),

  // Product images and datasheets, held in Convex file storage.
  productFiles: defineTable({
    tenantId: v.id("tenants"),
    productId: v.id("products"),
    storageId: v.id("_storage"),
    kind: v.union(v.literal("image"), v.literal("datasheet")),
    fileName: v.string(),
    contentType: v.string(),
    size: v.number(),
    createdAt: v.number(),
    createdBy: v.string()
  })
    .index("by_product", ["productId"])
    .index("by_storage", ["storageId"]),

  customers: defineTable({
    tenantId: v.id("tenants"),
    name: v.string(),
    phone: v.string(),
    email: v.optional(v.string()),
    type: customerType,
    notes: v.optional(v.string()),
    status: v.union(v.literal("active"), v.literal("archived")),
    // The agent who owns the relationship; agents see only their own customers.
    ownerUserId: v.id("userProfiles"),
    createdAt: v.number(),
    createdBy: v.string(),
    updatedAt: v.number()
  })
    .index("by_tenant", ["tenantId"])
    .index("by_tenant_owner", ["tenantId", "ownerUserId"]),

  customerSites: defineTable({
    tenantId: v.id("tenants"),
    customerId: v.id("customers"),
    name: v.string(),
    address: v.string(),
    region: v.string(),
    // Stored only when the customer has consented to location capture.
    gps: v.optional(v.object({ lat: v.number(), lng: v.number() })),
    gpsConsent: v.boolean(),
    gridAvailability: v.union(
      v.literal("none"),
      v.literal("unreliable"),
      v.literal("reliable")
    ),
    existingSystem: v.optional(v.string()),
    status: v.union(v.literal("active"), v.literal("archived")),
    createdAt: v.number(),
    createdBy: v.string(),
    updatedAt: v.number()
  })
    .index("by_customer", ["customerId"])
    .index("by_tenant", ["tenantId"]),

  // Company appliance library. Values are starting estimates, never measurements.
  appliances: defineTable({
    tenantId: v.id("tenants"),
    name: v.string(),
    category: v.string(),
    powerW: v.number(),
    surgeW: v.optional(v.number()),
    powerFactor: v.optional(v.number()),
    typicalHoursPerDay: v.number(),
    currentType: v.union(v.literal("ac"), v.literal("dc")),
    status: v.union(v.literal("active"), v.literal("archived")),
    createdAt: v.number(),
    createdBy: v.string(),
    updatedAt: v.number()
  })
    .index("by_tenant", ["tenantId"])
    .index("by_tenant_name", ["tenantId", "name"]),

  assessments: defineTable({
    tenantId: v.id("tenants"),
    customerId: v.id("customers"),
    siteId: v.id("customerSites"),
    ownerUserId: v.id("userProfiles"),
    status: v.union(v.literal("draft"), v.literal("completed")),
    // Number of the latest saved revision. Revisions are append-only.
    currentRevision: v.number(),
    createdAt: v.number(),
    createdBy: v.string(),
    updatedAt: v.number()
  })
    .index("by_tenant", ["tenantId"])
    .index("by_tenant_owner", ["tenantId", "ownerUserId"])
    .index("by_customer", ["customerId"]),

  // Immutable snapshot of the inputs at each save, with the engine version and results used.
  assessmentRevisions: defineTable({
    tenantId: v.id("tenants"),
    assessmentId: v.id("assessments"),
    revision: v.number(),
    inputs: assessmentInputs,
    results: v.any(),
    engineVersion: v.string(),
    createdAt: v.number(),
    createdBy: v.string()
  }).index("by_assessment", ["assessmentId", "revision"]),

  // Append-only record of one sizing run: everything needed to reproduce and audit it.
  sizingRuns: defineTable({
    tenantId: v.id("tenants"),
    assessmentId: v.id("assessments"),
    assessmentRevision: v.number(),
    assumptions: v.object({
      peakSunHours: v.number(),
      solarResourceSource: v.string(),
      performanceRatio: v.number(),
      defaultDod: v.number(),
      dischargeEfficiency: v.number(),
      roundTripEfficiency: v.number(),
      inverterEfficiency: v.number(),
      inverterHeadroom: v.number(),
      minCellTempC: v.number(),
      maxCellTempC: v.number(),
      gridTiedOffset: v.number()
    }),
    engineVersion: v.string(),
    requirements: v.any(),
    outcome: v.any(),
    // Specification values of every product considered, as they were at run time.
    productSnapshots: v.any(),
    createdAt: v.number(),
    createdBy: v.string(),
    actorUserId: v.id("userProfiles")
  }).index("by_assessment", ["assessmentId", "createdAt"]),

  // A technician's recorded decision on a check that needed review.
  sizingResolutions: defineTable({
    tenantId: v.id("tenants"),
    runId: v.id("sizingRuns"),
    candidateIndex: v.number(),
    checkId: v.string(),
    note: v.string(),
    createdAt: v.number(),
    createdBy: v.string(),
    actorUserId: v.id("userProfiles")
  }).index("by_run", ["runId"]),

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
