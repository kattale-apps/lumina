// Tells Convex to trust JWTs issued by this deployment's Convex Auth routes.
// Without this file ctx.auth.getUserIdentity() always returns null.
export default {
  providers: [
    {
      domain: process.env.CONVEX_SITE_URL,
      applicationID: "convex"
    }
  ]
};
