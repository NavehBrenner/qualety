import { expect, test } from "vitest";
import plugin from "./index.ts";

test("plugin exports name, rules, and recommended", () => {
  expect(plugin.name).toBe("plugin-kit");
  expect(plugin.rules?.["no-spawn-in-create"]).toBeDefined();
  expect(plugin.rules?.["prefer-define-rule"]).toBeDefined();
  expect(plugin.configs?.recommended?.rules?.["plugin-kit/no-spawn-in-create"]).toBe("error");
  expect(plugin.configs?.recommended?.rules?.["plugin-kit/prefer-define-rule"]).toBe("error");
});
