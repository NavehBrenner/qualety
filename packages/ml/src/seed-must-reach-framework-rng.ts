import { defineRule, type RuleContext } from "qualety";
import {
  asNodes,
  attrChain,
  callKeyword,
  childNodes,
  firstTrainingNode,
  functionArgNames,
  isPythonNode,
  isSkippedSource,
  isTrainingModule,
  lastAttr,
  nodeRange,
  type PythonNode,
  type PythonSource,
  pythonSources,
  stringConstant,
  walkNodes,
} from "./ast.ts";

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
  checkScope(asNodes(unit.tree.body), unit, context);
  walkFunctions(unit.tree, unit, context);
}

function walkFunctions(node: PythonNode, unit: PythonSource, context: Pick<RuleContext, "report">) {
  if (node._type === "FunctionDef" || node._type === "AsyncFunctionDef") {
    const names = seedNamesInFunction(node);
    considerUses(node, names, unit, context);
    return;
  }
  for (const child of childNodes(node)) {
    walkFunctions(child, unit, context);
  }
}

function checkScope(
  stmts: readonly PythonNode[],
  unit: PythonSource,
  context: Pick<RuleContext, "report">,
) {
  const names = new Set(SEED_NAMES);
  addArgparseDestsFromStmts(stmts, names);
  const synthetic: PythonNode = { _type: "Module", body: stmts };
  considerUses(synthetic, names, unit, context);
}

function seedNamesInFunction(fn: PythonNode): Set<string> {
  const names = new Set(SEED_NAMES);
  for (const arg of functionArgNames(fn)) {
    if (SEED_NAMES.has(arg)) {
      names.add(arg);
    }
  }
  addArgparseDestsFromStmts(asNodes(fn.body), names);
  return names;
}

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
    if (flag !== undefined && FLAG_DEST[flag] !== undefined) {
      return FLAG_DEST[flag];
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
      if (reportAt === undefined) {
        reportAt = node;
      }
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
  if (name === "train_test_split") {
    return "nonsink";
  }
  if (name === "Random") {
    return "nonsink";
  }
  if (isFrameworkSink(node, name)) {
    return "sink";
  }
  return "unknown";
}

function isFrameworkSink(node: PythonNode, name: string | undefined): boolean {
  if (name === "manual_seed") {
    return true;
  }
  if (name === "seed") {
    return true;
  }
  if (name === "Generator" && callKeyword(node, "seed") !== undefined) {
    return true;
  }
  if (name === "DataLoader" && callTakesGenerator(node)) {
    return true;
  }
  return attrChain(node.func).includes("manual_seed");
}

function callTakesGenerator(node: PythonNode): boolean {
  return callKeyword(node, "generator") !== undefined;
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
