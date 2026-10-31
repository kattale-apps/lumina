import { Password } from "@convex-dev/auth/providers/Password";
import { convexAuth } from "@convex-dev/auth/server";
import type { DataModel } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";

export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [
    Password<DataModel>({
      profile(params) {
        const email = String(params.email ?? "").trim().toLowerCase();
        const suppliedName = String(params.name ?? "").trim();
        return {
          email,
          name: suppliedName || email.split("@")[0]
        };
      }
    })
  ],
  callbacks: {
    async afterUserCreatedOrUpdated(ctx: MutationCtx, { userId, profile }) {
      const authSubject = String(userId);
      const existing = await ctx.db
        .query("userProfiles")
        .withIndex("by_auth_subject", (q) =>
          q.eq("authSubject", authSubject)
        )
        .unique();

      const email =
        typeof profile.email === "string"
          ? profile.email.trim().toLowerCase()
          : undefined;
      const displayName =
        typeof profile.name === "string" && profile.name.trim()
          ? profile.name.trim()
          : email?.split("@")[0] ?? "Lumina user";

      if (existing) {
        await ctx.db.patch(existing._id, {
          email,
          displayName,
          updatedAt: Date.now()
        });
      } else {
        await ctx.db.insert("userProfiles", {
          authSubject,
          email,
          displayName,
          status: "active",
          createdAt: Date.now(),
          updatedAt: Date.now()
        });
      }
    }
  }
});
