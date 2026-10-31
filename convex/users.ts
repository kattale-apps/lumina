import { query } from "./_generated/server";
import { requireAnyActiveMembership } from "./lib/auth";

export const viewerContext = query({
  args: {},
  handler: async (ctx) => {
    const result = await requireAnyActiveMembership(ctx);

    return {
      profile: {
        id: result.profile._id,
        displayName: result.profile.displayName,
        email: result.profile.email
      },
      companies: result.memberships.map(({ membership, tenant }) => ({
        tenantId: tenant._id,
        companyName: tenant.name,
        role: membership.role
      }))
    };
  }
});
