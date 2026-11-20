import { Password } from "@convex-dev/auth/providers/Password";
import { convexAuth } from "@convex-dev/auth/server";
import type { DataModel } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { acceptInvites, assertSignUpAllowed } from "./access";

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
    async afterUserCreatedOrUpdated(ctx: MutationCtx, { userId, profile, existingUserId }) {
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
          : email?.split("@")[0] ?? "Solar Switch user";

      if (existing) {
        await ctx.db.patch(existing._id, {
          email,
          // A name the person set on their profile page wins over the sign-in form.
          ...(existing.profileUpdatedAt ? {} : { displayName }),
          updatedAt: Date.now()
        });
      } else {
        // A brand-new account: only invited staff (or anyone, if public sign-up is on). Refusing
        // here undoes the whole sign-up, so no account is left behind.
        if (existingUserId === null) await assertSignUpAllowed(ctx, email);
        const profileId = await ctx.db.insert("userProfiles", {
          authSubject,
          email,
          displayName,
          status: "active",
          createdAt: Date.now(),
          updatedAt: Date.now()
        });
        await acceptInvites(ctx, (await ctx.db.get(profileId))!);
      }
    }
  }
});
