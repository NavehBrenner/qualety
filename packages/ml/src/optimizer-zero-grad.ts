import { childNodes, nodeRange, type PythonNode, walkCallables } from "@qualety/python/walk";
import { defineRule } from "qualety";
import { attrChain, forEachMlSource, isBackwardCall, lastAttr, walkSkipDefs } from "./ast.ts";

const ZERO_HINT =
  "Call optimizer.zero_grad() before each accumulation window (or once per step if not accumulating).";
const OPT_RECV = new Set(["optimizer", "opt", "optim"]);

export const optimizerZeroGrad = defineRule({
  meta: {
    requires: ["python"],
    docs: {
      description:
        "A training step that calls backward and optimizer.step must also call zero_grad.",
    },
  },
  create(context) {
    for (const python of [context.getArtifact("python")]) {
      forEachMlSource(python.sources, context.getCwd(), { trainingOnly: false }, (unit) => {
        walkCallables(unit.tree, "", false, (fn) => {
          const scan = scanTrainingStep(fn);
          if (!scan.backward || scan.step === undefined || scan.zero) {
            return;
          }
          context.report({
            severity: "error",
            file: unit.file,
            range: nodeRange(scan.step),
            message: "Training step calls backward and optimizer.step without zero_grad.",
            suggestion: ZERO_HINT,
          });
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

function scanTrainingStep(fn: PythonNode): {
  backward: boolean;
  zero: boolean;
  step: PythonNode | undefined;
} {
  const scan: { backward: boolean; zero: boolean; step: PythonNode | undefined } = {
    backward: false,
    zero: false,
    step: undefined,
  };
  walkFn(fn, (node) => {
    noteTrainingCall(node, scan);
  });
  return scan;
}

function noteTrainingCall(
  node: PythonNode,
  scan: { backward: boolean; zero: boolean; step: PythonNode | undefined },
): void {
  if (isBackwardCall(node)) {
    scan.backward = true;
  }
  if (isZeroGrad(node)) {
    scan.zero = true;
  }
  if (scan.step === undefined && isOptimizerStep(node)) {
    scan.step = node;
  }
}

function isZeroGrad(node: PythonNode): boolean {
  return node._type === "Call" && lastAttr(node.func) === "zero_grad";
}

function isOptimizerStep(node: PythonNode): boolean {
  if (node._type !== "Call" || lastAttr(node.func) !== "step") {
    return false;
  }
  const recv = attrChain(node.func).slice(0, -1);
  const last = recv[recv.length - 1]?.toLowerCase();
  if (last !== undefined && OPT_RECV.has(last)) {
    return true;
  }
  return recv.some((part) => part === "optimizer" || part === "Optimizer");
}
