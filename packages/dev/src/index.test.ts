import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import {
  findSource,
  importNameMap,
  isProductPluginPath,
  isSourceFile,
  isTestPath,
  lineRange,
  PRODUCT_PLUGIN_DIRS,
  posix,
  rangeOf,
  relativeImportTargets,
  resolveRelativeSpecifier,
  specifierIsFs,
  walkReachable,
} from "./ast.ts";
import { concreteSuggestion } from "./concrete-suggestion.ts";
import { coreProviderBoundaries } from "./core-provider-boundaries.ts";
import { docsExportHonesty } from "./docs-export-honesty.ts";
import plugin, { plugin as namedPlugin } from "./index.ts";
import { noFsInRules } from "./no-fs-in-rules.ts";
import { buildWorkspaceDocs, WORKSPACE_DOC_PATHS } from "./workspace-docs.ts";

const here = fileURLToPath(new URL(".", import.meta.url));

test("plugin exports name, rules, workspace-docs, and no recommended", () => {
  expect(namedPlugin).toBe(plugin);
  expect(plugin.name).toBe("dev");
  expect(plugin.rules?.["core-provider-boundaries"]).toBeDefined();
  expect(plugin.rules?.["docs-export-honesty"]).toBeDefined();
  expect(plugin.rules?.["no-fs-in-rules"]).toBeDefined();
  expect(plugin.rules?.["concrete-suggestion"]).toBeDefined();
  expect(plugin.configs?.recommended).toBeUndefined();
  expect(typeof plugin.provides?.["workspace-docs"]?.build).toBe("function");
});

test("existing ts/react/dry/python fixture configs do not load @qualety/dev", () => {
  for (const dir of ["typescript", "react", "dry", "python"]) {
    const configs = collectConfigs(join(here, "../../", dir, "fixtures"));
    expect(configs.length).toBeGreaterThan(0);
    for (const body of configs) {
      expect(body).not.toMatch(/@qualety\/dev/);
    }
  }
});

test("dev helpers and rules are exported", () => {
  expect(PRODUCT_PLUGIN_DIRS).toContain("plugin-kit");
  expect(WORKSPACE_DOC_PATHS.length).toBeGreaterThan(0);
  expect(buildWorkspaceDocs).toEqual(expect.any(Function));
  expect(concreteSuggestion).toBeDefined();
  expect(coreProviderBoundaries).toBeDefined();
  expect(docsExportHonesty).toBeDefined();
  expect(noFsInRules).toBeDefined();
  expect(findSource).toEqual(expect.any(Function));
  expect(importNameMap).toEqual(expect.any(Function));
  expect(isProductPluginPath).toEqual(expect.any(Function));
  expect(isSourceFile).toEqual(expect.any(Function));
  expect(isTestPath).toEqual(expect.any(Function));
  expect(lineRange).toEqual(expect.any(Function));
  expect(posix).toEqual(expect.any(Function));
  expect(rangeOf).toEqual(expect.any(Function));
  expect(relativeImportTargets).toEqual(expect.any(Function));
  expect(resolveRelativeSpecifier).toEqual(expect.any(Function));
  expect(specifierIsFs).toEqual(expect.any(Function));
  expect(walkReachable).toEqual(expect.any(Function));
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
