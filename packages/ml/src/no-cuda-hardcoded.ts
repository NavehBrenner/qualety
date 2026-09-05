import {
  asNodes,
  isPythonNode,
  nodeRange,
  type PythonNode,
  stringConstant,
  walkNodes,
} from "@qualety/python/walk";
import { defineRule } from "qualety";
import { callKeyword, forEachMlSource, lastAttr } from "./ast.ts";

const CUDA_DEVICE = /^cuda(?::\d+)?$/;
const CUDA_HINT =
  'Take device from config/arg; use torch.device("cuda" if torch.cuda.is_available() else "cpu") or equivalent resolved device.';

export const noCudaHardcoded = defineRule({
  meta: {
    requires: ["python"],
    docs: {
      description: "Do not hardcode CUDA devices; that breaks CPU-only environments.",
    },
  },
  create(context) {
    for (const python of [context.getArtifact("python")]) {
      forEachMlSource(python.sources, context.getCwd(), { trainingOnly: false }, (unit) => {
        walkNodes(unit.tree, (node) => {
          if (!isHardcodedCuda(node)) {
            return;
          }
          context.report({
            severity: "error",
            file: unit.file,
            range: nodeRange(node),
            message: "CUDA device is hardcoded; this breaks CPU-only environments.",
            suggestion: CUDA_HINT,
          });
        });
      });
    }
  },
});

function isHardcodedCuda(node: PythonNode): boolean {
  if (node._type !== "Call") {
    return false;
  }
  if (isCudaMethod(node)) {
    return true;
  }
  if (cudaLiteral(callKeyword(node, "device"))) {
    return true;
  }
  const last = lastAttr(node.func);
  if (last !== "to" && last !== "device") {
    return false;
  }
  return cudaLiteral(asNodes(node.args)[0]);
}

function isCudaMethod(node: PythonNode): boolean {
  if (!isPythonNode(node.func)) {
    return false;
  }
  return node.func._type === "Attribute" && node.func.attr === "cuda";
}

function cudaLiteral(node: PythonNode | undefined): boolean {
  const text = stringConstant(node);
  return text !== undefined && CUDA_DEVICE.test(text);
}
