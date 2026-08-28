import { expect, test } from "vitest";
import plugin, { plugin as namedPlugin } from "./index.ts";

const RECOMMENDED = [
  "python/no-unnecessary-def",
  "python/no-unnecessary-class",
  "python/public-exports-tested",
  "python/no-mutable-default",
  "python/require-typed-public",
  "python/no-bare-except",
  "python/no-silent-except",
  "python/no-open-without-with",
  "python/no-sys-path-hack",
  "python/no-public-any",
] as const;

test("plugin exports name, rules, recommended, and python provider", () => {
  expect(namedPlugin).toBe(plugin);
  expect(plugin.name).toBe("python");
  expect(plugin.rules?.["no-unnecessary-def"]).toBeDefined();
  expect(plugin.rules?.["no-unnecessary-class"]).toBeDefined();
  expect(plugin.rules?.["public-exports-tested"]).toBeDefined();
  expect(plugin.rules?.["no-mutable-default"]).toBeDefined();
  expect(plugin.rules?.["require-typed-public"]).toBeDefined();
  expect(plugin.rules?.["no-bare-except"]).toBeDefined();
  expect(plugin.rules?.["no-silent-except"]).toBeDefined();
  expect(plugin.rules?.["no-open-without-with"]).toBeDefined();
  expect(plugin.rules?.["no-sys-path-hack"]).toBeDefined();
  expect(plugin.rules?.["no-public-any"]).toBeDefined();
  for (const id of RECOMMENDED) {
    expect(plugin.configs?.recommended?.rules?.[id]).toBe("error");
  }
  expect(typeof plugin.provides?.python?.build).toBe("function");
});
