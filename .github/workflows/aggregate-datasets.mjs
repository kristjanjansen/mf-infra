import fs from "node:fs";
import path from "node:path";

const repoRoot = process.cwd();
const eventsRoot = path.join(repoRoot, "events");
const datasetsDir = path.join(repoRoot, "datasets");

function walk(dir) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p));
    else if (e.isFile() && e.name.endsWith(".json")) out.push(p);
  }
  return out;
}

function readJson(p) {
  const raw = fs.readFileSync(p, "utf8");
  return JSON.parse(raw);
}

const eventFiles = walk(eventsRoot);
const events = [];
for (const f of eventFiles) {
  try {
    const e = readJson(f);
    if (e && typeof e === "object") events.push(e);
  } catch {
    // ignore
  }
}

events.sort((a, b) =>
  String(a.timestamp || "").localeCompare(String(b.timestamp || ""))
);

fs.mkdirSync(datasetsDir, { recursive: true });

const generatedAt = new Date().toISOString();

const eventsJson = {
  generated_at: generatedAt,
  events,
};

fs.writeFileSync(
  path.join(datasetsDir, "events.json"),
  JSON.stringify(eventsJson, null, 2) + "\n"
);

const apps = new Map();
for (const e of events) {
  if (!e.app_name) continue;
  if (!apps.has(e.app_name)) {
    apps.set(e.app_name, {
      id: e.app_name,
      label: e.app_name,
      environment: e.environment || "",
      deploy_url: e.deploy_url || "",
      last_timestamp: e.timestamp || "",
      status: e.status || "",
    });
  } else {
    const cur = apps.get(e.app_name);
    const ts = String(e.timestamp || "");
    if (ts && ts >= String(cur.last_timestamp || "")) {
      cur.environment = e.environment || cur.environment;
      cur.deploy_url = e.deploy_url || cur.deploy_url;
      cur.last_timestamp = e.timestamp || cur.last_timestamp;
      cur.status = e.status || cur.status;
    }
  }
}

const children = [...apps.values()]
  .sort((a, b) => a.label.localeCompare(b.label))
  .map((a) => ({
    id: a.id,
    label: a.label,
    meta: {
      environment: a.environment,
      deploy_url: a.deploy_url,
      last_timestamp: a.last_timestamp,
      status: a.status,
    },
  }));

const depsJson = {
  generated_at: generatedAt,
  root: {
    id: "mf-infra",
    label: "mf-infra",
    children,
  },
};

fs.writeFileSync(
  path.join(datasetsDir, "deps.json"),
  JSON.stringify(depsJson, null, 2) + "\n"
);
