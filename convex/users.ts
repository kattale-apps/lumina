import { query } from "./_generated/server";
import { findViewerProfile, listActiveMemberships } from "./lib/auth";

/**
 * What the signed-in user may see. Never throws for the ordinary
 * "not signed in" / "no company yet" cases so the UI can route on `state`.
 */
export const viewerContext = query({
  args: {},
  handler: async (ctx) => {
    const viewer = await findViewerProfile(ctx);
    if (!viewer) return { state: "signed_out" as const };

    const { profile } = viewer;
    // The profile is written in the same transaction as the auth user, so
    // this is only expected briefly or after manual data repair.
    if (!profile) return { state: "profile_missing" as const };
    if (profile.status !== "active") return { state: "disabled" as const };

    const memberships = await listActiveMemberships(ctx, profile._id);

    return {
      state: memberships.length > 0 ? ("active" as const) : ("awaiting_access" as const),
      profile: {
        id: profile._id,
        displayName: profile.displayName,
        email: profile.email
      },
      companies: memberships.map(({ membership, tenant }) => ({
        tenantId: tenant._id,
        companyName: tenant.name,
        defaultCurrency: tenant.defaultCurrency,
        role: membership.role
      }))
    };
  }
});
