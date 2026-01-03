import fs from "node:fs";
import path from "node:path";
import { URL } from "node:url";

const eventFile = process.argv[2];
if (!eventFile) {
  console.error("Missing event file path argument");
  process.exit(1);
}

const { TS, APP_NAME, ENVIRONMENT, DEPLOY_URL, STATUS, SERVICES_FILE } =
  process.env;

if (!APP_NAME || !ENVIRONMENT || !DEPLOY_URL) {
  console.error(
    "Missing required env vars (APP_NAME, ENVIRONMENT, DEPLOY_URL)"
  );
  process.exit(1);
}

const payload = {
  timestamp: TS || "",
  app_name: APP_NAME,
  environment: ENVIRONMENT,
  deploy_url: DEPLOY_URL,
  status: STATUS || "success",
  services: [],
};

function stripQuotes(v) {
  if (!v) return "";
  const s = String(v).trim();
  if (
    s.length >= 2 &&
    ((s.startsWith('"') && s.endsWith('"')) ||
      (s.startsWith("'") && s.endsWith("'")))
  ) {
    return s.slice(1, -1);
  }
  return s;
}

function baseServiceNameFromHostLabel(label) {
  return String(label)
    .replace(/-(pr-\d+)$/i, "")
    .replace(/-(rel-[a-z0-9-]+)$/i, "")
    .replace(/-+$/g, "");
}

function inferServiceName(key, deployUrl) {
  try {
    const u = new URL(deployUrl);
    const host = u.hostname;
    if (host) {
      const label = host.split(".")[0];
      const base = baseServiceNameFromHostLabel(label);
      if (base) return base;
    }
  } catch {
    // ignore
  }

  return (
    String(key || "")
      .toLowerCase()
      .replace(/^export\s+/, "")
      .replace(/_url$/, "")
      .replace(/^mf_/, "")
      .replace(/_/g, "-")
      .replace(/[^a-z0-9-]/g, "")
      .replace(/-+/g, "-")
      .replace(/^-+/, "")
      .replace(/-+$/, "") || "unknown"
  );
}

function normalizeDeployUrl(v) {
  const raw = stripQuotes(v);
  if (!raw) return "";
  if (/^https?:\/\//i.test(raw)) return raw;
  if (/^[a-z0-9.-]+(:\d+)?(\/.*)?$/i.test(raw)) return `http://${raw}`;
  return "";
}

function parseEnvServicesFile(filePath) {
  if (!filePath) return [];
  if (!fs.existsSync(filePath)) return [];

  const out = [];
  const raw = fs.readFileSync(filePath, "utf8");
  for (const lineRaw of raw.split(/\r?\n/)) {
    const line = lineRaw.trim();
    if (!line) continue;
    if (line.startsWith("#")) continue;

    const withoutExport = line.startsWith("export ")
      ? line.slice("export ".length).trim()
      : line;
    const idx = withoutExport.indexOf("=");
    if (idx <= 0) continue;

    const key = withoutExport.slice(0, idx).trim();
    const val = withoutExport.slice(idx + 1).trim();
    const deployUrl = normalizeDeployUrl(val);
    if (!deployUrl) continue;

    out.push({
      timestamp: TS || "",
      app_name: inferServiceName(key, deployUrl),
      environment: ENVIRONMENT,
      deploy_url: deployUrl,
    });
  }
  return out;
}

payload.services = parseEnvServicesFile(SERVICES_FILE);

fs.mkdirSync(path.dirname(eventFile), { recursive: true });
fs.writeFileSync(eventFile, JSON.stringify(payload, null, 2) + "\n", "utf8");
