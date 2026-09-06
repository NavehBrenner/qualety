import { isPythonNode, nodeRange, type PythonNode, walkCallables } from "@qualety/python/walk";
import { defineRule } from "qualety";
import {
  forEachMlSource,
  isBackwardCall,
  isBefore,
  type NodePos,
  nodePos,
  walkFunctionBody,
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
          const trains: NodePos[] = [];
          const backwards: NodePos[] = [];
          walkFunctionBody(fn, (node) => {
            if (isBackwardCall(node)) {
              backwards.push(nodePos(node));
            } else if (isAttrMethod(node, "train")) {
              trains.push(nodePos(node));
            }
          });
          if (backwards.length === 0) {
            return;
          }
          walkFunctionBody(fn, (node) => {
            if (!isAttrMethod(node, "eval")) {
              return;
            }
            const start = nodePos(node);
            if (
              !backwards.some(
                (backward) =>
                  isBefore(start, backward) &&
                  !trains.some((train) => isBefore(start, train) && isBefore(train, backward)),
              )
            ) {
              return;
            }
            context.report({
              severity: "error",
              file: unit.file,
              range: nodeRange(node),
              message:
                "model.eval() in a training function is not followed by model.train() before the next backward.",
              suggestion: TRAIN_HINT,
            });
          });
        });
      });
    }
  },
});

function isAttrMethod(
  node: PythonNode,
  attr: string,
): node is PythonNode & { readonly _type: "Call" } {
  if (node._type !== "Call" || !isPythonNode(node.func)) {
    return false;
  }
  return node.func._type === "Attribute" && node.func.attr === attr;
}
