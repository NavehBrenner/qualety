import { expect, test } from "vitest";
import plugin, { plugin as namedPlugin } from "./index.ts";
import { noUnnecessaryDef } from "./no-unnecessary-def.ts";

test("plugin exports name, rule, recommended, and python provider", () => {
  expect(namedPlugin).toBe(plugin);
  expect(noUnnecessaryDef).toBeDefined();
  expect(plugin.name).toBe("python");
  expect(plugin.rules?.["no-unnecessary-def"]).toBeDefined();
  expect(plugin.configs?.recommended?.rules?.["python/no-unnecessary-def"]).toBe("error");
  expect(typeof plugin.provides?.python?.build).toBe("function");
});
