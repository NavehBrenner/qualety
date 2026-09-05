import {
  asNodes,
  childNodes,
  hasDecorator,
  isPythonNode,
  nodeRange,
  type PythonNode,
  type PythonSource,
  walkCallables,
} from "@qualety/python/walk";
import { defineRule, type RuleContext } from "qualety";
import {
  assignTarget,
  forEachMlSource,
  isBackwardCall,
  isBefore,
  isModelForwardCall,
  lastAttr,
  nodePos,
  treeHas,
} from "./ast.ts";

const GUARDS = new Set(["no_grad", "inference_mode"]);
const MODE_HINT =
  "Wrap inference forwards in torch.inference_mode() (or no_grad) and call model.eval() before serve/predict.";

export const inferenceModeRequired = defineRule({
  meta: {
    requires: ["python"],
    docs: {
      description:
        "A model forward outside a training step must run under no_grad/inference_mode with eval() first.",
    },
  },
  create(context) {
    for (const python of [context.getArtifact("python")]) {
      forEachMlSource(python.sources, context.getCwd(), { trainingOnly: false }, (unit) => {
        walkCallables(unit.tree, "", false, (fn) => {
          scanFunction(context, unit, fn);
        });
      });
    }
  },
});

function scanFunction(context: RuleContext, unit: PythonSource, fn: PythonNode) {
  if (treeHas(fn, isBackwardCall)) {
    return;
  }
  const evalPos = evalPositions(fn);
  const decorated = hasDecorator(fn, GUARDS);
  walkGuarded(fn, fn, decorated, false, (node, guarded, inLoss) => {
    if (!isModelForwardCall(node) || inLoss) {
      return;
    }
    const hasEval = evalPos.some((pos) => isBefore(pos, nodePos(node)));
    if (guarded && hasEval) {
      return;
    }
    const missing = [
      ...(guarded ? [] : ["torch.inference_mode()/no_grad"]),
      ...(hasEval ? [] : ["model.eval()"]),
    ];
    context.report({
      severity: "error",
      file: unit.file,
      range: nodeRange(node),
      message: `Inference forward is missing ${missing.join(" and ")}.`,
      suggestion: MODE_HINT,
    });
  });
}

function evalPositions(fn: PythonNode) {
  const found: { line: number; column: number }[] = [];
  walkSameFn(fn, fn, (node) => {
    if (node._type === "Call" && lastAttr(node.func) === "eval") {
      found.push(nodePos(node));
    }
  });
  return found;
}

function walkSameFn(node: PythonNode, root: PythonNode, visit: (node: PythonNode) => void) {
  visit(node);
  if (isNestedDef(node, root)) {
    return;
  }
  for (const child of childNodes(node)) {
    walkSameFn(child, root, visit);
  }
}

function isNestedDef(node: PythonNode, root: PythonNode): boolean {
  if (node === root) {
    return false;
  }
  return (
    node._type === "FunctionDef" ||
    node._type === "AsyncFunctionDef" ||
    node._type === "ClassDef" ||
    node._type === "Lambda"
  );
}

function walkGuarded(
  node: PythonNode,
  root: PythonNode,
  guarded: boolean,
  inLoss: boolean,
  visit: (node: PythonNode, guarded: boolean, inLoss: boolean) => void,
) {
  visit(node, guarded, inLoss);
  if (isNestedDef(node, root)) {
    return;
  }
  if (node._type === "With" || node._type === "AsyncWith") {
    walkWith(node, root, guarded, inLoss, visit);
    return;
  }
  if (node._type === "Assign" || node._type === "AnnAssign") {
    walkAssign(node, root, guarded, inLoss, visit);
    return;
  }
  for (const child of childNodes(node)) {
    walkGuarded(child, root, guarded, inLoss, visit);
  }
}

function walkWith(
  node: PythonNode,
  root: PythonNode,
  guarded: boolean,
  inLoss: boolean,
  visit: (node: PythonNode, guarded: boolean, inLoss: boolean) => void,
) {
  const inner = withGuard(node, guarded);
  for (const item of asNodes(node.items)) {
    walkGuarded(item, root, guarded, inLoss, visit);
  }
  for (const stmt of asNodes(node.body)) {
    walkGuarded(stmt, root, inner, inLoss, visit);
  }
}

function withGuard(node: PythonNode, current: boolean): boolean {
  let next = current;
  for (const item of asNodes(node.items)) {
    if (!isPythonNode(item.context_expr)) {
      continue;
    }
    const expr = item.context_expr;
    const name = expr._type === "Call" ? lastAttr(expr.func) : lastAttr(expr);
    if (name === "no_grad" || name === "inference_mode") {
      next = true;
    } else if (name === "enable_grad") {
      next = false;
    }
  }
  return next;
}

function walkAssign(
  node: PythonNode,
  root: PythonNode,
  guarded: boolean,
  inLoss: boolean,
  visit: (node: PythonNode, guarded: boolean, inLoss: boolean) => void,
) {
  const target = assignTarget(node);
  const loss = inLoss || (target?._type === "Name" && target.id === "loss");
  const value = isPythonNode(node.value) ? node.value : undefined;
  if (value !== undefined) {
    walkGuarded(value, root, guarded, loss, visit);
  }
  for (const child of childNodes(node)) {
    if (child !== value) {
      walkGuarded(child, root, guarded, inLoss, visit);
    }
  }
}
