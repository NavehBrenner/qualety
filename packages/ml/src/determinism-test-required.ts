import { defineRule } from "qualety";
import {
  asNodes,
  attrChain,
  isPythonNode,
  isSkippedSource,
  isTestPath,
  isTrainingModule,
  lastAttr,
  nodeRange,
  type PythonNode,
  type PythonSource,
  pythonSources,
  stringConstant,
  walkNodes,
} from "./ast.ts";

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
    const units = pythonSources(context.getArtifact("python"));
    const tests = units.filter((unit) => isTestPath(unit.file, cwd));
    for (const unit of units) {
      if (isSkippedSource(unit.file, cwd) || !isTrainingModule(unit.tree)) {
        continue;
      }
      for (const entry of collectEntries(unit, extra)) {
        if (tests.some((test) => testCovers(test, entry.name))) {
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
    }
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
      names.push(lastSegment(item));
    }
  }
  return names;
}

function lastSegment(value: string): string {
  const trimmed = value.replaceAll("\\", "/").replace(/\.py$/, "");
  const parts = trimmed.split(/[./]/);
  return parts[parts.length - 1] ?? trimmed;
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
  if (defs.length > 0) {
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
    if (!isMainCompare(stmt)) {
      continue;
    }
    const called = calledWantedName(stmt, wanted);
    if (called !== undefined) {
      return { name: called, node: stmt };
    }
  }
  return undefined;
}

function isMainCompare(stmt: PythonNode): boolean {
  if (stmt._type !== "If" || !isPythonNode(stmt.test) || stmt.test._type !== "Compare") {
    return false;
  }
  const left = stmt.test.left;
  if (!isPythonNode(left) || left._type !== "Name" || left.id !== "__name__") {
    return false;
  }
  return asNodes(stmt.test.comparators).some((item) => stringConstant(item) === "__main__");
}

function calledWantedName(stmt: PythonNode, wanted: ReadonlySet<string>): string | undefined {
  let found: string | undefined;
  walkNodes(stmt, (node) => {
    if (node._type !== "Call") {
      return;
    }
    const name = lastAttr(node.func);
    if (name !== undefined && wanted.has(name) && found === undefined) {
      found = name;
    }
  });
  return found;
}

function testCovers(test: PythonSource, entryName: string): boolean {
  if (!referencesName(test.tree, entryName)) {
    return false;
  }
  const names = new Set<string>([entryName, ...TRAIN_LIKE]);
  return countCalls(test.tree, names) >= 2 && hasWeightAssert(test.tree);
}

function referencesName(tree: PythonNode, name: string): boolean {
  let found = false;
  walkNodes(tree, (node) => {
    if (node._type === "Name" && node.id === name) {
      found = true;
    }
    if (node._type === "Attribute" && node.attr === name) {
      found = true;
    }
    if (node._type === "alias" && (node.name === name || node.asname === name)) {
      found = true;
    }
  });
  return found;
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

function hasWeightAssert(tree: PythonNode): boolean {
  let found = false;
  walkNodes(tree, (node) => {
    if (isEqualCall(node) || isStateDictEq(node)) {
      found = true;
    }
  });
  return found;
}

function isEqualCall(node: PythonNode): boolean {
  if (node._type !== "Call") {
    return false;
  }
  const name = lastAttr(node.func);
  return name !== undefined && EQUAL_CALLS.has(name);
}

function isStateDictEq(node: PythonNode): boolean {
  if (node._type !== "Compare" || !hasEqOp(node)) {
    return false;
  }
  return compareMentionsStateDict(node);
}

function hasEqOp(node: PythonNode): boolean {
  return asNodes(node.ops).some((op) => op._type === "Eq");
}

function compareMentionsStateDict(node: PythonNode): boolean {
  let found = false;
  walkNodes(node, (child) => {
    if (child._type === "Attribute" && child.attr === "state_dict") {
      found = true;
    }
    if (attrChain(child).includes("state_dict")) {
      found = true;
    }
  });
  return found;
}
