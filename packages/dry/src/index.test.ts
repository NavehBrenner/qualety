import { expect, test } from "vitest";
import plugin, { plugin as namedPlugin } from "./index.ts";
import { noDuplicateFunctions } from "./no-duplicate-functions.ts";

test("plugin exports name, rule, recommended, and dupehound provider", () => {
  expect(namedPlugin).toBe(plugin);
  expect(noDuplicateFunctions).toBeDefined();
  expect(plugin.name).toBe("dry");
  expect(plugin.rules?.["no-duplicate-functions"]).toBeDefined();
  expect(plugin.configs?.recommended?.rules?.["dry/no-duplicate-functions"]).toBe("error");
  expect(typeof plugin.provides?.dupehound?.build).toBe("function");
});
