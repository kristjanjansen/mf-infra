# Plan: Service Config in package.json

## Problem

`.env.services` is a flat file with no structure:
- Shared across all MFEs in mfe-frontends (cookiebot records api dependency it doesn't use)
- Port hardcoded in workflows
- Service tag hardcoded in workflows
- Custom parsing logic in deploy script
- No per-MFE dependency granularity

## Approach: `mfe` field in package.json

Move service config into `package.json` under an `mfe` key. No extra files, standard JSON, per-MFE granularity.

### Single-service repos (mfe-api, mfe-host-web, mfe-translations)

```json
{
  "name": "mfe-api",
  "mfe": {
    "tag": "mfe-api",
    "port": 4000,
    "dependencies": {}
  }
}
```

```json
{
  "name": "mfe-host-web",
  "mfe": {
    "tag": "mfe-host-web",
    "port": 4000,
    "dependencies": {
      "mfe-layout": "rel-0.0.7",
      "mfe-billing": "rel-0.0.7",
      "mfe-dashboard": "rel-0.0.7",
      "mfe-cookiebot": "rel-0.0.7"
    }
  }
}
```

### Multi-service repos (mfe-frontends)

```json
{
  "name": "mfe-frontends",
  "mfe": {
    "apps": {
      "mfe-billing": {
        "port": 4000,
        "dependencies": {
          "mfe-api": "rel-0.0.7",
          "mfe-translations": "rel-0.0.7"
        }
      },
      "mfe-dashboard": {
        "port": 4000,
        "dependencies": {
          "mfe-api": "rel-0.0.7",
          "mfe-translations": "rel-0.0.7"
        }
      },
      "mfe-layout": {
        "port": 4000,
        "dependencies": {}
      },
      "mfe-cookiebot": {
        "port": 4000,
        "dependencies": {
          "mfe-translations": "rel-0.0.7"
        }
      }
    }
  }
}
```

## What Changes

### Workflows

Currently workflows hardcode `service_name` and `port`:
```yaml
with:
  service_name: mfe-api
  port: "4000"
```

After: workflows read from `package.json`:
```bash
TAG=$(jq -r '.mfe.tag // .mfe.apps[env.SERVICE_NAME].tag // env.SERVICE_NAME' package.json)
PORT=$(jq -r '.mfe.port // .mfe.apps[env.SERVICE_NAME].port // "4000"' package.json)
```

### Deploy Script

Currently parses `.env.services` line by line. After: reads `package.json` with `jq`:

```bash
# Single-service repo
DEPS=$(jq -r '.mfe.dependencies // {} | to_entries[] | "\(.key)=\(.value)"' package.json)

# Multi-service repo
DEPS=$(jq -r --arg app "$SERVICE_NAME" '.mfe.apps[$app].dependencies // {} | to_entries[] | "\(.key)=\(.value)"' package.json)
```

### Record Script

Same change — reads dependencies from `package.json` instead of `.env.services`. Each MFE records only its own dependencies.

### DAG

Correct edges:
- mfe-host-web → mfe-layout, mfe-billing, mfe-dashboard, mfe-cookiebot
- mfe-billing → mfe-api, mfe-translations
- mfe-dashboard → mfe-api, mfe-translations
- mfe-cookiebot → mfe-translations
- mfe-layout → (none)
- mfe-api → (none)
- mfe-translations → (none)

## What Gets Removed

- `.env.services` files (all repos)
- Custom `.env.services` parsing in `deploy.sh`
- Custom parsing in `record.mjs`
- Hardcoded `service_name` and `port` in release workflows
- The `.env.services` → `.env` resolution step in workflows

## Migration Steps

1. Add `mfe` field to `package.json` in all repos
2. Update deploy script to read `package.json` instead of `.env.services`
3. Update record script to read dependencies from `package.json`
4. Update release workflows to read tag/port from `package.json`
5. Remove `.env.services` files
6. Retag and deploy to verify correct DAG edges
