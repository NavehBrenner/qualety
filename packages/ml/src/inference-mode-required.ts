import {
  asNodes,
  childNodes,
  hasDecorator,
  isPythonNode,
  nodeRange,
  type PythonNode,
  walkCallables,
} from "@qualety/python/walk";
import { defineRule } from "qualety";
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
          if (treeHas(fn, isBackwardCall)) {
            return;
          }
          const evalPos: { line: number; column: number }[] = [];
          const decorated = hasDecorator(fn, GUARDS);
          walkGuarded(fn, fn, decorated, false, (node) => {
            if (node._type === "Call" && lastAttr(node.func) === "eval") {
              evalPos.push(nodePos(node));
            }
          });
          // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: inlined inference report
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
        });
      });
    }
  },
});

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: inlined with/assign walk
function walkGuarded(
  node: PythonNode,
  root: PythonNode,
  guarded: boolean,
  inLoss: boolean,
  visit: (node: PythonNode, guarded: boolean, inLoss: boolean) => void,
) {
  visit(node, guarded, inLoss);
  if (
    node !== root &&
    (node._type === "FunctionDef" ||
      node._type === "AsyncFunctionDef" ||
      node._type === "ClassDef" ||
      node._type === "Lambda")
  ) {
    return;
  }
  if (node._type === "With" || node._type === "AsyncWith") {
    const inner = withGuard(node, guarded);
    for (const item of asNodes(node.items)) {
      walkGuarded(item, root, guarded, inLoss, visit);
    }
    for (const stmt of asNodes(node.body)) {
      walkGuarded(stmt, root, inner, inLoss, visit);
    }
    return;
  }
  if (node._type === "Assign" || node._type === "AnnAssign") {
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
    return;
  }
  for (const child of childNodes(node)) {
    walkGuarded(child, root, guarded, inLoss, visit);
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
