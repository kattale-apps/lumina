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
