import {
  asNodes,
  isTestPath,
  nodeRange,
  type PythonNode,
  type PythonSource,
  walkNodes,
} from "@qualety/python/walk";
import { defineRule } from "qualety";
import {
  attrChain,
  collectTrainingEntries,
  forEachMlSource,
  lastAttr,
  parseEntryPoints,
  treeHas,
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
    const extra = parseEntryPoints(context.options);
    const python = context.getArtifact("python");
    const tests: PythonSource[] = [];
    for (const unit of python.sources.values()) {
      if (isTestPath(unit.file, cwd)) {
        tests.push(unit);
      }
    }
    forEachMlSource(python.sources, cwd, { trainingOnly: true }, (unit) => {
      for (const entry of collectTrainingEntries(unit, extra)) {
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
