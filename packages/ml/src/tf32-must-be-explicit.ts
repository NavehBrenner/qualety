import { defineRule, type RuleContext } from "qualety";
import {
  asNodes,
  attrChain,
  callKeyword,
  isPythonNode,
  isSkippedSource,
  lastAttr,
  nodeRange,
  type PythonNode,
  type PythonSource,
  pythonSources,
  stringConstant,
  walkNodes,
} from "./ast.ts";

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
    const cwd = context.getCwd();
    for (const unit of pythonSources(context.getArtifact("python"))) {
      if (isSkippedSource(unit.file, cwd)) {
        continue;
      }
      checkUnit(unit, context);
    }
  },
});

function checkUnit(unit: PythonSource, context: Pick<RuleContext, "report">) {
  const flags = { matmul: false, cudnn: false };
  const moves: PythonNode[] = [];
  walkNodes(unit.tree, (node) => {
    noteTf32Assign(node, flags);
    if (isCudaMove(node)) {
      moves.push(node);
    }
  });
  if (moves.length === 0 || (flags.matmul && flags.cudnn)) {
    return;
  }
  const first = moves[0];
  if (first === undefined) {
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
}

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

function assignTarget(node: PythonNode): PythonNode | undefined {
  if (node._type === "AnnAssign" && isPythonNode(node.target)) {
    return node.target;
  }
  if (node._type !== "Assign") {
    return undefined;
  }
  const target = asNodes(node.targets)[0];
  return target;
}

function isCudaMove(node: PythonNode): boolean {
  if (node._type !== "Call") {
    return false;
  }
  if (lastAttr(node.func) === "cuda") {
    return true;
  }
  if (lastAttr(node.func) === "to" && isCudaDeviceArg(node)) {
    return true;
  }
  const device = stringConstant(callKeyword(node, "device"));
  return device !== undefined && CUDA_DEVICE.test(device);
}

function isCudaDeviceArg(node: PythonNode): boolean {
  const deviceKw = stringConstant(callKeyword(node, "device"));
  if (deviceKw !== undefined && CUDA_DEVICE.test(deviceKw)) {
    return true;
  }
  const first = asNodes(node.args)[0];
  if (first === undefined) {
    return false;
  }
  const literal = stringConstant(first);
  if (literal !== undefined) {
    return CUDA_DEVICE.test(literal);
  }
  return isDeviceCudaCall(first);
}

function isDeviceCudaCall(node: PythonNode): boolean {
  if (node._type !== "Call" || lastAttr(node.func) !== "device") {
    return false;
  }
  const first = stringConstant(asNodes(node.args)[0]) ?? stringConstant(callKeyword(node, "type"));
  return first !== undefined && CUDA_DEVICE.test(first);
}
