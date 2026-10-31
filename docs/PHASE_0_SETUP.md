# Phase 0 — Local setup, authentication and deployment

## Requirements
- Node.js LTS compatible with the selected Next.js release.
- npm.
- A Convex account.
- A Vercel account connected to the `ITMusumba/lumina` GitHub repository.

## 1. Local development (Convex dev deployment)
1. Clone the repository and run `npm install` (uses the committed `package-lock.json`).
2. Run `npx convex dev`. Log in, choose **Create a new project** and name it `lumina`.
   This creates your personal development deployment and writes `.env.local`
   (`CONVEX_DEPLOYMENT`, `NEXT_PUBLIC_CONVEX_URL`). Keep it running.
3. In a second terminal run `npx @convex-dev/auth` and enter `http://localhost:3000`
   as the site URL. This sets `SITE_URL`, `JWT_PRIVATE_KEY` and `JWKS` on the
   development deployment. `convex/auth.config.ts` is already committed; keep it if
   the CLI asks.
4. Run `npm run dev`, open `http://localhost:3000/sign-in` and register a test
   account. It should appear in the Convex dashboard under **Data → users** and
   **userProfiles**.

Convex Auth does **not** use an `AUTH_SECRET` variable; do not set one.

## 2. Production (Convex prod deployment)
1. In the Convex dashboard open the `lumina` project and switch to the
   **Production** deployment.
2. **Settings → Generate Production Deploy Key.** Copy it. Treat it as a secret:
   never commit it, paste it into chat or put it in `.env` files in the repository.
3. From a trusted machine run `npx @convex-dev/auth --prod` and enter the Vercel
   production URL (for example `https://lumina-xxxx.vercel.app`, or the custom
   domain once configured) as the site URL. This sets `SITE_URL`,
   `JWT_PRIVATE_KEY` and `JWKS` on the production deployment.
   Keep development and production keys separate.

## 3. Vercel
1. Vercel → **lumina** project → **Settings → Environment Variables**.
2. Add `CONVEX_DEPLOY_KEY` with the production deploy key, scoped to
   **Production** only.
3. Do not add `NEXT_PUBLIC_CONVEX_URL` for production: `convex deploy` injects it
   into the build automatically.
4. Preview deployments are not wired to a Convex backend yet. Configure a preview
   deploy key later if per-branch previews are needed.

The build command is set in `vercel.json`:

```
npx convex deploy --cmd 'npm run build'
```

On every production build this generates Convex types, pushes the schema and
functions to the production Convex deployment, then runs `next build` with the
correct `NEXT_PUBLIC_CONVEX_URL`. Settings in `vercel.json` override the Vercel
dashboard build command.

## 4. Verify
1. Push or merge to `main`. The Vercel deployment should reach **Ready**, and the
   build log should show Convex pushing functions before `next build`.
2. Open the production URL, go to `/sign-in` and register. The account should
   appear in the **Production** data in the Convex dashboard.
3. Locally: `npm run typecheck` (requires `npx convex dev` to have generated
   `convex/_generated`).

## 5. Provision the first company and administrator
Self-registration never grants access. After the owner registers at `/sign-in`
(they will see "Waiting for company access"), an operator with Convex dashboard
or CLI access runs the internal `admin:bootstrapTenant` function:

```
npx convex run admin:bootstrapTenant \
  '{"companyName":"<Company name>","slug":"<company-slug>","adminEmail":"<owner email>"}' --prod
```

Optional fields: `"defaultCurrency"` (default `UGX`) and
`"supportedCurrencies"` (e.g. `["UGX","USD"]`). Omit `--prod` to run against
your development deployment. The same function can be run from the Convex
dashboard: **Functions → admin:bootstrapTenant → Run function**.

Until the in-app user administration screen exists, grant further staff roles
after they register:

```
npx convex run admin:grantMembership \
  '{"tenantSlug":"<company-slug>","email":"<staff email>","role":"sales_agent"}' --prod
```

Roles: `super_admin`, `inventory_admin`, `sales_manager`, `technician`,
`sales_agent`. Both functions are `internalMutation`s, so browsers and clients
cannot call them, and both write audit events. The user's open "Waiting for
company access" page switches to the workspace automatically once access is
granted.

## 6. Tests
`npm test` runs the backend tests (Vitest + `convex-test`, in-memory, no
deployment needed). `convex/_generated` must exist first (`npx convex dev`).

## Authentication model
Lumina uses Convex Auth with the password provider through the client-side React
integration; it intentionally does not use the experimental Next.js server-side
authentication path. Convex Auth is currently beta.

`convex/auth.config.ts` tells Convex to trust tokens issued by the deployment's
own auth routes. Without it, every backend permission check treats the user as
signed out.

Newly registered identities are mapped to Lumina user profiles. Registration does
not grant access to a company or assign a role. A user must receive an active
company membership through a controlled administrator-provisioning process before
accessing company data.

Do not expose a public mutation that lets users create tenants, grant memberships,
or assign themselves `super_admin`. The first company and first administrator must
be provisioned through a restricted operator-controlled procedure: the internal
`admin:bootstrapTenant` function described above.

## Environment and security
Never commit `.env.local`, deploy keys, JWT keys, provider secrets or customer
data. Configure production values in the Convex and Vercel dashboards only.
