import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const providersDir = path.resolve("k8s/providers");

describe("provider config", () => {
  it("local provider config exists", () => {
    const configPath = path.join(providersDir, "local", "config.env");
    expect(fs.existsSync(configPath)).toBe(true);
  });

  it("local config has required fields", () => {
    const raw = fs.readFileSync(
      path.join(providersDir, "local", "config.env"),
      "utf8"
    );
    const fields = ["DOMAIN", "PROTOCOL", "REGISTRY", "RUNNER_LABEL", "TLS_ENABLED"];
    for (const field of fields) {
      expect(raw).toContain(`${field}=`);
    }
  });

  it("local config domain is localtest.me", () => {
    const raw = fs.readFileSync(
      path.join(providersDir, "local", "config.env"),
      "utf8"
    );
    const match = raw.match(/^DOMAIN=(.+)$/m);
    expect(match?.[1]).toBe("localtest.me");
  });

  it("local config protocol is http", () => {
    const raw = fs.readFileSync(
      path.join(providersDir, "local", "config.env"),
      "utf8"
    );
    const match = raw.match(/^PROTOCOL=(.+)$/m);
    expect(match?.[1]).toBe("http");
  });
});
