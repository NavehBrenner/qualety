import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import { check } from "../../qualety/src/engine.ts";
import plugin, { plugin as namedPlugin } from "./index.ts";

const here = fileURLToPath(new URL(".", import.meta.url));
const fixtures = join(here, "../fixtures");

const RULES = [
  "require-global-seed",
  "seed-must-reach-framework-rng",
  "dataloader-worker-seeding",
  "tf32-must-be-explicit",
  "determinism-test-required",
  "deterministic-algorithms-opt-in",
  "metadata-writer-required",
  "record-code-version",
  "run-metadata-completeness",
] as const;

test("plugin exports name, nine rules, recommended including opt-in off, no provides", () => {
  expect(namedPlugin).toBe(plugin);
  expect(plugin.name).toBe("ml");
  expect(plugin.provides).toBeUndefined();
  for (const key of RULES) {
    expect(plugin.rules?.[key]).toBeDefined();
  }
  expect(plugin.configs?.recommended?.rules?.["ml/require-global-seed"]).toBe("error");
  expect(plugin.configs?.recommended?.rules?.["ml/seed-must-reach-framework-rng"]).toBe("error");
  expect(plugin.configs?.recommended?.rules?.["ml/dataloader-worker-seeding"]).toBe("error");
  expect(plugin.configs?.recommended?.rules?.["ml/tf32-must-be-explicit"]).toBe("error");
  expect(plugin.configs?.recommended?.rules?.["ml/determinism-test-required"]).toBe("error");
  expect(plugin.configs?.recommended?.rules?.["ml/deterministic-algorithms-opt-in"]).toBe("off");
  expect(plugin.configs?.recommended?.rules?.["ml/metadata-writer-required"]).toBe("error");
  expect(plugin.configs?.recommended?.rules?.["ml/record-code-version"]).toBe("error");
  expect(plugin.configs?.recommended?.rules?.["ml/run-metadata-completeness"]).toBe("error");
});

test("ml without a python provider exits 2", async () => {
  const lines: string[] = [];
  const errors: string[] = [];
  const code = await check(
    join(fixtures, "missing-python-provider"),
    (m) => lines.push(String(m)),
    (m) => errors.push(String(m)),
    { plugins: [], excludePlugins: [], rules: ["ml/require-global-seed"], diff: "off" },
  );
  expect(code).toBe(2);
  expect(errors.join("\n")).toMatch(/No provider for artifact "python"/);
  expect(lines.join("\n")).not.toMatch(/ml\/require-global-seed/);
});
