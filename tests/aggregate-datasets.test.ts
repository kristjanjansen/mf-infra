import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

describe("aggregate datasets", () => {
  const datasetsDir = path.resolve("datasets");

  it("events.json exists and is valid JSON", () => {
    const p = path.join(datasetsDir, "events.json");
    expect(fs.existsSync(p)).toBe(true);
    const data = JSON.parse(fs.readFileSync(p, "utf8"));
    expect(data).toHaveProperty("generated_at");
    expect(data).toHaveProperty("events");
    expect(Array.isArray(data.events)).toBe(true);
  });

  it("deps.json exists and is valid JSON", () => {
    const p = path.join(datasetsDir, "deps.json");
    expect(fs.existsSync(p)).toBe(true);
    const data = JSON.parse(fs.readFileSync(p, "utf8"));
    expect(data).toHaveProperty("generated_at");
    expect(data).toHaveProperty("root");
  });

  it("events have required fields", () => {
    const data = JSON.parse(
      fs.readFileSync(path.join(datasetsDir, "events.json"), "utf8")
    );
    for (const event of data.events) {
      expect(event).toHaveProperty("timestamp");
      expect(event).toHaveProperty("app_name");
      expect(event).toHaveProperty("deploy_url");
      expect(event).toHaveProperty("status");
    }
  });

  it("event files in events/ are valid JSON", () => {
    const eventsDir = path.resolve("events");
    if (!fs.existsSync(eventsDir)) return;

    function walk(dir: string): string[] {
      const out: string[] = [];
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, entry.name);
        if (entry.isDirectory()) out.push(...walk(p));
        else if (entry.name.endsWith(".json")) out.push(p);
      }
      return out;
    }

    const files = walk(eventsDir);
    for (const file of files) {
      const raw = fs.readFileSync(file, "utf8");
      expect(() => JSON.parse(raw), `Invalid JSON: ${file}`).not.toThrow();
    }
  });
});
