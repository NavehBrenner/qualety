import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import { check } from "../../qualety/src/engine.ts";
import plugin, { plugin as namedPlugin } from "./index.ts";

const here = fileURLToPath(new URL(".", import.meta.url));
const fixtures = join(here, "../fixtures");

test("plugin exports name, three rules, recommended including code-version off, no provides", () => {
  expect(namedPlugin).toBe(plugin);
  expect(plugin.name).toBe("fingerprint");
  expect(plugin.provides).toBeUndefined();
  expect(plugin.rules?.["hash-covers-every-config-field"]).toBeDefined();
  expect(plugin.rules?.["versioned-hash-payload"]).toBeDefined();
  expect(plugin.rules?.["hash-includes-code-version"]).toBeDefined();
  expect(plugin.configs?.recommended?.rules?.["fingerprint/hash-covers-every-config-field"]).toBe(
    "error",
  );
  expect(plugin.configs?.recommended?.rules?.["fingerprint/versioned-hash-payload"]).toBe("error");
  expect(plugin.configs?.recommended?.rules?.["fingerprint/hash-includes-code-version"]).toBe(
    "off",
  );
});

test("fingerprint without a python provider exits 2", async () => {
  const lines: string[] = [];
  const errors: string[] = [];
  const code = await check(
    join(fixtures, "missing-python-provider"),
    (m) => lines.push(String(m)),
    (m) => errors.push(String(m)),
    {
      plugins: [],
      excludePlugins: [],
      rules: ["fingerprint/hash-covers-every-config-field"],
      diff: "off",
    },
  );
  expect(code).toBe(2);
  expect(errors.join("\n")).toMatch(/No provider for artifact "python"/);
  expect(lines.join("\n")).not.toMatch(/fingerprint\/hash-covers-every-config-field/);
});
