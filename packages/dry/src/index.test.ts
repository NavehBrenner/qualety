import { expect, test } from "vitest";
import plugin, { plugin as namedPlugin } from "./index.ts";
import { noDuplicateCode } from "./no-duplicate-code.ts";
import { noDuplicatePython } from "./no-duplicate-python.ts";

test("plugin exports name, rule, recommended, and dupehound provider", () => {
  expect(namedPlugin).toBe(plugin);
  expect(noDuplicateCode).toBeDefined();
  expect(noDuplicatePython).toBeDefined();
  expect(plugin.name).toBe("dry");
  expect(plugin.rules?.["no-duplicate-code"]).toBeDefined();
  expect(plugin.rules?.["no-duplicate-python"]).toBeDefined();
  expect(plugin.rules?.["no-duplicate-functions"]).toBeUndefined();
  expect(plugin.configs?.recommended?.rules?.["dry/no-duplicate-code"]).toBe("error");
  expect(plugin.configs?.recommended?.rules?.["dry/no-duplicate-python"]).toBe("error");
  expect(plugin.configs?.recommended?.rules?.["dry/no-duplicate-functions"]).toBeUndefined();
  expect(typeof plugin.provides?.dupehound?.build).toBe("function");
});
