# Plan: Multi-Country / Multi-Instance Support

## What CP Does

3 countries (EE, LV, LT) × 3 instances (external, internal, app). Separate builds per combination. Per-country HTML injection (GTM, chat widgets). Per-country language sets and API endpoints.

## Approach: Country as Config, Not Build

One build. Country is a runtime config value that drives:
- Which languages are available
- Which translations to load
- Which API endpoint to use
- Which analytics/GTM tag to inject

## File Structure in mfe-infra

```
mfe-infra/
  live.env                  ← MFE versions (same for all countries)
  config/
    ee.json                 ← Estonia config
    lv.json                 ← Latvia config
    lt.json                 ← Lithuania config
```

### live.env — Shared Across Countries

Pins MFE versions. Same versions deploy to all countries:

```
MFE_HOST_WEB=rel-0.2.0
MFE_SHELL=rel-0.1.3
MFE_BILLING=rel-0.3.1
MFE_DASHBOARD=rel-0.2.0
MFE_API=rel-0.1.5
MFE_TRANSLATIONS=rel-0.0.8
```

### config/{country}.json — Per Country

Each country has its own config with country-specific settings:

```json
// config/ee.json
{
  "country": "EE",
  "languages": ["et", "en", "ru"],
  "defaultLanguage": "et",
  "gtm": "GTM-P8TJJKF",
  "features": {}
}
```

```json
// config/lv.json
{
  "country": "LV",
  "languages": ["lv", "en", "ru"],
  "defaultLanguage": "lv",
  "gtm": "GTM-NP23SLV",
  "features": {}
}
```

API and translation URLs are NOT in config — they come from env vars (`MFE_API_URL`, `MFE_TRANSLATIONS_URL`) injected into containers by the deploy script from `live.env` / `.env.services`. The host reads them via `import.meta.env.MFE_*`. Config only has country-specific application settings.

### Separation of Concerns

| | `live.env` / `.env.services` | `config.json` |
|--|---|---|
| When | Deploy-time | Runtime (browser) |
| Who reads it | Deploy script → K8s env vars | Host app on startup |
| Contains | Service versions → resolved to URLs | Country, languages, GTM, features |
| No overlap | Service URLs never in config.json | App settings never in env.services |

## How Deployment Works

### Live: One Namespace Per Country

The live deploy workflow reads `live.env` + `config/`, then deploys once per country:

```
For each config/{country}.json:
  1. Namespace: live-ee, live-lv, live-lt
  2. Deploy all MFE images from live.env (same versions)
  3. Mount config/{country}.json as /config.json via K8s ConfigMap
  4. Set ingress: ee.app.fachwerk.dev → live-ee
                  lv.app.fachwerk.dev → live-lv
                  lt.app.fachwerk.dev → live-lt
```

Same images, same code, different config per namespace. Adding a country = add a `config/{country}.json` + DNS record.

### RC: Same Structure

```
rc-ee.fachwerk.dev → rc-ee namespace
rc-lv.fachwerk.dev → rc-lv namespace
```

RC deploys all countries too, so you can test per-country before going live.

### Previews: Single Country

PR and release previews are single-country (default EE). No per-country preview URLs — keeps it simple. The preview loads `config/ee.json` by default. Reviewers can test other countries by switching config via a dropdown in the shell (overrides `window.__MFE_CONFIG__` and reloads).

```
mfe-host-web-pr-11.mfe.fachwerk.dev → always EE config
```

## What Country Affects at Runtime

| Concern | Source | How |
|---------|--------|-----|
| Languages | `config.languages` | i18next init, language selector in shell |
| Translations | Resolved from MFE_TRANSLATIONS version + domain | i18next-http-backend fetches `/{lang}/{ns}.json` |
| API | Resolved from MFE_API version + domain | Injected as env var into MFE containers |
| GTM / analytics | `config.gtm` | Host injects `<script>` on startup |
| Domain | K8s ingress per namespace | `ee.app.fachwerk.dev`, `lv.app.fachwerk.dev` |

MFEs don't know about country — they use whatever languages and API URL the host provides.

## DNS

```bash
# Live
doctl compute domain records create fachwerk.dev --record-type A --record-name "ee.app" --record-data "$LB_IP"
doctl compute domain records create fachwerk.dev --record-type A --record-name "lv.app" --record-data "$LB_IP"
doctl compute domain records create fachwerk.dev --record-type A --record-name "lt.app" --record-data "$LB_IP"

# RC
doctl compute domain records create fachwerk.dev --record-type A --record-name "rc-ee" --record-data "$LB_IP"
doctl compute domain records create fachwerk.dev --record-type A --record-name "rc-lv" --record-data "$LB_IP"
doctl compute domain records create fachwerk.dev --record-type A --record-name "rc-lt" --record-data "$LB_IP"
```

## Mock Implementation (Prototype)

For now, just EE:
- Add `config/ee.json` to mfe-infra
- Host fetches `/config.json` on startup (served from public/ in dev, ConfigMap in K8s)
- Shell reads `config.languages` for language selector
- Shell reads `config.gtm` to conditionally inject GTM
- Add country selector dropdown in shell (dev only) that swaps config for testing
