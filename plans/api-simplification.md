# Plan: API Simplification

## Current State

`mfe-api` uses Nitro + Rolldown to serve a single hardcoded JSON response from `server.ts`. One file, zero routes, zero middleware. Nitro brings file-based routing, caching, storage layers, server plugins — none of which are used.

## Change: Replace Nitro with Hono

Hono is a minimal web framework (~14KB) built on standard Web APIs. It's a router + middleware, nothing more.

### mfe-api with Hono

```typescript
// server.ts
import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { cors } from "hono/cors";

const app = new Hono();

app.use("*", cors());

// Billing data
app.get("/api/v2/bills", (c) =>
  c.json({
    data: [
      { id: 1, title: "First title" },
      { id: 2, title: "Second title" },
    ],
    meta: { timestamp: new Date().toISOString() },
  })
);

// Mock auth (session endpoint)
app.get("/api/v1/session", (c) =>
  c.json({
    authenticated: true,
    user: { id: "user-1", name: "Test User" },
    mandates: [
      { id: "m-1", type: "residential", label: "Home" },
      { id: "m-2", type: "business", label: "Company OÜ" },
    ],
    activeMandate: "m-1",
  })
);

// Mock mandates
app.get("/api/v1/mandates", (c) =>
  c.json([
    { id: "m-1", type: "residential", label: "Home" },
    { id: "m-2", type: "business", label: "Company OÜ" },
  ])
);

serve({ fetch: app.fetch, port: 4000 });
```

### package.json

```json
{
  "type": "module",
  "scripts": {
    "dev": "tsx watch server.ts",
    "start": "tsx server.ts"
  },
  "dependencies": {
    "hono": "^4",
    "@hono/node-server": "^1"
  },
  "devDependencies": {
    "tsx": "^4"
  }
}
```

No build step for dev. `tsx watch` gives hot reload. For production, `tsx server.ts` or compile with `esbuild` to a single file.

### Config

`config.json` is NOT served by the API. It's a static file served by the host's nginx (same as CP). See [cp-runtime-config.md](cp-runtime-config.md).

### What's Removed

- Nitro (full server framework)
- Rolldown (bundler)
- srvx (preview server)
- Build step for dev

### What's Gained

- Single dependency for HTTP (Hono)
- No build step in dev
- Standard Web APIs (portable to Bun, Deno, Cloudflare Workers)
- Mock auth endpoints built in
- ~20 lines for the entire API

## Migration Steps

1. Replace `nitro` + `rolldown` + `srvx` with `hono` + `@hono/node-server` + `tsx`
2. Rewrite `server.ts` with Hono routes
3. Add `/api/v1/session` and `/api/v1/mandates` mock endpoints
5. Update Dockerfile (`tsx server.ts` instead of Nitro build output)
6. Update `package.json` scripts
