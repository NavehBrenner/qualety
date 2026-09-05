import {
  childNodes,
  isPythonNode,
  nodeRange,
  type PythonNode,
  walkCallables,
} from "@qualety/python/walk";
import { defineRule } from "qualety";
import {
  forEachMlSource,
  isBackwardCall,
  isBefore,
  type NodePos,
  nodePos,
  walkSkipDefs,
} from "./ast.ts";

const TRAIN_HINT =
  "Call model.train() after the validation/eval pass before the next training step.";

export const trainModeRestored = defineRule({
  meta: {
    requires: ["python"],
    docs: {
      description:
        "Restore model.train() after a mid-epoch eval pass before the next training step.",
    },
  },
  create(context) {
    for (const python of [context.getArtifact("python")]) {
      forEachMlSource(python.sources, context.getCwd(), { trainingOnly: false }, (unit) => {
        walkCallables(unit.tree, "", false, (fn) => {
          const evals: PythonNode[] = [];
          const trains: NodePos[] = [];
          const backwards: NodePos[] = [];
          walkFn(fn, (node) => {
            if (isBackwardCall(node)) {
              backwards.push(nodePos(node));
            } else if (isAttrMethod(node, "eval")) {
              evals.push(node);
            } else if (isAttrMethod(node, "train")) {
              trains.push(nodePos(node));
            }
          });
          if (backwards.length === 0) {
            return;
          }
          for (const evalCall of evals) {
            const start = nodePos(evalCall);
            if (!needsTrainRestore(start, trains, backwards)) {
              continue;
            }
            context.report({
              severity: "error",
              file: unit.file,
              range: nodeRange(evalCall),
              message:
                "model.eval() in a training function is not followed by model.train() before the next backward.",
              suggestion: TRAIN_HINT,
            });
          }
        });
      });
    }
  },
});

function walkFn(fn: PythonNode, visit: (node: PythonNode) => void): void {
  for (const child of childNodes(fn)) {
    walkSkipDefs(child, visit);
  }
}

function isAttrMethod(node: PythonNode, attr: string): boolean {
  if (node._type !== "Call" || !isPythonNode(node.func)) {
    return false;
  }
  return node.func._type === "Attribute" && node.func.attr === attr;
}

function needsTrainRestore(
  evalPos: NodePos,
  trains: readonly NodePos[],
  backwards: readonly NodePos[],
): boolean {
  return backwards.some(
    (backward) =>
      isBefore(evalPos, backward) &&
      !trains.some((train) => isBefore(evalPos, train) && isBefore(train, backward)),
  );
}
