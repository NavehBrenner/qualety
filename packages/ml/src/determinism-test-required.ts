import {
  asNodes,
  isPythonNode,
  isTestPath,
  nodeRange,
  type PythonNode,
  type PythonSource,
  stringConstant,
  walkNodes,
} from "@qualety/python/walk";
import { defineRule } from "qualety";
import { attrChain, forEachMlSource, lastAttr, treeHas } from "./ast.ts";

const TRAIN_LIKE = new Set(["train", "main"]);
const EQUAL_CALLS = new Set(["assertEqual", "assert_equal", "equal", "allclose"]);
const TEST_HINT =
  "Add a test that runs the entry point twice under a fixed seed and asserts identical weights.";

export const determinismTestRequired = defineRule({
  meta: {
    requires: ["python"],
    docs: {
      description:
        "A training entry point must have a test that trains twice and asserts identical weights.",
    },
    schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        entryPoints: { type: "array", items: { type: "string" } },
      },
    },
  },
  create(context) {
    const cwd = context.getCwd();
    const extra = optionNames(context.options);
    const python = context.getArtifact("python");
    const tests: PythonSource[] = [];
    for (const unit of python.sources.values()) {
      if (isTestPath(unit.file, cwd)) {
        tests.push(unit);
      }
    }
    forEachMlSource(python.sources, cwd, { trainingOnly: true }, (unit) => {
      for (const entry of collectEntries(unit, extra)) {
        if (
          tests.some((test) => {
            if (
              !treeHas(
                test.tree,
                (node) =>
                  (node._type === "Name" && node.id === entry.name) ||
                  (node._type === "Attribute" && node.attr === entry.name) ||
                  (node._type === "alias" &&
                    (node.name === entry.name || node.asname === entry.name)),
              )
            ) {
              return false;
            }
            if (countCalls(test.tree, new Set<string>([entry.name, ...TRAIN_LIKE])) < 2) {
              return false;
            }
            return treeHas(test.tree, (node) => {
              if (node._type === "Call") {
                const name = lastAttr(node.func);
                return name !== undefined && EQUAL_CALLS.has(name);
              }
              if (node._type !== "Compare" || !asNodes(node.ops).some((op) => op._type === "Eq")) {
                return false;
              }
              return treeHas(
                node,
                (child) =>
                  (child._type === "Attribute" && child.attr === "state_dict") ||
                  attrChain(child).includes("state_dict"),
              );
            });
          })
        ) {
          continue;
        }
        context.report({
          severity: "error",
          file: unit.file,
          range: nodeRange(entry.node),
          message: `Training entry point "${entry.name}" has no test that runs twice and asserts identical weights.`,
          suggestion: TEST_HINT,
        });
      }
    });
  },
});

function optionNames(options: unknown): string[] {
  if (typeof options !== "object" || options === null || !("entryPoints" in options)) {
    return [];
  }
  const raw = options.entryPoints;
  if (!Array.isArray(raw)) {
    return [];
  }
  const names: string[] = [];
  for (const item of raw) {
    if (typeof item === "string" && item.length > 0) {
      const trimmed = item.replaceAll("\\", "/").replace(/\.py$/, "");
      const parts = trimmed.split(/[./]/);
      names.push(parts[parts.length - 1] ?? trimmed);
    }
  }
  return names;
}

function collectEntries(
  unit: PythonSource,
  extra: readonly string[],
): { name: string; node: PythonNode }[] {
  const wanted = new Set<string>([...TRAIN_LIKE, ...extra]);
  const defs: { name: string; node: PythonNode }[] = [];
  for (const stmt of asNodes(unit.tree.body)) {
    if (stmt._type !== "FunctionDef" && stmt._type !== "AsyncFunctionDef") {
      continue;
    }
    if (typeof stmt.name === "string" && wanted.has(stmt.name)) {
      defs.push({ name: stmt.name, node: stmt });
    }
  }
  const first = defs[0];
  if (first !== undefined) {
    return defs;
  }
  const guard = mainGuard(unit.tree, wanted);
  return guard === undefined ? [] : [guard];
}

function mainGuard(
  tree: PythonNode,
  wanted: ReadonlySet<string>,
): { name: string; node: PythonNode } | undefined {
  for (const stmt of asNodes(tree.body)) {
    if (stmt._type !== "If" || !isPythonNode(stmt.test) || stmt.test._type !== "Compare") {
      continue;
    }
    const left = stmt.test.left;
    if (!isPythonNode(left) || left._type !== "Name" || left.id !== "__name__") {
      continue;
    }
    if (!asNodes(stmt.test.comparators).some((item) => stringConstant(item) === "__main__")) {
      continue;
    }
    let found: string | undefined;
    walkNodes(stmt, (node) => {
      if (node._type !== "Call") {
        return;
      }
      const name = lastAttr(node.func);
      if (name !== undefined && wanted.has(name)) {
        found ??= name;
      }
    });
    if (found !== undefined) {
      return { name: found, node: stmt };
    }
  }
  return undefined;
}

function countCalls(tree: PythonNode, names: ReadonlySet<string>): number {
  let count = 0;
  walkNodes(tree, (node) => {
    if (node._type === "Call") {
      const name = lastAttr(node.func);
      if (name !== undefined && names.has(name)) {
        count += 1;
      }
    }
  });
  return count;
}
