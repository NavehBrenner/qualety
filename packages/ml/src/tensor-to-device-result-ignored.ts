import { asNodes, isPythonNode, nodeRange, type PythonNode, walkNodes } from "@qualety/python/walk";
import { defineRule } from "qualety";
import { attrChain, callKeyword, forEachMlSource, lastAttr } from "./ast.ts";

const CAST = new Set(["to", "cuda", "cpu", "float", "half", "double", "bfloat16"]);
const MODULE_RECV = new Set(["model", "self", "net", "module"]);
const CAST_HINT = "Assign the result (x = x.to(device)), or use in-place only on modules.";

export const tensorToDeviceResultIgnored = defineRule({
  meta: {
    requires: ["python"],
    docs: {
      description:
        "Do not ignore the result of tensor.to/cuda/cpu/float — those calls do not mutate in place.",
    },
  },
  create(context) {
    for (const python of [context.getArtifact("python")]) {
      forEachMlSource(python.sources, context.getCwd(), { trainingOnly: false }, (unit) => {
        walkNodes(unit.tree, (node) => {
          if (node._type !== "Expr" || !isPythonNode(node.value) || node.value._type !== "Call") {
            return;
          }
          const call = node.value;
          if (!isDeviceCast(call) || isModuleInPlace(call)) {
            return;
          }
          context.report({
            severity: "error",
            file: unit.file,
            range: nodeRange(call),
            message:
              "tensor.to/cuda/cpu/float result is ignored; the call does not mutate in place.",
            suggestion: CAST_HINT,
          });
        });
      });
    }
  },
});

function isDeviceCast(node: PythonNode): boolean {
  const name = lastAttr(node.func);
  if (name === undefined || !CAST.has(name)) {
    return false;
  }
  if (name !== "to") {
    return true;
  }
  if (asNodes(node.args).length > 0) {
    return true;
  }
  return callKeyword(node, "device") !== undefined || callKeyword(node, "dtype") !== undefined;
}

function isModuleInPlace(node: PythonNode): boolean {
  const name = lastAttr(node.func);
  if (name !== "to" && name !== "cuda") {
    return false;
  }
  const chain = attrChain(node.func);
  const recv = chain[chain.length - 2];
  return recv !== undefined && MODULE_RECV.has(recv);
}
