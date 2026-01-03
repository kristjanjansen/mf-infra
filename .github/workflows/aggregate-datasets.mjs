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
const latestServiceByName = new Map();
const referencedByOtherApps = new Set();

for (const e of events) {
  if (!e || typeof e !== "object") continue;
  if (!e.app_name) continue;

  const appName = String(e.app_name);
  const ts = String(e.timestamp || "");

  // Track latest deploy per app
  if (!apps.has(appName)) {
    apps.set(appName, {
      id: appName,
      label: appName,
      environment: e.environment || "",
      deploy_url: e.deploy_url || "",
      last_timestamp: e.timestamp || "",
      status: e.status || "",
      services: [],
    });
  }

  const cur = apps.get(appName);
  if (ts && ts >= String(cur.last_timestamp || "")) {
    cur.environment = e.environment || cur.environment;
    cur.deploy_url = e.deploy_url || cur.deploy_url;
    cur.last_timestamp = e.timestamp || cur.last_timestamp;
    cur.status = e.status || cur.status;
    cur.services = Array.isArray(e.services) ? e.services : [];
  }

  // Track latest info for each service, across all events
  if (Array.isArray(e.services)) {
    for (const s of e.services) {
      if (!s || typeof s !== "object") continue;
      if (!s.app_name) continue;
      const name = String(s.app_name);
      const sTs = String(s.timestamp || e.timestamp || "");

      referencedByOtherApps.add(name);

      const prev = latestServiceByName.get(name);
      if (!prev || sTs >= String(prev.last_timestamp || "")) {
        latestServiceByName.set(name, {
          id: name,
          label: name,
          environment: s.environment || "",
          deploy_url: s.deploy_url || "",
          last_timestamp: s.timestamp || e.timestamp || "",
        });
      }
    }
  }
}

function uniqSorted(arr) {
  return [...new Set(arr)].sort((a, b) => a.localeCompare(b));
}

function serviceNamesFromApp(app) {
  const names = [];
  for (const s of app.services || []) {
    if (s && typeof s === "object" && s.app_name) {
      names.push(String(s.app_name));
    }
  }
  return uniqSorted(names);
}

function metaForName(name) {
  const app = apps.get(name);
  if (app) {
    return {
      environment: app.environment,
      deploy_url: app.deploy_url,
      last_timestamp: app.last_timestamp,
      status: app.status,
    };
  }
  const svc = latestServiceByName.get(name);
  return {
    environment: svc?.environment || "",
    deploy_url: svc?.deploy_url || "",
    last_timestamp: svc?.last_timestamp || "",
  };
}

function buildNode(name, visiting) {
  const meta = metaForName(name);
  const node = {
    id: name,
    label: name,
    meta,
  };

  if (visiting.has(name)) return node;

  const app = apps.get(name);
  if (!app) return node;

  visiting.add(name);
  const deps = serviceNamesFromApp(app);
  if (deps.length) {
    node.children = deps.map((dep) => buildNode(dep, visiting));
  }
  visiting.delete(name);

  return node;
}

// Ensure any referenced service name appears as a node even if it has no standalone deploy event.
for (const name of latestServiceByName.keys()) {
  if (apps.has(name)) continue;
  const meta = latestServiceByName.get(name);
  apps.set(name, {
    id: name,
    label: name,
    environment: meta?.environment || "",
    deploy_url: meta?.deploy_url || "",
    last_timestamp: meta?.last_timestamp || "",
    status: "",
    services: [],
  });
}

const rootAppNames = uniqSorted(
  [...apps.keys()].filter((name) => !referencedByOtherApps.has(name))
);

const children = rootAppNames.map((name) => buildNode(name, new Set()));

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
