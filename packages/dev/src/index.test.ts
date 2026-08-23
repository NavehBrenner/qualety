import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import plugin from "./index.ts";

const here = fileURLToPath(new URL(".", import.meta.url));

test("plugin exports name, rules, workspace-docs, and no recommended", () => {
  expect(plugin.name).toBe("dev");
  expect(plugin.rules?.["core-provider-boundaries"]).toBeDefined();
  expect(plugin.rules?.["docs-export-honesty"]).toBeDefined();
  expect(plugin.rules?.["no-fs-in-rules"]).toBeDefined();
  expect(plugin.rules?.["concrete-suggestion"]).toBeDefined();
  expect(plugin.configs?.recommended).toBeUndefined();
  expect(typeof plugin.provides?.["workspace-docs"]?.build).toBe("function");
});

test("existing ts/react/dry fixture configs do not load @qualety/dev", () => {
  for (const dir of ["typescript", "react", "dry"]) {
    const configs = collectConfigs(join(here, "../../", dir, "fixtures"));
    expect(configs.length).toBeGreaterThan(0);
    for (const body of configs) {
      expect(body).not.toMatch(/@qualety\/dev/);
    }
  }
});

function collectConfigs(root: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(root)) {
    const path = join(root, name);
    if (statSync(path).isDirectory()) {
      out.push(...collectConfigs(path));
      continue;
    }
    if (name === "qualety.config.json") {
      out.push(readFileSync(path, "utf8"));
    }
  }
  return out;
}
