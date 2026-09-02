import {
  asNodes,
  nodeRange,
  type PythonNode,
  stringConstant,
  walkNodes,
} from "@qualety/python/walk";
import { defineRule } from "qualety";
import { assignTarget, attrChain, callKeyword, forEachMlSource, lastAttr } from "./ast.ts";

const CUDA_DEVICE = /^cuda(?::\d+)?$/;
const TF32_HINT = "Set both allow_tf32 flags explicitly next to device setup.";

export const tf32MustBeExplicit = defineRule({
  meta: {
    requires: ["python"],
    docs: {
      description: "A module that moves tensors to CUDA must set both allow_tf32 flags explicitly.",
    },
  },
  create(context) {
    for (const python of [context.getArtifact("python")]) {
      forEachMlSource(python.sources, context.getCwd(), { trainingOnly: false }, (unit) => {
        const flags = { matmul: false, cudnn: false };
        const moves: PythonNode[] = [];
        walkNodes(unit.tree, (node) => {
          noteTf32Assign(node, flags);
          if (isCudaMove(node)) {
            moves.push(node);
          }
        });
        const first = moves[0];
        if (first === undefined || (flags.matmul && flags.cudnn)) {
          return;
        }
        context.report({
          severity: "error",
          file: unit.file,
          range: nodeRange(first),
          message:
            "CUDA device move without explicit torch.backends.cuda.matmul.allow_tf32 and torch.backends.cudnn.allow_tf32.",
          suggestion: TF32_HINT,
        });
      });
    }
  },
});

function noteTf32Assign(node: PythonNode, flags: { matmul: boolean; cudnn: boolean }) {
  const target = assignTarget(node);
  if (target === undefined) {
    return;
  }
  const chain = attrChain(target);
  if (chain[chain.length - 1] !== "allow_tf32") {
    return;
  }
  if (chain.includes("matmul")) {
    flags.matmul = true;
  }
  if (chain.includes("cudnn")) {
    flags.cudnn = true;
  }
}

function isCudaMove(node: PythonNode): node is PythonNode & { readonly _type: "Call" } {
  if (node._type !== "Call") {
    return false;
  }
  if (lastAttr(node.func) === "cuda") {
    return true;
  }
  const device = stringConstant(callKeyword(node, "device"));
  if (device !== undefined && CUDA_DEVICE.test(device)) {
    return true;
  }
  if (lastAttr(node.func) !== "to") {
    return false;
  }
  const first = asNodes(node.args)[0];
  if (first === undefined) {
    return false;
  }
  const literal = stringConstant(first);
  if (literal !== undefined) {
    return CUDA_DEVICE.test(literal);
  }
  if (first._type !== "Call" || lastAttr(first.func) !== "device") {
    return false;
  }
  const type = stringConstant(asNodes(first.args)[0]) ?? stringConstant(callKeyword(first, "type"));
  return type !== undefined && CUDA_DEVICE.test(type);
}
