import { defineRule, type RuleContext } from "qualety";
import {
  asNodes,
  attrChain,
  firstTrainingNode,
  isPythonNode,
  isSkippedSource,
  isTrainingModule,
  lastAttr,
  nodeRange,
  type PythonNode,
  type PythonSource,
  pythonSources,
  walkNodes,
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
    const cwd = context.getCwd();
    for (const unit of pythonSources(context.getArtifact("python"))) {
      if (isSkippedSource(unit.file, cwd) || !isTrainingModule(unit.tree)) {
        continue;
      }
      checkUnit(unit, context);
    }
  },
});

function checkUnit(unit: PythonSource, context: Pick<RuleContext, "report">) {
  let found = false;
  walkNodes(unit.tree, (node) => {
    if (isDeterministicCall(node) || isCudnnDeterministicTrue(node)) {
      found = true;
    }
  });
  if (found) {
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
}

function isDeterministicCall(node: PythonNode): boolean {
  return node._type === "Call" && lastAttr(node.func) === "use_deterministic_algorithms";
}

function isCudnnDeterministicTrue(node: PythonNode): boolean {
  const target = assignTarget(node);
  if (target === undefined || !isTrue(node.value)) {
    return false;
  }
  const chain = attrChain(target);
  return chain[chain.length - 1] === "deterministic" && chain.includes("cudnn");
}

function assignTarget(node: PythonNode): PythonNode | undefined {
  if (node._type === "AnnAssign" && isPythonNode(node.target)) {
    return node.target;
  }
  if (node._type !== "Assign") {
    return undefined;
  }
  return asNodes(node.targets)[0];
}

function isTrue(value: unknown): boolean {
  return isPythonNode(value) && value._type === "Constant" && value.value === true;
}
