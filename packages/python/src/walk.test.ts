import { expect, test } from "vitest";
import {
  asNodes,
  childNodes,
  clearReexports,
  collectImports,
  containsPos,
  groupByPackage,
  hasDecorator,
  isDunder,
  isInitModule,
  isPassThrough,
  isPythonNode,
  isSkippedSource,
  isSmallAndFlat,
  isTestPath,
  nameRange,
  nodeRange,
  readDunderAll,
} from "./walk.ts";

test("walk helpers", () => {
  expect(isDunder("__init__")).toBe(true);
  expect(isInitModule("/pkg/__init__.py")).toBe(true);
  expect(isPythonNode({ _type: "Name" })).toBe(true);
  expect(asNodes([{ _type: "Pass" }])).toHaveLength(1);
  expect(childNodes({ _type: "Module", body: [{ _type: "Pass" }] })).toHaveLength(1);
  expect(isTestPath("/repo/tests/test_a.py", "/repo")).toBe(true);
  expect(isSkippedSource("/repo/fixtures/a.py", "/repo")).toBe(true);
  expect(groupByPackage).toBeTypeOf("function");
  expect(collectImports).toBeTypeOf("function");
  expect(isPassThrough({ _type: "FunctionDef", body: [] })).toBe(false);
  expect(isSmallAndFlat({ _type: "FunctionDef", body: [], lineno: 1, end_lineno: 1 }, "x")).toBe(
    true,
  );
  expect(
    nameRange({ _type: "FunctionDef", name: "foo", lineno: 1, col_offset: 0 }).start.column,
  ).toBe(5);
  expect(nodeRange({ _type: "Name", lineno: 1, col_offset: 0 }).start.column).toBe(1);
  expect(containsPos({ _type: "FunctionDef", lineno: 1, end_lineno: 3 }, 2)).toBe(true);
  expect(hasDecorator({ _type: "FunctionDef", decorator_list: [] }, new Set(["overload"]))).toBe(
    false,
  );
  expect(readDunderAll({ _type: "Module", body: [] }).kind).toBe("absent");
  expect(clearReexports({ _type: "Module", body: [] })).toEqual([]);
});
