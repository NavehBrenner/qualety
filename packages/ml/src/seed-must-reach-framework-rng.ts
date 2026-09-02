import {
  asNodes,
  childNodes,
  isPythonNode,
  nodeRange,
  type PythonNode,
  type PythonSource,
  stringConstant,
  walkNodes,
} from "@qualety/python/walk";
import { defineRule, type RuleContext } from "qualety";
import { attrChain, callKeyword, firstTrainingNode, forEachMlSource, lastAttr } from "./ast.ts";

const SEED_NAMES = new Set(["seed", "train_seed", "split_seed"]);
const FLAG_DEST: Record<string, string> = {
  "--seed": "seed",
  "--train-seed": "train_seed",
  "--split-seed": "split_seed",
};
const REACH_HINT = "Pass the seed into torch.manual_seed / numpy / random / loader generator.";

export const seedMustReachFrameworkRng = defineRule({
  meta: {
    requires: ["python"],
    docs: {
      description:
        "A seed parameter in a training module must reach a framework RNG, not only split helpers.",
    },
  },
  create(context) {
    for (const python of [context.getArtifact("python")]) {
      // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: inlined scope + nested-def walk
      forEachMlSource(python.sources, context.getCwd(), { trainingOnly: true }, (unit) => {
        const moduleNames = new Set(SEED_NAMES);
        addArgparseDestsFromStmts(asNodes(unit.tree.body), moduleNames);
        considerUses(
          { _type: "Module", body: asNodes(unit.tree.body) },
          moduleNames,
          unit,
          context,
        );
        const stack: PythonNode[] = [unit.tree];
        while (stack.length > 0) {
          const node = stack.pop();
          if (node === undefined) {
            continue;
          }
          if (node._type === "FunctionDef" || node._type === "AsyncFunctionDef") {
            const names = new Set(SEED_NAMES);
            if (isPythonNode(node.args)) {
              const args = [
                ...asNodes(node.args.posonlyargs),
                ...asNodes(node.args.args),
                ...asNodes(node.args.kwonlyargs),
              ];
              for (const arg of args) {
                if (typeof arg.arg === "string" && SEED_NAMES.has(arg.arg)) {
                  names.add(arg.arg);
                }
              }
            }
            addArgparseDestsFromStmts(asNodes(node.body), names);
            considerUses(node, names, unit, context);
            continue;
          }
          for (const child of childNodes(node)) {
            stack.push(child);
          }
        }
      });
    }
  },
});

function addArgparseDestsFromStmts(stmts: readonly PythonNode[], names: Set<string>) {
  for (const stmt of stmts) {
    walkNodes(stmt, (node) => {
      const dest = argparseDest(node);
      if (dest !== undefined) {
        names.add(dest);
      }
    });
  }
}

function argparseDest(node: PythonNode): string | undefined {
  if (node._type !== "Call" || lastAttr(node.func) !== "add_argument") {
    return undefined;
  }
  const dest = stringConstant(callKeyword(node, "dest"));
  if (dest !== undefined && SEED_NAMES.has(dest)) {
    return dest;
  }
  for (const arg of asNodes(node.args)) {
    const flag = stringConstant(arg);
    const destName = flag === undefined ? undefined : FLAG_DEST[flag];
    if (destName !== undefined) {
      return destName;
    }
  }
  return undefined;
}

function considerUses(
  scope: PythonNode,
  names: Set<string>,
  unit: PythonSource,
  context: Pick<RuleContext, "report">,
) {
  const kinds: CallKind[] = [];
  let reportAt: PythonNode | undefined;
  for (const stmt of asNodes(scope.body)) {
    walkSkipDefs(stmt, (node) => {
      if (node._type !== "Call" || !callTakesSeed(node, names)) {
        return;
      }
      kinds.push(classifyCall(node));
      reportAt ??= node;
    });
  }
  if (kinds.length === 0 || kinds.includes("sink") || kinds.includes("unknown")) {
    return;
  }
  const evidence = reportAt ?? firstTrainingNode(unit.tree) ?? scope;
  context.report({
    severity: "error",
    file: unit.file,
    range: nodeRange(evidence),
    message: "Seed value is used for split/local RNG but never reaches a framework RNG.",
    suggestion: REACH_HINT,
  });
}

type CallKind = "sink" | "nonsink" | "unknown";

function callTakesSeed(node: PythonNode, names: Set<string>): boolean {
  for (const arg of asNodes(node.args)) {
    if (isSeedExpr(arg, names)) {
      return true;
    }
  }
  for (const keyword of asNodes(node.keywords)) {
    if (isPythonNode(keyword.value) && isSeedExpr(keyword.value, names)) {
      return true;
    }
  }
  return false;
}

function isSeedExpr(node: PythonNode, names: Set<string>): boolean {
  if (node._type === "Name" && typeof node.id === "string" && names.has(node.id)) {
    return true;
  }
  return node._type === "Attribute" && typeof node.attr === "string" && names.has(node.attr);
}

function classifyCall(node: PythonNode): CallKind {
  const name = lastAttr(node.func);
  if (name === "train_test_split" || name === "Random") {
    return "nonsink";
  }
  if (name === "manual_seed" || name === "seed") {
    return "sink";
  }
  if (name === "Generator" && callKeyword(node, "seed") !== undefined) {
    return "sink";
  }
  if (name === "DataLoader" && callKeyword(node, "generator") !== undefined) {
    return "sink";
  }
  if (attrChain(node.func).includes("manual_seed")) {
    return "sink";
  }
  return "unknown";
}

function walkSkipDefs(node: PythonNode, visit: (node: PythonNode) => void): void {
  visit(node);
  if (
    node._type === "FunctionDef" ||
    node._type === "AsyncFunctionDef" ||
    node._type === "ClassDef"
  ) {
    return;
  }
  for (const child of childNodes(node)) {
    walkSkipDefs(child, visit);
  }
}
