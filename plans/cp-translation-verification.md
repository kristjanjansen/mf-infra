# Plan: Translation Verification

## What CP Does

The `cp-translations` repo has a custom verification script (TypeScript + Zod) that validates:
- Every translation key has values for all required languages per country
- No empty values
- JSON structure matches expected schema
- Runs as pre-commit hook and in CI

## Simplified Version for MFE Prototype

### Verification Script

Add a `verify` script to `mfe-translations` that checks the built output:

```typescript
// scripts/verify.mjs
import fs from "node:fs";
import path from "node:path";

const REQUIRED_LANGUAGES = ["en", "et"];
const NAMESPACES = ["billing", "dashboard", "cookiebot"];

const errors = [];

for (const ns of NAMESPACES) {
  const keys = new Set();

  // Collect all keys across languages
  for (const lang of REQUIRED_LANGUAGES) {
    const file = path.join("public", lang, `${ns}.json`);
    if (!fs.existsSync(file)) {
      errors.push(`Missing file: ${file}`);
      continue;
    }
    const data = JSON.parse(fs.readFileSync(file, "utf8"));
    Object.keys(data).forEach(k => keys.add(k));
  }

  // Check each key exists in all languages
  for (const lang of REQUIRED_LANGUAGES) {
    const file = path.join("public", lang, `${ns}.json`);
    if (!fs.existsSync(file)) continue;
    const data = JSON.parse(fs.readFileSync(file, "utf8"));
    for (const key of keys) {
      if (!data[key]) {
        errors.push(`Missing: ${lang}/${ns}.json → "${key}"`);
      }
    }
  }
}

if (errors.length) {
  console.error("Translation verification failed:\n" + errors.join("\n"));
  process.exit(1);
}

console.log("All translations verified.");
```

### Integration

```json
// package.json
"scripts": {
  "build": "node scripts/build.mjs",
  "verify": "node scripts/verify.mjs",
  "check": "npm run build && npm run verify"
}
```

Run `npm run check` in CI before deploy. Catches missing translations before they reach production.

### Mock Implementation

- Add `verify.mjs` to `mfe-translations/scripts/`
- Add `verify` and `check` scripts to package.json
- Run as part of PR workflow

### What to Skip

- Zod schema validation (overkill for flat key-value JSON)
- Per-country language sets (start with a single set)
- Pre-commit hook (CI check is sufficient)
- Warning suppression (`ignoredWarnings` field from CP)
