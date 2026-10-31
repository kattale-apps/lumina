# Phase 0 — Local setup, authentication and deployment

## Requirements
- Node.js LTS compatible with the selected Next.js release.
- npm.
- A Convex account and a development deployment.
- A Vercel account connected to the Lumina GitHub repository.

## Install and connect Convex
1. Clone the private repository.
2. Run `npm install`.
3. Copy `.env.example` to `.env.local`.
4. Run `npx convex dev` and follow the prompts to create/select the Lumina Convex project.
5. Copy the deployment's `.convex.cloud` URL into `NEXT_PUBLIC_CONVEX_URL`.
6. Copy the matching `.convex.site` URL into `NEXT_PUBLIC_CONVEX_SITE_URL`.
7. Generate a strong secret locally and set it on the development deployment:
   `npx convex env set AUTH_SECRET "<generated-secret>"`.
   Do not commit or paste this secret into source control.
8. Keep `npx convex dev` running while developing.

## Authentication
Lumina uses Convex Auth with the password provider. The web app uses the client-side provider integration; it intentionally does not depend on the experimental Next.js server-side authentication path.

Newly registered identities are mapped to Lumina user profiles. Registration does not grant access to a company or assign a role. A user must receive an active company membership through a controlled administrator-provisioning process before accessing company data.

Do not expose a public mutation that lets users create tenants, grant memberships, or assign themselves `super_admin`. The first company and first administrator must be provisioned through a restricted operator-controlled procedure.

Convex Auth is currently documented as beta. Its Next.js server-side authentication support is experimental; this project therefore uses the supported client-side integration for now.

## Local verification
1. Run `npm run dev`.
2. Run `npm run typecheck`.
3. Run `npm run build`.

## Vercel
1. Import the GitHub repository `ITMusumba/lumina` into Vercel.
2. Select Next.js and keep the project root at the repository root.
3. Add `NEXT_PUBLIC_CONVEX_URL` and `NEXT_PUBLIC_CONVEX_SITE_URL` to Development, Preview and Production as appropriate.
4. Configure the matching `AUTH_SECRET` on each Convex deployment. Keep development and production secrets separate.
5. Deploy the Convex backend to production using a production Convex deployment key from a secure CI/Vercel secret, or the Convex CLI from a trusted operator environment. Do not put the deployment key in source control.
6. Vercel builds the Next.js application using `npm run build`. Backend deployment and frontend deployment are separate operations unless a deliberate CI pipeline is configured.

## Environment and security
Never commit `.env.local`, deployment credentials, provider secrets or customer data. Configure production environment variables in the hosting/backend dashboards.
