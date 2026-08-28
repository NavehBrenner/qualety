import { expect, test } from "vitest";
import plugin, { plugin as namedPlugin } from "./index.ts";

const RECOMMENDED = [
  "python/no-unnecessary-def",
  "python/no-unnecessary-class",
  "python/public-exports-tested",
  "python/no-mutable-default",
  "python/require-typed-public",
] as const;

test("plugin exports name, rules, recommended, and python provider", () => {
  expect(namedPlugin).toBe(plugin);
  expect(plugin.name).toBe("python");
  expect(plugin.rules?.["no-unnecessary-def"]).toBeDefined();
  expect(plugin.rules?.["no-unnecessary-class"]).toBeDefined();
  expect(plugin.rules?.["public-exports-tested"]).toBeDefined();
  expect(plugin.rules?.["no-mutable-default"]).toBeDefined();
  expect(plugin.rules?.["require-typed-public"]).toBeDefined();
  for (const id of RECOMMENDED) {
    expect(plugin.configs?.recommended?.rules?.[id]).toBe("error");
  }
  expect(typeof plugin.provides?.python?.build).toBe("function");
});
