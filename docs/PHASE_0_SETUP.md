# Phase 0 — Local setup and bootstrap

## Requirements
- Node.js LTS compatible with the selected Next.js release.
- npm.
- A Convex account and a development deployment.

## Install
1. Clone the private repository.
2. Run `npm install`.
3. Copy `.env.example` to `.env.local`.
4. Run `npx convex dev` and follow the prompts to create/select a Convex project.
5. Add the deployment URL to `NEXT_PUBLIC_CONVEX_URL`.
6. Run `npm run dev`.
7. Run `npm run typecheck` and `npm run build`.

## Authentication is intentionally not yet wired
The backend helpers expect an authenticated Convex identity whose `subject` maps to `userProfiles.authSubject`. Choose and configure the authentication provider before exposing protected operations. Do not create a public endpoint that lets a user assign themselves a privileged role.

## First company and first administrator
Tenant and initial administrator provisioning must be performed through a restricted, operator-controlled bootstrap process after authentication is configured. Do not expose tenant creation or super-admin assignment as an unauthenticated public mutation.

## Environment
Never commit `.env.local`, deployment credentials, provider secrets or customer data. Configure production environment variables in the hosting/backend dashboards.
