# Plan: App-Wide and App-Specific Routing

## Goal

Support two levels of routing with standard browser history (no hash routing):
1. **App-wide**: Host routes top-level paths (`/orders`, `/billing`, `/dashboard`) to MFEs
2. **App-specific**: Each MFE owns its own sub-routes internally (`/orders/order/1`, `/orders/new`) using React Router

## Current State

The host uses React Router with exact path matching per MFE:
```jsx
<Route path="/billing" element={<MfElement mf={billing} />} />
```

MFEs have no internal routing — they render a single view. The host only matches the exact top-level path.

## The Problem

If `mfe-orders` needs sub-routes like `/orders/order/1`:
- The host route `path="/orders"` won't match `/orders/order/1` (no wildcard)
- Even with a wildcard, the MFE needs to know its sub-path (`/order/1`) to render the right view
- The MFE needs its own React Router, but two routers (host + MFE) can fight over `window.location`
- Browser back/forward must work across both levels

## Approach

### 1. Host: Wildcard Routes

Change host routes from exact to wildcard with `/*`:

```jsx
<Route path="/orders/*" element={<MfElement mf={mfs.orders} />} />
<Route path="/billing/*" element={<MfElement mf={mfs.billing} />} />
```

Now `/orders/order/1` matches the orders MFE.

### 2. MFE: Internal React Router with `basename`

Each MFE that needs sub-routes uses its own `BrowserRouter` (not `HashRouter`) scoped to its base path:

```tsx
// Inside mfe-orders
import { BrowserRouter, Routes, Route } from "react-router-dom";

function OrdersApp({ basePath }: { basePath: string }) {
  return (
    <BrowserRouter basename={basePath}>
      <Routes>
        <Route path="/" element={<OrderList />} />
        <Route path="/order/:id" element={<OrderDetail />} />
        <Route path="/new" element={<NewOrder />} />
      </Routes>
    </BrowserRouter>
  );
}
```

`basename="/orders"` makes the MFE's router only care about the path after `/orders`. When it calls `navigate("/order/1")`, the browser URL becomes `/orders/order/1`.

### 3. Passing `basePath` to MFEs

The host knows each MFE's mount path. Pass it as an attribute on the custom element:

```jsx
// Host
<Route path="/orders/*" element={<MfElement mf={mfs.orders} slot="content" />} />
```

The config already has `path`:
```typescript
orders: {
  route: true,
  env: "VITE_MFE_ORDERS_URL",
  tag: "mfe-orders",
  path: "/orders",
}
```

Update `registerCustomElement` to observe a `base-path` attribute and pass it as a prop:

```typescript
// In the custom element
static get observedAttributes() {
  return ["base-path"];
}

attributeChangedCallback(name, _old, value) {
  if (name === "base-path") {
    this.basePath = value ?? "/";
    this.render();
  }
}

// render() passes basePath to <App basePath={this.basePath} />
```

Host sets it:
```tsx
// MfElement component
<mf-orders base-path={mf.path} slot="content" />
```

### 4. Syncing Navigation Events with Sub-Routes

When an MFE navigates internally (e.g., `/orders` -> `/orders/order/1`), the host's React Router doesn't know. This matters for:
- Shell navigation highlighting the correct top-level item
- Browser URL is already correct (MFE's BrowserRouter handles `pushState`)
- Host just needs to know the full path changed

MFE listens to its own router and emits the full path:
```typescript
// Inside MFE, a useEffect on location
window.dispatchEvent(new CustomEvent("mfe:route-changed", {
  detail: { path: location.pathname }  // e.g., "/orders/order/1"
}));
```

The shell uses the top-level segment (`/orders`) for active state — it doesn't need to know about `/order/1`.

### 5. Host-Initiated Navigation into MFE Sub-Routes

If the host needs to deep-link into an MFE (e.g., clicking a link to `/orders/order/5`):
- Host route `path="/orders/*"` matches and mounts the MFE
- MFE reads `window.location.pathname` on mount
- MFE's `BrowserRouter` with `basename="/orders"` interprets the remaining `/order/5`
- No extra coordination needed — it just works because both read the same `window.location`

### 6. MFEs Without Sub-Routes

MFEs that don't need internal routing (e.g., cookiebot) stay exactly as they are — no `BrowserRouter`, no `base-path` attribute. The `base-path` attribute is optional.

## Route Ownership Summary

```
window.location.pathname: /orders/order/1
                          ├──────┤├───────┤
                          Host    MFE
                          routes  routes
                          this    this
```

| Layer | Owns | Router | Example |
|-------|------|--------|---------|
| Host | Top-level segment | React Router in host | `/orders/*` -> mount mfe-orders |
| MFE | Everything after base | React Router in MFE with `basename` | `/order/:id` -> OrderDetail |

## Migration Steps

1. Add `/*` wildcard to host routes
2. Add `base-path` attribute support to `registerCustomElement`
3. Update `MfElement` host component to set `base-path` from config
4. Add `BrowserRouter` with `basename` to MFEs that need sub-routes
5. MFEs emit `mfe:route-changed` on internal navigation for shell awareness

## Considerations

- **Single `window.history`**: Both routers use the same history stack. This works because the MFE's `basename` scopes its router. Browser back/forward works naturally.
- **MFE dev mode**: When running an MFE standalone (`APP=mfe-orders npm run dev`), `basename` should default to `/` so the dev server works at root. Pass `base-path="/"` or omit it.
- **SSR**: Not applicable — MFEs are client-rendered Web Components.
