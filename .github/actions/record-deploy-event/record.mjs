import fs from "node:fs";
import path from "node:path";

const eventFile = process.argv[2];
if (!eventFile) {
  console.error("Missing event file path argument");
  process.exit(1);
}

const {
  TS,
  SOURCE_REPO,
  WORKFLOW,
  RUN_ID,
  RUN_ATTEMPT,
  RUN_URL,
  APP_NAME,
  ENVIRONMENT,
  DEPLOY_URL,
  STATUS,
  SHA,
  REF,
  INFRA_REF,
} = process.env;

if (!APP_NAME || !ENVIRONMENT || !DEPLOY_URL) {
  console.error(
    "Missing required env vars (APP_NAME, ENVIRONMENT, DEPLOY_URL)"
  );
  process.exit(1);
}

const payload = {
  timestamp: TS || "",
  source_repo: SOURCE_REPO || "",
  workflow: WORKFLOW || "",
  run_id: RUN_ID || "",
  run_attempt: RUN_ATTEMPT || "",
  run_url: RUN_URL || "",
  app_name: APP_NAME,
  environment: ENVIRONMENT,
  deploy_url: DEPLOY_URL,
  status: STATUS || "success",
  git_sha: SHA || "",
  ref: REF || "",
};

if (INFRA_REF) payload.infra_ref = INFRA_REF;

fs.mkdirSync(path.dirname(eventFile), { recursive: true });
fs.writeFileSync(eventFile, JSON.stringify(payload, null, 2) + "\n", "utf8");
