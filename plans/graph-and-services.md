# Plan: Dependency Graph Visualization and .env.services

## Problems

### 1. Duplicate Nodes in the Graph

The current tree builder (`aggregate-datasets.mjs`) creates a **tree**, not a **graph**. In a tree, each node can only have one parent. When `mf-billing` and `mf-dashboard` both depend on `mf-api`, the tree duplicates `mf-api` as a child of each:

```
mf-host-web
├── mf-billing
│   ├── mf-api          ← duplicate
│   └── mf-translations ← duplicate
├── mf-dashboard
│   ├── mf-api          ← duplicate
│   └── mf-translations ← duplicate
```

In reality `mf-api` and `mf-translations` are single services. The graph should show them once with multiple edges pointing to them.

### 2. .env.services Is Fragmented

Dependencies are declared per-repo in `.env.services` files:
- `mf-host-web/.env.services` lists MFE URLs (layout, navigation, billing, dashboard, cookiebot)
- `mf-frontends/.env.services` lists shared service URLs (translations, api)

This means:
- The same shared service appears in multiple `.env.services` files
- The graph builder sees them as separate per-parent dependencies
- No single place to see the full dependency picture

### 3. Data Structure Issues

Current `events.json` event shape:
```json
{
  "timestamp": "2026-01-03T10:40:56Z",
  "app_name": "mf-host-web",
  "environment": "pr",
  "deploy_url": "http://mf-host-web-pr-11.localtest.me",
  "status": "success",
  "services": [
    {
      "timestamp": "2026-01-03T10:40:56Z",
      "app_name": "mf-layout",
      "environment": "rel",
      "deploy_url": "http://mf-layout-rel-0-0-4.localtest.me"
    }
  ]
}
```

Problems:
- **`app_name`** — ambiguous (repo? MFE? instance?). Should be `service`.
- **`environment`** — value is `"pr"` or `"rel"`, which is the deployment type, not an environment. Sometimes wrong (event says `"pr"` but URL contains `rel-0-0-4`). Derivable from `version` prefix — drop it.
- **`deploy_url`** — verbose. Just `url`.
- **No `version` field** — version is buried in the URL string (`pr-3`, `rel-0-0-1`), has to be reverse-parsed. Should be first-class.
- **Redundant `timestamp` on services** — every service entry repeats the parent's timestamp. Not when the service was deployed — when the parent was deployed. Useless.
- **`url` on services** — computable from `service` + `version` + domain. Storing it couples events to a specific provider's URLs.

Current `deps.json` node shape:
```json
{
  "id": "mf-billing",
  "label": "mf-billing",
  "meta": {
    "environment": "pr",
    "deploy_url": "...",
    "last_timestamp": "...",
    "status": "success"
  }
}
```

Problems:
- **`id` and `label`** always identical — one field is enough, use `service`.
- **`meta` wrapper** — unnecessary nesting, flatten to top-level fields.
- **`last_timestamp`** — unclear what "last" means. Use `last_deployed`.
- **Hidden root node** (`mf-infra`) — not a real service, just a layout hack for d3.tree.

## Changes

### 1. Clean Up Data Structures

**events.json — new event shape:**
```json
{
  "timestamp": "2026-01-03T10:40:56Z",
  "service": "mfe-host-web",
  "version": "pr-11",
  "url": "https://mfe-host-web-pr-11.mfe.fachwerk.dev",
  "status": "success",
  "services": [
    { "service": "mfe-layout",     "version": "rel-0.0.4" },
    { "service": "mfe-navigation", "version": "rel-0.0.4" },
    { "service": "mfe-billing",    "version": "pr-3" },
    { "service": "mfe-dashboard",  "version": "pr-3" },
    { "service": "mfe-cookiebot",  "version": "pr-3", "declared": "latest-rel" }
  ]
}
```

- `app_name` → `service`
- `environment` dropped — derivable from `version` prefix (`pr-*` or `rel-*`)
- `deploy_url` → `url`
- `version` added as first-class field — always the resolved concrete version (e.g., `rel-0.0.2`, never `latest-rel`)
- Version format: dotted semver for releases (`rel-0.0.2`), number for PRs (`pr-3`). URL slugs convert dots to dashes (`rel-0-0-2`) for DNS-safe hostnames — the deploy script handles this.
- `declared` on services — optional, only present when the `.env.services` entry differs from the resolved version (i.e., was `latest-rel` or `latest-pr`). Answers "is this pinned or floating?"
- Services are `{ service, version, declared? }` only — no timestamp, no url (computable from service + version + domain)

**deps.json — new node shape:**
```json
{
  "service": "mfe-host-web",
  "version": "pr-11",
  "url": "https://mfe-host-web-pr-11.mfe.fachwerk.dev",
  "status": "success",
  "last_deployed": "2026-01-03T10:40:56Z"
}
```

- `id`/`label` → `service`
- `meta` wrapper removed — fields are top-level
- `last_timestamp` → `last_deployed`
- Hidden root node removed (not needed with DAG layout)

**deps.json — new edge shape:**
```json
{ "from": "mfe-host-web", "to": "mfe-billing" }
{ "from": "mfe-host-web", "to": "mfe-cookiebot", "declared": "latest-rel" }
```

`declared` on edges is optional — only present when the dependency was declared as `latest-rel` or `latest-pr`. The graph can render these edges differently (e.g., dashed line) to indicate floating vs pinned dependencies.

### 2. Switch from Tree to DAG (Directed Acyclic Graph)

The visualization should be a **DAG** — each service is one node, with multiple edges allowed.

**Data model change** — `deps.json` becomes a flat node list + edge list instead of a nested tree:

```json
{
  "generated_at": "...",
  "nodes": [
    { "service": "mfe-host-web",    "version": "pr-11",    "url": "...", "status": "success", "last_deployed": "..." },
    { "service": "mfe-billing",     "version": "pr-3",     "url": "...", "status": "success", "last_deployed": "..." },
    { "service": "mfe-dashboard",   "version": "pr-3",     "url": "...", "status": "success", "last_deployed": "..." },
    { "service": "mfe-api",         "version": "rel-0.0.1","url": "...", "status": "success", "last_deployed": "..." },
    { "service": "mfe-translations","version": "pr-2",     "url": "...", "status": "success", "last_deployed": "..." }
  ],
  "edges": [
    { "from": "mfe-host-web", "to": "mfe-billing" },
    { "from": "mfe-host-web", "to": "mfe-dashboard" },
    { "from": "mfe-billing",  "to": "mfe-api" },
    { "from": "mfe-billing",  "to": "mfe-translations" },
    { "from": "mfe-dashboard", "to": "mfe-api" },
    { "from": "mfe-dashboard", "to": "mfe-translations" }
  ]
}
```

Now `mfe-api` is one node with two incoming edges. No duplication.

**aggregate-datasets.mjs changes:**
- Build a `Map<string, node>` for unique nodes
- Build a `Set<string>` of `"source->target"` pairs for unique edges
- Output `{ nodes, edges }` instead of a nested tree

### 2. D3 Layout: Tree → DAG

Replace `d3.tree()` with a layered DAG layout. Options:

**Option A: d3-dag library** — purpose-built for DAG layouts (Sugiyama algorithm). Handles node positioning with shared children natively.

**Option B: Keep d3.tree() with deduplication** — compute tree layout, then merge duplicate nodes into one position and draw extra edges. Simpler but hackier.

**Recommendation: Option A (d3-dag)**. The Sugiyama layout produces clean layered graphs and handles the exact case we have (shared dependencies across branches).

Rendering changes in `index.js`:
- Nodes are positioned by d3-dag's layout (not d3.tree)
- Edges are drawn between positioned nodes (same bezier curve approach)
- Each node renders once regardless of how many parents it has

### 3. Redesign .env.services

#### Problem: No Version Visibility

Currently `.env.services` hardcodes full URLs:
```
VITE_MF_BILLING_URL=http://mf-billing-pr-3.localtest.me
VITE_API_URL=http://mf-api-rel-0-0-1.localtest.me
```

This has multiple problems:
- **Can't tell what version is running where** — the version is buried in a URL string, mixed with provider-specific domain
- URLs are provider-specific (`.localtest.me`) — same file won't work on DO
- Env var names are inconsistent (`VITE_MF_BILLING_URL` vs `VITE_API_URL`)
- When a dependency releases a new version, you manually edit URLs in every consumer

#### New Format: Name + Version

`.env.services` becomes a simple dependency declaration:

```
MFE_BILLING=pr-3
MFE_DASHBOARD=pr-3
MFE_COOKIEBOT=pr-3
MFE_API=rel-0.0.1
MFE_TRANSLATIONS=rel-0.0.2
```

No URLs, no domains, no framework prefixes. Just service name and version.

The deploy script resolves these to full URLs using the provider config:
```bash
# From providers/local/config.env: DOMAIN=localtest.me
# MFE_BILLING=pr-3 → http://mfe-billing-pr-3.localtest.me

# From providers/digitalocean/config.env: DOMAIN=mfe.fachwerk.dev
# MFE_BILLING=pr-3 → https://mfe-billing-pr-3.mfe.fachwerk.dev
```

Then generates the framework-specific env vars automatically:
```bash
# MFE_BILLING → MFE_BILLING_URL=https://mfe-billing-pr-3.mfe.fachwerk.dev
# MFE_API     → MFE_API_URL=https://mfe-api-rel-0-0-1.mfe.fachwerk.dev
```

Convention: `MFE_` prefix everywhere. The deploy script maps `MFE_BILLING` → service name `mfe-billing` (lowercase, underscores to hyphens) for URL construction, and → `MFE_BILLING_URL` for runtime env vars.

Vite config change to expose `MFE_*` vars to the client:
```typescript
// vite.config.ts — during migration, accept both prefixes:
export default defineConfig({
  envPrefix: ["MFE_", "VITE_"],
});

// after migration, drop VITE_:
export default defineConfig({
  envPrefix: "MFE_",
});
```

During migration both `VITE_MF_BILLING_URL` and `MFE_BILLING_URL` work. Once all code is updated to `import.meta.env.MFE_*`, remove `"VITE_"` from the array.

For Expo: `EXPO_PUBLIC_MFE_*` stays as-is (Expo requires its prefix), but `.env.services` is still `MFE_*` — the deploy script adds the `EXPO_PUBLIC_` prefix when targeting Expo.

#### latest-rel and latest-pr

For dependencies where you always want the newest release:

```
MFE_API=latest-rel
MFE_TRANSLATIONS=latest-rel
```

The deploy script resolves `latest-rel` by checking which versions actually exist in the cluster:

```bash
# Query K8s namespaces matching the service
kubectl get namespaces -o name | grep "mfe-api-rel-"
# Returns: mfe-api-rel-0-0-1, mfe-api-rel-0-0-2
# Picks highest semver: rel-0-0-2
```

**Critical: Resolved versions are always recorded.** The deploy event and the graph always show the actual version, never "latest-rel". The resolution happens at deploy time:

```
.env.services says:    mfe-api=latest-rel
Deploy script resolves: mfe-api=rel-0.0.2
Event records:          mfe-api rel-0.0.2 at https://mfe-api-rel-0-0-2.mfe.fachwerk.dev
Graph shows:            mfe-api [rel 0.0.2]
```

`latest-rel` is an input shorthand, never a stored value. You always know exactly what version is where.

Similarly, `latest-pr` resolves to the highest PR number for that service.

#### Version Visibility in the Graph

With resolved versions, every node in the graph shows the concrete version:

```
┌─────────────────────┐
│ mfe-api  [rel 0.0.2]│
│ mfe-api-rel-0-0-2.… │
└─────────────────────┘
```

The node data model has `version` as a first-class field:

```json
{
  "service": "mfe-api",
  "version": "rel-0.0.2",
  "url": "https://mfe-api-rel-0-0-2.mfe.fachwerk.dev",
  "last_deployed": "2026-01-03T10:38:12Z"
}
```

The dashboard renders version prominently — it's the key info you need to know what's running where.

#### Cascading Redeployment

When `mfe-api` deploys a new release, consumers using `latest-rel` are stale. The graph data knows the dependency edges. A post-deploy workflow can:

1. `mfe-api` deploys `rel-0.0.3`
2. Query `deps.json` edges for all services that depend on `mfe-api`
3. For each consumer: check if their `.env.services` says `mfe-api=latest-rel`
4. If yes: trigger a redeployment of that consumer (which re-resolves `latest-rel` to `rel-0.0.3`)

This is optional — you can also just redeploy consumers manually. But the data is there to automate it.

#### Release Dependency Constraint

A release deployment must only depend on releases — never on PR previews. A PR preview can depend on anything (other PRs or releases).

The deploy script enforces this:

The check runs **after** `latest-rel` / `latest-pr` are resolved to concrete versions:

```
MFE_API=latest-rel  → resolves to rel-0.0.2  → ✅ pass
MFE_API=rel-0.0.2                             → ✅ pass
MFE_API=latest-pr   → resolves to pr-7        → ❌ fail
MFE_API=pr-7                                  → ❌ fail
```

`latest-rel` is safe in release deploys because it always resolves to a release. `latest-pr` would fail — which is correct.

For PR previews, any mix is fine — you might test a PR of billing against the latest release of api, or against another PR.

#### Validation

Before deploying, the deploy script health-checks each resolved dependency:

```bash
for each dependency in .env.services:
  resolve version → URL
  curl --fail --max-time 5 "$URL" || error "Dependency $name ($version) is unreachable"
```

Fail the deploy early if a dependency is down or doesn't exist yet.

### 4. Historical Graph View

The dashboard can show the graph state at any past point by filtering `state/deploys.json` up to a selected timestamp and rebuilding the graph client-side. No separate snapshot files needed — the deploy history already contains all the data.

**Dashboard UI:** Add a timeline slider. Selecting a past timestamp replays deploys up to that point and re-renders the graph. Default view is current state (all deploys).

### 5. Aggregation Deduplication Logic

In `aggregate-datasets.mjs`, when building edges:

```javascript
const nodes = new Map();   // service -> { service, version, url, status, last_deployed }
const edges = new Set();   // "from->to" strings

for (const event of events) {
  upsertNode(nodes, event.service, event);

  for (const svc of event.services) {
    upsertNode(nodes, svc.service, svc);
    edges.add(`${event.service}->${svc.service}`);
  }
}
```

Same service referenced by multiple parents = one node, multiple edges. Done.

## Migration Steps

1. Rename directories: `events/` → `deploys/`, `datasets/` → `state/` (`state/deploys.json`, `state/graph.json`)
2. Update `record.mjs` to emit new event shape (`service`, `version`, `url`, services as `{ service, version, declared? }`)
3. Update `aggregate-datasets.mjs` to output DAG format (`nodes` + `edges`, no tree, no hidden root)
3. Change `.env.services` format to `KEY=version` with UPPERCASE convention
4. Update `deploy.sh` to resolve `KEY=version` → URLs using provider config
3. Update `deploy.sh` to resolve `latest-rel` / `latest-pr` by querying K8s namespaces
4. Update `record.mjs` to record resolved versions in events
5. Update `aggregate-datasets.mjs` to output `{ nodes, edges }` format with version field
6. Replace `d3.tree()` in `index.js` with d3-dag Sugiyama layout
7. Update node rendering to show version prominently
8. Add timeline slider to dashboard (rebuild graph from deploys.json up to selected timestamp)
9. Add pre-deploy validation (health-check resolved URLs)
11. (Optional) Add cascading redeployment workflow
