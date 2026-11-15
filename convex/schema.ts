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

export const quotationStatus = v.union(
  v.literal("draft"),
  v.literal("illustrative"),
  v.literal("submitted_for_technical_review"),
  v.literal("under_technical_review"),
  v.literal("revision_required"),
  v.literal("rejected"),
  v.literal("pending_commercial_approval"),
  v.literal("ready_for_official_issue"),
  v.literal("officially_issued"),
  v.literal("expired"),
  v.literal("withdrawn")
);

/**
 * One quoted line, with the price and product specification snapshot taken when
 * the revision was written. `floorUnitMinor` is a protected figure: it is never
 * sent to the browser.
 */
export const quotationLine = v.object({
  kind: v.union(v.literal("product"), v.literal("service")),
  productId: v.optional(v.id("products")),
  sku: v.optional(v.string()),
  description: v.string(),
  quantity: v.number(),
  unitListMinor: v.number(),
  unitPriceMinor: v.number(),
  floorUnitMinor: v.optional(v.number()),
  specSchemaVersion: v.optional(v.number()),
  specValues: v.optional(v.record(v.string(), v.union(v.number(), v.string(), v.boolean()))),
  warrantyMonths: v.optional(v.number())
});

/** A solar system that is already installed, as nameplate ratings typed in by an agent or the owner. */
export const existingSystem = v.object({
  systemType: v.union(
    v.literal("off_grid"),
    v.literal("hybrid"),
    v.literal("grid_tied"),
    v.literal("backup_only")
  ),
  // Nominal battery bank voltage, e.g. 12, 24 or 48.
  systemVoltage: v.optional(v.number()),
  inverter: v.optional(
    v.object({
      ratedW: v.number(),
      surgeW: v.optional(v.number()),
      // True when the panels plug straight into the inverter.
      hasSolarInput: v.boolean(),
      maxPvPowerW: v.optional(v.number()),
      maxPvVoltage: v.optional(v.number()),
      mpptMinVoltage: v.optional(v.number()),
      maxPvCurrentA: v.optional(v.number()),
      maxChargeA: v.optional(v.number())
    })
  ),
  controller: v.optional(
    v.object({
      technology: v.union(v.literal("MPPT"), v.literal("PWM")),
      maxChargeA: v.number(),
      maxPvVoltage: v.optional(v.number()),
      maxPvPowerW: v.optional(v.number())
    })
  ),
  panels: v.optional(
    v.object({
      count: v.number(),
      wp: v.number(),
      voc: v.optional(v.number()),
      vmp: v.optional(v.number()),
      isc: v.optional(v.number()),
      perString: v.optional(v.number())
    })
  ),
  batteries: v.optional(
    v.object({
      count: v.number(),
      nominalV: v.number(),
      ah: v.number(),
      chemistry: v.union(v.literal("lithium"), v.literal("lead_acid"), v.literal("unknown")),
      ageYears: v.optional(v.number())
    })
  )
});

/** What the owner of an existing system wants from an upgrade. */
export const upgradeNeeds = v.object({
  goals: v.array(
    v.union(v.literal("battery"), v.literal("panels"), v.literal("inverter"), v.literal("swaps"))
  ),
  dailyKwh: v.optional(v.number()),
  peakLoadW: v.optional(v.number()),
  backupHours: v.optional(v.number()),
  backupLoadW: v.optional(v.number())
});

/** One lesson of a Sales Academy module. `body` is plain text with simple headings and bullets. */
export const academyLesson = v.object({
  key: v.string(),
  title: v.string(),
  body: v.string(),
  videoUrl: v.optional(v.string())
});

/** One quiz question. `correctIndex` never leaves the server for learners. */
export const academyQuestion = v.object({
  key: v.string(),
  prompt: v.string(),
  options: v.array(v.string()),
  correctIndex: v.number(),
  explanation: v.optional(v.string())
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
    // Filled in by the person on their profile page.
    phone: v.optional(v.string()),
    // A face photo, cropped square; also printed on Academy certificates.
    photoStorageId: v.optional(v.id("_storage")),
    // Set once the person has saved their own profile, so sign-in never overwrites their name.
    profileUpdatedAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number()
  })
    .index("by_auth_subject", ["authSubject"])
    .index("by_photo", ["photoStorageId"])
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

  quotations: defineTable({
    tenantId: v.id("tenants"),
    customerId: v.id("customers"),
    siteId: v.id("customerSites"),
    // The technical basis is either a sizing configuration (these three) or an upgrade study.
    assessmentId: v.optional(v.id("assessments")),
    sizingRunId: v.optional(v.id("sizingRuns")),
    candidateIndex: v.optional(v.number()),
    upgradeStudyId: v.optional(v.id("upgradeStudies")),
    // The upgrade options the quotation was built from, by key.
    upgradeOptionKeys: v.optional(v.array(v.string())),
    ownerUserId: v.id("userProfiles"),
    status: quotationStatus,
    currentRevision: v.number(),
    // Set once, at official issue.
    officialNumber: v.optional(v.string()),
    issuedRevision: v.optional(v.number()),
    issuedAt: v.optional(v.number()),
    validUntil: v.optional(v.number()),
    reservationIds: v.optional(v.array(v.id("stockReservations"))),
    createdAt: v.number(),
    createdBy: v.string(),
    updatedAt: v.number()
  })
    .index("by_tenant", ["tenantId"])
    .index("by_tenant_owner", ["tenantId", "ownerUserId"])
    .index("by_tenant_status", ["tenantId", "status"])
    .index("by_tenant_number", ["tenantId", "officialNumber"]),

  // Immutable. A change to products, quantities, prices or terms is a new revision.
  quotationRevisions: defineTable({
    tenantId: v.id("tenants"),
    quotationId: v.id("quotations"),
    revision: v.number(),
    currency: v.string(),
    lines: v.array(quotationLine),
    taxBps: v.number(),
    validityDays: v.number(),
    // Free-text terms are unusual terms, which need a manager's approval.
    customTerms: v.optional(v.string()),
    subtotalMinor: v.number(),
    taxMinor: v.number(),
    totalMinor: v.number(),
    // Any line priced below its floor price, or custom terms.
    requiresCommercialApproval: v.boolean(),
    reason: v.optional(v.string()),
    // The sizing run revision this price list was built against.
    assessmentRevision: v.number(),
    createdAt: v.number(),
    createdBy: v.string(),
    illustrativePdf: v.optional(v.id("_storage")),
    officialPdf: v.optional(v.id("_storage"))
  }).index("by_quotation", ["quotationId", "revision"]),

  technicalReviews: defineTable({
    tenantId: v.id("tenants"),
    quotationId: v.id("quotations"),
    revision: v.number(),
    outcome: v.union(v.literal("approved"), v.literal("revision_required"), v.literal("rejected")),
    checklist: v.array(v.object({ key: v.string(), confirmed: v.boolean() })),
    reason: v.optional(v.string()),
    reviewerUserId: v.id("userProfiles"),
    createdAt: v.number()
  }).index("by_quotation", ["quotationId", "revision"]),

  commercialApprovals: defineTable({
    tenantId: v.id("tenants"),
    quotationId: v.id("quotations"),
    revision: v.number(),
    outcome: v.union(v.literal("approved"), v.literal("rejected")),
    reason: v.string(),
    approverUserId: v.id("userProfiles"),
    createdAt: v.number()
  }).index("by_quotation", ["quotationId", "revision"]),

  // One row per operation a device sent while it was offline. Makes retries safe:
  // an operation id that was already processed returns its stored outcome.
  offlineOperations: defineTable({
    tenantId: v.id("tenants"),
    opId: v.string(),
    userId: v.id("userProfiles"),
    type: v.string(),
    status: v.union(v.literal("applied"), v.literal("conflict"), v.literal("rejected")),
    // Device-generated id of the record this operation created, if any.
    entityClientId: v.optional(v.string()),
    entityId: v.optional(v.string()),
    message: v.optional(v.string()),
    revision: v.optional(v.number()),
    conflictId: v.optional(v.id("syncConflicts")),
    createdAt: v.number()
  })
    .index("by_tenant_op", ["tenantId", "opId"])
    .index("by_tenant_client", ["tenantId", "entityClientId"]),

  // An offline edit that could not be applied because the assessment moved on.
  // The device's version is kept here until a person chooses what to do with it.
  syncConflicts: defineTable({
    tenantId: v.id("tenants"),
    opId: v.string(),
    assessmentId: v.id("assessments"),
    ownerUserId: v.id("userProfiles"),
    baseRevision: v.number(),
    serverRevision: v.number(),
    reason: v.string(),
    clientInputs: v.any(),
    status: v.union(v.literal("open"), v.literal("kept_server"), v.literal("applied_mine")),
    createdAt: v.number(),
    resolvedAt: v.optional(v.number()),
    resolvedBy: v.optional(v.string())
  })
    .index("by_tenant_status", ["tenantId", "status"])
    .index("by_assessment", ["assessmentId"]),

  // An upgrade study of a customer's existing system. Append-only: a change is a new study.
  upgradeStudies: defineTable({
    tenantId: v.id("tenants"),
    customerId: v.id("customers"),
    siteId: v.id("customerSites"),
    ownerUserId: v.id("userProfiles"),
    system: existingSystem,
    needs: upgradeNeeds,
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
    report: v.any(),
    // Specification values of every product offered, as they were when the study ran.
    productSnapshots: v.any(),
    sourceRequestId: v.optional(v.id("quoteRequests")),
    // A technician's record that the reported ratings were checked against the real equipment.
    verification: v.optional(
      v.object({
        note: v.string(),
        verifiedAt: v.number(),
        verifiedByUserId: v.id("userProfiles"),
        verifierName: v.string()
      })
    ),
    createdAt: v.number(),
    createdBy: v.string(),
    actorUserId: v.id("userProfiles")
  })
    .index("by_tenant_time", ["tenantId", "createdAt"])
    .index("by_customer", ["customerId", "createdAt"]),

  // Sales Academy: a company's edited copy of one module. A module with no row uses the built-in text.
  academyModules: defineTable({
    tenantId: v.id("tenants"),
    key: v.string(),
    title: v.string(),
    summary: v.string(),
    lessons: v.array(academyLesson),
    questions: v.array(academyQuestion),
    passPercent: v.number(),
    // Raised on every content change, so an attempt records what it was taken against.
    version: v.number(),
    updatedAt: v.number(),
    updatedBy: v.string()
  }).index("by_tenant_key", ["tenantId", "key"]),

  // One quiz attempt. Append-only.
  academyAttempts: defineTable({
    tenantId: v.id("tenants"),
    userId: v.id("userProfiles"),
    moduleKey: v.string(),
    moduleVersion: v.number(),
    answers: v.array(v.number()),
    correct: v.number(),
    total: v.number(),
    scorePercent: v.number(),
    passed: v.boolean(),
    createdAt: v.number()
  })
    .index("by_user_module", ["tenantId", "userId", "moduleKey"])
    .index("by_tenant", ["tenantId"]),

  // Issued once, when a staff member has passed every module.
  academyCertificates: defineTable({
    tenantId: v.id("tenants"),
    userId: v.id("userProfiles"),
    number: v.string(),
    holderName: v.string(),
    companyName: v.string(),
    modules: v.array(
      v.object({ key: v.string(), title: v.string(), scorePercent: v.number(), passedAt: v.number() })
    ),
    issuedAt: v.number()
  })
    .index("by_tenant_user", ["tenantId", "userId"])
    .index("by_tenant", ["tenantId"]),

  numberSequences: defineTable({
    tenantId: v.id("tenants"),
    key: v.string(),
    next: v.number()
  }).index("by_tenant_key", ["tenantId", "key"]),

  // Phase 6: what happened to an issued quotation. One outcome per quotation.
  dealOutcomes: defineTable({
    tenantId: v.id("tenants"),
    quotationId: v.id("quotations"),
    customerId: v.id("customers"),
    ownerUserId: v.id("userProfiles"),
    outcome: v.union(v.literal("won"), v.literal("lost")),
    reason: v.optional(v.string()),
    revision: v.number(),
    currency: v.string(),
    subtotalMinor: v.number(),
    totalMinor: v.number(),
    decidedAt: v.number(),
    decidedBy: v.string()
  })
    .index("by_quotation", ["quotationId"])
    .index("by_tenant_time", ["tenantId", "decidedAt"])
    .index("by_tenant_owner", ["tenantId", "ownerUserId"]),

// Switches on the public power check for one company and holds its tariff.
  publicEstimatorSettings: defineTable({
    tenantId: v.id("tenants"),
    enabled: v.boolean(),
    // Cost of one kWh of grid electricity, in minor units of the company currency.
    tariffMinorPerKwh: v.number(),
    contactPhone: v.optional(v.string()),
    contactEmail: v.optional(v.string()),
    updatedAt: v.number(),
    updatedBy: v.string()
  })
    .index("by_tenant", ["tenantId"])
    .index("by_enabled", ["enabled"]),

  // A quote request from someone who is not staff. It holds no prices.
  quoteRequests: defineTable({
    tenantId: v.id("tenants"),
    name: v.string(),
    phone: v.string(),
    email: v.optional(v.string()),
    location: v.string(),
    gridAvailability: v.union(v.literal("none"), v.literal("unreliable"), v.literal("reliable")),
    inputMode: v.union(v.literal("bill"), v.literal("appliances"), v.literal("existing_system")),
    dailyKwh: v.number(),
    costPerMonthMinor: v.optional(v.number()),
    systemType: v.union(
      v.literal("off_grid"),
      v.literal("hybrid"),
      v.literal("grid_tied"),
      v.literal("backup_only")
    ),
    backupHours: v.optional(v.number()),
    autonomyDays: v.optional(v.number()),
    optionKey: v.string(),
    optionTitle: v.string(),
    components: v.array(
      v.object({
        role: v.string(),
        name: v.string(),
        brand: v.optional(v.string()),
        model: v.optional(v.string()),
        quantity: v.number(),
        detail: v.optional(v.string())
      })
    ),
    // The load lines the estimate used, so a conversion starts from the same numbers.
    lines: v.array(assessmentLine),
    status: v.union(
      v.literal("new"),
      v.literal("assigned"),
      v.literal("converted"),
      v.literal("closed")
    ),
    assignedToUserId: v.optional(v.id("userProfiles")),
    customerId: v.optional(v.id("customers")),
    assessmentId: v.optional(v.id("assessments")),
    // Set for "existing_system" requests: the system the person described and what they want from it.
    upgrade: v.optional(v.object({ system: existingSystem, needs: upgradeNeeds })),
    upgradeStudyId: v.optional(v.id("upgradeStudies")),
    // Where the power is needed (home, business, industry), when the person said.
    category: v.optional(
      v.union(v.literal("residential"), v.literal("commercial_small"), v.literal("commercial_medium"), v.literal("industrial"))
    ),
    // The customer account the recommendation goes to: set when sent signed in, or claimed after signing up.
    customerAccountId: v.optional(v.id("customerAccounts")),
    // Secret handed to an anonymous requester so the request can be attached to the account they create next.
    claimToken: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number()
  })
    .index("by_tenant_time", ["tenantId", "createdAt"])
    .index("by_tenant_phone_time", ["tenantId", "phone", "createdAt"])
    .index("by_tenant_assignee", ["tenantId", "assignedToUserId"])
    .index("by_claim_token", ["claimToken"])
    .index("by_customer_account", ["customerAccountId", "createdAt"]),

  // A technician's answer to a quote request: a message and up to three system options.
  requestResponses: defineTable({
    tenantId: v.id("tenants"),
    requestId: v.id("quoteRequests"),
    status: v.union(v.literal("draft"), v.literal("sent")),
    message: v.string(),
    options: v.array(
      v.object({
        // Stable id chosen by the editor, so photos stay with their option.
        key: v.string(),
        title: v.string(),
        description: v.string(),
        components: v.array(v.object({ name: v.string(), quantity: v.number() })),
        priceMinor: v.optional(v.number())
      })
    ),
    // The option the customer said they want, by key.
    chosenOptionKey: v.optional(v.string()),
    chosenAt: v.optional(v.number()),
    preparedByUserId: v.id("userProfiles"),
    sentAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number()
  })
    .index("by_request", ["requestId"])
    .index("by_tenant_chosen", ["tenantId", "chosenAt"]),

  // A phone with the Android app that checks in the background for new messages.
  // Only a hash of its secret key is kept.
  appDevices: defineTable({
    userId: v.id("userProfiles"),
    keyHash: v.string(),
    createdAt: v.number()
  })
    .index("by_key_hash", ["keyHash"])
    .index("by_user", ["userId"]),

  // When someone last opened their messages: customers their recommendations, staff the quote requests.
  inboxSeen: defineTable({
    userId: v.id("userProfiles"),
    kind: v.union(v.literal("customer"), v.literal("staff")),
    seenAt: v.number()
  }).index("by_user_kind", ["userId", "kind"]),

  // Photos a technician attaches to one option of a response.
  responseImages: defineTable({
    tenantId: v.id("tenants"),
    requestId: v.id("quoteRequests"),
    optionKey: v.string(),
    storageId: v.id("_storage"),
    contentType: v.string(),
    size: v.number(),
    createdAt: v.number()
  })
    .index("by_request", ["requestId"])
    .index("by_storage", ["storageId"]),


  // A customer who signed up to browse the catalogue and place orders. Not staff.
  customerAccounts: defineTable({
    tenantId: v.id("tenants"),
    userId: v.id("userProfiles"),
    name: v.string(),
    phone: v.string(),
    createdAt: v.number()
  })
    .index("by_user", ["userId"])
    .index("by_tenant", ["tenantId"]),

  // An order placed by a customer. Prices are the list prices at the time; staff confirm the final order.
  shopOrders: defineTable({
    tenantId: v.id("tenants"),
    customerAccountId: v.id("customerAccounts"),
    customerName: v.string(),
    customerPhone: v.string(),
    deliveryLocation: v.string(),
    note: v.optional(v.string()),
    currency: v.string(),
    items: v.array(
      v.object({
        productId: v.id("products"),
        name: v.string(),
        brand: v.string(),
        model: v.string(),
        sku: v.string(),
        quantity: v.number(),
        unitPriceMinor: v.number()
      })
    ),
    totalMinor: v.number(),
    status: v.union(v.literal("new"), v.literal("confirmed"), v.literal("cancelled")),
    createdAt: v.number(),
    updatedAt: v.number()
  })
    .index("by_tenant_time", ["tenantId", "createdAt"])
    .index("by_customer_time", ["customerAccountId", "createdAt"]),
  operationsSettings: defineTable({
    tenantId: v.id("tenants"),
    // Commission as basis points of the pre-tax value of a won deal. 0 = none.
    commissionBps: v.number(),
    updatedAt: v.number(),
    updatedBy: v.string()
  }).index("by_tenant", ["tenantId"]),

  commissions: defineTable({
    tenantId: v.id("tenants"),
    dealId: v.id("dealOutcomes"),
    quotationId: v.id("quotations"),
    agentUserId: v.id("userProfiles"),
    currency: v.string(),
    baseMinor: v.number(),
    // The rate is copied here so later policy changes never rewrite history.
    rateBps: v.number(),
    amountMinor: v.number(),
    status: v.union(
      v.literal("accrued"),
      v.literal("approved"),
      v.literal("paid"),
      v.literal("cancelled")
    ),
    createdAt: v.number(),
    approvedAt: v.optional(v.number()),
    approvedBy: v.optional(v.string()),
    paidAt: v.optional(v.number()),
    paidBy: v.optional(v.string()),
    paymentReference: v.optional(v.string()),
    cancelReason: v.optional(v.string())
  })
    .index("by_tenant_status", ["tenantId", "status"])
    .index("by_tenant_agent", ["tenantId", "agentUserId"])
    .index("by_deal", ["dealId"]),

  installations: defineTable({
    tenantId: v.id("tenants"),
    quotationId: v.id("quotations"),
    customerId: v.id("customers"),
    siteId: v.id("customerSites"),
    ownerUserId: v.id("userProfiles"),
    technicianUserId: v.optional(v.id("userProfiles")),
    status: v.union(
      v.literal("pending"),
      v.literal("scheduled"),
      v.literal("in_progress"),
      v.literal("completed"),
      v.literal("cancelled")
    ),
    scheduledFor: v.optional(v.number()),
    startedAt: v.optional(v.number()),
    completedAt: v.optional(v.number()),
    notes: v.optional(v.string()),
    cancelReason: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number()
  })
    .index("by_tenant_status", ["tenantId", "status"])
    .index("by_quotation", ["quotationId"])
    .index("by_tenant_technician", ["tenantId", "technicianUserId"]),

  // Written when an installation is completed, from the quoted warranty months.
  warranties: defineTable({
    tenantId: v.id("tenants"),
    installationId: v.id("installations"),
    quotationId: v.id("quotations"),
    customerId: v.id("customers"),
    productId: v.optional(v.id("products")),
    sku: v.optional(v.string()),
    description: v.string(),
    quantity: v.number(),
    months: v.number(),
    startsAt: v.number(),
    endsAt: v.number()
  })
    .index("by_tenant_end", ["tenantId", "endsAt"])
    .index("by_customer", ["customerId"])
    .index("by_installation", ["installationId"]),

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
