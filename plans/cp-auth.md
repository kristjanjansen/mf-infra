# Plan: Authentication & Mandates

## What CP Does

Session-based auth via `/api/v1/session`. Users can switch between mandates (business, residential, delegated). AuthProvider manages session state, customer data, and mandate list via React Context + TanStack Query.

## Simplified Version for MFE Prototype

### Mock Auth Flow

No real backend — simulate the session with a mock API endpoint that returns a fake user:

```json
// GET /api/v1/session
{
  "authenticated": true,
  "user": {
    "id": "user-1",
    "name": "Test User",
    "email": "test@example.com"
  },
  "mandates": [
    { "id": "m-1", "type": "residential", "label": "Home" },
    { "id": "m-2", "type": "business", "label": "Company OÜ" }
  ],
  "activeMandate": "m-1"
}
```

Add this to `mfe-api` as a Hono route.

### Auth in the Host

The host checks the session on startup and broadcasts auth state:

```typescript
// On app load
const session = await fetch("/api/v1/session").then(r => r.json());
window.__MFE_AUTH__ = session;
window.dispatchEvent(new CustomEvent("mfe:auth-changed", {
  detail: session
}));
```

MFEs read `window.__MFE_AUTH__` on mount (always available, set before MFEs load).

### Mandate Switching

The shell shows a mandate selector. On switch:

```typescript
window.dispatchEvent(new CustomEvent("mfe:mandate-changed", {
  detail: { mandateId: "m-2" }
}));
```

MFEs listen and refetch their data for the new mandate context. With TanStack Query, this is just invalidating queries:

```typescript
window.addEventListener("mfe:mandate-changed", () => {
  queryClient.invalidateQueries();
});
```

### AuthGuard

A wrapper component that shows login prompt (or redirects) if not authenticated:

```typescript
function AuthGuard({ children }) {
  const auth = useAuth();
  if (auth.loading) return <Loading />;
  if (!auth.authenticated) return <LoginRedirect />;
  return children;
}
```

Each MFE wraps its root in `AuthGuard`. The host doesn't need to know which MFEs require auth — they handle it themselves.

### Mock Implementation

- Add `/api/v1/session` and `/api/v1/mandates` to mfe-api
- Add a login/logout toggle in the shell (no real login form — just a button that flips the mock session)
- Add a mandate selector dropdown in the shell
- MFEs use `window.__MFE_AUTH__` for initial state and listen to `mfe:auth-changed` / `mfe:mandate-changed` events

### What to Skip

- Real authentication backend
- Token refresh / session expiry
- Remember-me
- Per-mandate permissions
