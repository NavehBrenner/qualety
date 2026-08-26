import { expect, test } from "vitest";
import {
  entryValue,
  isPluginLiteral,
  objectInit,
  pluginLiterals,
  resolveBinding,
  ruleCreate,
  unwrapRule,
} from "./ast.ts";
import plugin, { plugin as namedPlugin } from "./index.ts";

test("plugin exports name, rules, and recommended", () => {
  expect(namedPlugin).toBe(plugin);
  expect(plugin.name).toBe("plugin-kit");
  expect(plugin.rules?.["no-spawn-in-create"]).toBeDefined();
  expect(plugin.rules?.["prefer-define-rule"]).toBeDefined();
  expect(plugin.configs?.recommended?.rules?.["plugin-kit/no-spawn-in-create"]).toBe("error");
  expect(plugin.configs?.recommended?.rules?.["plugin-kit/prefer-define-rule"]).toBe("error");
});

test("ast helpers are exported", () => {
  expect(entryValue).toEqual(expect.any(Function));
  expect(isPluginLiteral).toEqual(expect.any(Function));
  expect(objectInit).toEqual(expect.any(Function));
  expect(pluginLiterals).toEqual(expect.any(Function));
  expect(resolveBinding).toEqual(expect.any(Function));
  expect(ruleCreate).toEqual(expect.any(Function));
  expect(unwrapRule).toEqual(expect.any(Function));
});
