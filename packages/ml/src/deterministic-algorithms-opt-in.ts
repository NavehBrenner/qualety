import { isPythonNode, nodeRange, type PythonNode } from "@qualety/python/walk";
import { defineRule } from "qualety";
import {
  assignTarget,
  attrChain,
  firstTrainingNode,
  forEachMlSource,
  lastAttr,
  treeHas,
} from "./ast.ts";

const DET_HINT = "Call torch.use_deterministic_algorithms(True) or set cudnn.deterministic.";

export const deterministicAlgorithmsOptIn = defineRule({
  meta: {
    requires: ["python"],
    docs: {
      description:
        "Opt-in: a training module must call use_deterministic_algorithms or set cudnn.deterministic.",
    },
  },
  create(context) {
    for (const python of [context.getArtifact("python")]) {
      forEachMlSource(python.sources, context.getCwd(), { trainingOnly: true }, (unit) => {
        if (treeHas(unit.tree, hasDetAlgo)) {
          return;
        }
        const evidence = firstTrainingNode(unit.tree) ?? unit.tree;
        context.report({
          severity: "error",
          file: unit.file,
          range: nodeRange(evidence),
          message:
            "Training module does not call torch.use_deterministic_algorithms or set cudnn.deterministic.",
          suggestion: DET_HINT,
        });
      });
    }
  },
});

function hasDetAlgo(node: PythonNode): boolean {
  if (node._type === "Call" && lastAttr(node.func) === "use_deterministic_algorithms") {
    return true;
  }
  const target = assignTarget(node);
  if (target === undefined) {
    return false;
  }
  if (!isPythonNode(node.value) || node.value._type !== "Constant" || node.value.value !== true) {
    return false;
  }
  const chain = attrChain(target);
  return chain[chain.length - 1] === "deterministic" && chain.includes("cudnn");
}
