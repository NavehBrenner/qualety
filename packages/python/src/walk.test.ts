import { expect, test } from "vitest";
import {
  asNodes,
  childNodes,
  clearReexports,
  collectImports,
  collectLoadKeys,
  collectModuleAliases,
  collectPathLoads,
  containsPos,
  forEachPythonSource,
  groupByPackage,
  hasDecorator,
  isDunder,
  isInitModule,
  isPassThrough,
  isPublicCallable,
  isPythonNode,
  isSkippedSource,
  isSmallAndFlat,
  isTestPath,
  nameRange,
  nodeRange,
  publicInitNames,
  readDunderAll,
  scanPathLoadUses,
  tallyResolvedUse,
  walkCallables,
  walkNodes,
} from "./walk.ts";

test("walk helpers", () => {
  expect(isDunder("__init__")).toBe(true);
  expect(isInitModule("/pkg/__init__.py")).toBe(true);
  expect(isPythonNode({ _type: "Name" })).toBe(true);
  expect(collectLoadKeys).toBeTypeOf("function");
  expect(asNodes([{ _type: "Pass" }])).toHaveLength(1);
  expect(childNodes({ _type: "Module", body: [{ _type: "Pass" }] })).toHaveLength(1);
  expect(isTestPath("/repo/tests/test_a.py", "/repo")).toBe(true);
  expect(isSkippedSource("/repo/fixtures/a.py", "/repo")).toBe(true);
  expect(groupByPackage).toBeTypeOf("function");
  expect(collectImports).toBeTypeOf("function");
  expect(collectPathLoads).toBeTypeOf("function");
  expect(scanPathLoadUses).toBeTypeOf("function");
  expect(isPassThrough({ _type: "FunctionDef", body: [] })).toBe(false);
  expect(isSmallAndFlat({ _type: "FunctionDef", body: [], lineno: 1, end_lineno: 1 }, "x")).toBe(
    true,
  );
  expect(
    nameRange({ _type: "FunctionDef", name: "foo", lineno: 1, col_offset: 0 }).start.column,
  ).toBe(5);
  expect(nodeRange({ _type: "Name", lineno: 1, col_offset: 0 }).start.column).toBe(1);
  expect(containsPos({ _type: "FunctionDef", lineno: 1, end_lineno: 3 }, 2)).toBe(true);
  const node = { _type: "ClassDef", lineno: 1, end_lineno: 5 };
  const counts = new Map<string, number>();
  tallyResolvedUse("k", { file: "/a.py", node }, "/a.py", 3, counts);
  expect(counts.size).toBe(0);
  tallyResolvedUse("k", { file: "/a.py", node }, "/b.py", 3, counts);
  expect(counts.get("k")).toBe(1);
  expect(hasDecorator({ _type: "FunctionDef", decorator_list: [] }, new Set(["overload"]))).toBe(
    false,
  );
  expect(readDunderAll({ _type: "Module", body: [] }).kind).toBe("absent");
  expect(clearReexports({ _type: "Module", body: [] })).toEqual([]);
  expect(forEachPythonSource).toBeTypeOf("function");
  expect(walkNodes).toBeTypeOf("function");
  expect(publicInitNames).toBeTypeOf("function");
  expect(walkCallables).toBeTypeOf("function");
  expect(collectModuleAliases).toBeTypeOf("function");
  expect(isPublicCallable({ _type: "FunctionDef", name: "foo" }, "", false, undefined)).toBe(true);
});
