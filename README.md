# Co-Roc

Co-Roc is a collaborative engineering configuration workspace for OpenRocket
vehicles. It combines editable ORK geometry, team access control, traceable
revisions, engineering documentation, test evidence, comments and simulation
results.

## Runtime

The web application runs on vinext and deploys directly to infrastructure owned
by the Co-Roc project:

- Cloudflare Workers for the application and API
- Cloudflare D1 for accounts and traceable engineering records
- Cloudflare R2 for ORK files, drawings, photos, videos and simulation results
- a free Render Docker service running official OpenRocket Core simulations

## Local development

Prerequisite: Node.js 22.13 or newer.

```bash
pnpm install
pnpm dev
```

## Validation and deployment

```bash
pnpm test
pnpm run db:migrate:production
pnpm run deploy
```

`wrangler.jsonc` contains the production Worker, D1 and R2 bindings. Secrets
belong in Cloudflare and local `.env` files, never in source control.

`gateway/vercel.json` is a stateless custom-domain gateway. It lets a domain
registered at Wix point to Co-Roc using ordinary A and CNAME records while the
application and all project data remain on Cloudflare.

The root `render.yaml` deploys `openrocket-service` as a free Frankfurt web
service. Configure the generated Render URL as the Cloudflare Worker secret
`OPENROCKET_SIM_URL`, and use the same high-entropy value for
`SIMULATION_SERVICE_TOKEN` on Render and `OPENROCKET_SIM_TOKEN` on Cloudflare.

## Accounts

Co-Roc owns its account system. Passwords are salted and hashed, sessions are
stored in D1, and team roles and rocket access are enforced server-side.
