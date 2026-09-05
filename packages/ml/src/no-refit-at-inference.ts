import { relative } from "node:path";
import {
  asNodes,
  isPythonNode,
  nodeRange,
  type PythonNode,
  type PythonSource,
  walkCallables,
} from "@qualety/python/walk";
import { defineRule, type RuleContext } from "qualety";
import {
  assignTarget,
  attrChain,
  forEachMlSource,
  isModelForwardCall,
  lastAttr,
  treeHas,
  walkSkipDefs,
} from "./ast.ts";

const TRANSFORMERS = new Set([
  "StandardScaler",
  "MinMaxScaler",
  "RobustScaler",
  "Normalizer",
  "QuantileTransformer",
  "PowerTransformer",
  "PolynomialFeatures",
  "OneHotEncoder",
  "LabelEncoder",
  "OrdinalEncoder",
  "SimpleImputer",
  "KNNImputer",
  "PCA",
  "TruncatedSVD",
  "Pipeline",
  "make_pipeline",
]);
const NAME_HINTS = ["infer", "predict", "serve", "deploy", "forward_eval", "policy_step"];
const INFER_PATH = /(?:^|\/)(infer|inference|serving|deploy|predict)(?:\/|_|\.py$)/;
const REFIT_HINT =
  "Use stats/transforms stored with the checkpoint (or fit only in training entry points); at serve call .transform with frozen parameters, never .fit / .fit_transform.";

export const noRefitAtInference = defineRule({
  meta: {
    requires: ["python"],
    docs: {
      description:
        "Do not fit or re-estimate transforms on an inference, serve, or checkpoint-load path.",
    },
  },
  create(context) {
    for (const python of [context.getArtifact("python")]) {
      forEachMlSource(python.sources, context.getCwd(), { trainingOnly: false }, (unit) => {
        scanUnit(context, unit, context.getCwd());
      });
    }
  },
});

function scanUnit(context: RuleContext, unit: PythonSource, cwd: string) {
  const moduleNames = transformerNames(unit.tree, new Set());
  const moduleInfer = pathIsInfer(unit.file, cwd) || treeHasLoad(unit.tree);
  reportScope(context, unit, unit.tree, moduleNames, moduleInfer);
  walkCallables(unit.tree, "", false, (fn, className) => {
    const hasInference = moduleInfer || functionInfer(fn, className);
    reportScope(context, unit, fn, transformerNames(fn, moduleNames), hasInference);
  });
}

function reportScope(
  context: RuleContext,
  unit: PythonSource,
  scope: PythonNode,
  names: ReadonlySet<string>,
  hasInference: boolean,
) {
  if (!hasInference) {
    return;
  }
  walkBody(scope, (node) => {
    if (!isFitCall(node) || !isPythonNode(node.func) || !isPythonNode(node.func.value)) {
      return;
    }
    if (!isTransformerExpr(node.func.value, names)) {
      return;
    }
    context.report({
      severity: "error",
      file: unit.file,
      range: nodeRange(node),
      message: "Transformer .fit/.fit_transform on an inference path recomputes batch statistics.",
      suggestion: REFIT_HINT,
    });
  });
  for (const site of statsSites(scope)) {
    context.report({
      severity: "error",
      file: unit.file,
      range: nodeRange(site),
      message:
        "Batch mean/std normalization on an inference path recomputes statistics from the current batch.",
      suggestion: REFIT_HINT,
    });
  }
}

function walkBody(scope: PythonNode, visit: (node: PythonNode) => void) {
  for (const stmt of asNodes(scope.body)) {
    walkSkipDefs(stmt, visit);
  }
}

function transformerNames(scope: PythonNode, inherited: ReadonlySet<string>): Set<string> {
  const names = new Set(inherited);
  for (const stmt of asNodes(scope.body)) {
    const target = assignTarget(stmt);
    if (
      target?._type === "Name" &&
      typeof target.id === "string" &&
      isPythonNode(stmt.value) &&
      isTransformerExpr(stmt.value, names)
    ) {
      names.add(target.id);
    }
  }
  return names;
}

function isTransformerExpr(node: PythonNode, names: ReadonlySet<string>): boolean {
  if (node._type === "Call") {
    const name = lastAttr(node.func);
    return name !== undefined && TRANSFORMERS.has(name);
  }
  if (node._type === "Name" && typeof node.id === "string") {
    return names.has(node.id);
  }
  const name = lastAttr(node);
  return name !== undefined && TRANSFORMERS.has(name);
}

function isFitCall(node: PythonNode): node is PythonNode & { readonly _type: "Call" } {
  if (node._type !== "Call" || !isPythonNode(node.func) || node.func._type !== "Attribute") {
    return false;
  }
  return node.func.attr === "fit" || node.func.attr === "fit_transform";
}

function pathIsInfer(file: string, cwd: string): boolean {
  return INFER_PATH.test(relative(cwd, file).split("\\").join("/"));
}

function functionInfer(fn: PythonNode, className: string): boolean {
  const name = typeof fn.name === "string" ? fn.name : "";
  if (!nameHits(name) && !nameHits(className)) {
    return false;
  }
  return treeHas(fn, isModelForwardCall);
}

function nameHits(name: string): boolean {
  if (name === "act") {
    return true;
  }
  return NAME_HINTS.some(
    (part) =>
      name === part ||
      name.startsWith(`${part}_`) ||
      name.endsWith(`_${part}`) ||
      name.includes(`_${part}_`),
  );
}

function treeHasLoad(tree: PythonNode): boolean {
  return treeHas(tree, isCheckpointLoad);
}

function isCheckpointLoad(node: PythonNode): boolean {
  if (node._type !== "Call") {
    return false;
  }
  const name = lastAttr(node.func);
  if (name === "load_state_dict" || name === "from_pretrained") {
    return true;
  }
  return name === "load" && attrChain(node.func).includes("torch");
}

function statsSites(scope: PythonNode): PythonNode[] {
  const calls: PythonNode[] = [];
  walkBody(scope, (node) => {
    if (isMeanStdCall(node)) {
      calls.push(node);
    }
  });
  if (calls.length === 0) {
    return [];
  }
  const bound = new Map<string, PythonNode>();
  for (const stmt of asNodes(scope.body)) {
    const target = assignTarget(stmt);
    if (target?._type !== "Name" || typeof target.id !== "string" || !isPythonNode(stmt.value)) {
      continue;
    }
    const source = statsSource(stmt.value, calls, bound);
    if (source !== undefined) {
      bound.set(target.id, source);
    }
  }
  const hits = new Set<PythonNode>();
  walkBody(scope, (node) => {
    for (const operand of subDivOperands(node)) {
      const source = statsSource(operand, calls, bound);
      if (source !== undefined) {
        hits.add(source);
      }
    }
  });
  return [...hits];
}

function statsSource(
  node: PythonNode,
  calls: readonly PythonNode[],
  bound: ReadonlyMap<string, PythonNode>,
): PythonNode | undefined {
  if (calls.includes(node)) {
    return node;
  }
  if (node._type === "Name" && typeof node.id === "string") {
    return bound.get(node.id);
  }
  return undefined;
}

function isMeanStdCall(node: PythonNode): boolean {
  if (node._type !== "Call") {
    return false;
  }
  const attr = lastAttr(node.func);
  if (attr !== "mean" && attr !== "std") {
    return false;
  }
  const chain = attrChain(node.func);
  if (chain.includes("torch") || chain.includes("np") || chain.includes("numpy")) {
    return true;
  }
  return chain.length >= 2;
}

function subDivOperands(node: PythonNode): PythonNode[] {
  if (!isPythonNode(node.op) || (node.op._type !== "Sub" && node.op._type !== "Div")) {
    return [];
  }
  if (node._type === "BinOp") {
    return [node.left, node.right].filter((item) => isPythonNode(item));
  }
  if (node._type === "AugAssign" && isPythonNode(node.value)) {
    return [node.value];
  }
  return [];
}
