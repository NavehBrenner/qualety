import { defineRule, type RuleContext } from "qualety";
import type { PythonNode } from "./python.ts";
import { asNodes, childNodes, isPythonNode, isSkippedSource, nodeRange } from "./walk.ts";

const MUTABLE_CTORS = new Set(["list", "dict", "set"]);
const MUTABLE_HINT =
  "Use None as the default and assign a new list/dict/set inside the body, or use an immutable default.";

export const noMutableDefault = defineRule({
  meta: {
    requires: ["python"],
    docs: {
      description: "Do not use a mutable object as a function default argument.",
    },
  },
  create(context) {
    const cwd = context.getCwd();
    const sources = context.getArtifact("python").sources;
    if (!(sources instanceof Map)) {
      return;
    }
    for (const [abs, unit] of sources) {
      if (isSkippedSource(abs, cwd)) {
        continue;
      }
      const aliases = readCtorAliases(unit.tree);
      const factories = readFactories(unit.tree);
      walkDefs(unit.tree, (fn) => {
        reportMutableDefaults(fn, unit.file, aliases, factories, context);
      });
    }
  },
});

function walkDefs(node: PythonNode, visit: (fn: PythonNode) => void) {
  if (node._type === "FunctionDef" || node._type === "AsyncFunctionDef") {
    visit(node);
    for (const child of childNodes(node)) {
      walkDefs(child, visit);
    }
    return;
  }
  for (const child of childNodes(node)) {
    walkDefs(child, visit);
  }
}

function reportMutableDefaults(
  fn: PythonNode,
  file: string,
  aliases: ReadonlySet<string>,
  factories: ReadonlySet<string>,
  context: Pick<RuleContext, "report">,
) {
  if (!isPythonNode(fn.args) || fn.args._type !== "arguments") {
    return;
  }
  const values = [...asNodes(fn.args.defaults), ...asNodes(fn.args.kw_defaults)];
  for (const value of values) {
    if (isMutableExpr(value, aliases, factories)) {
      context.report({
        severity: "error",
        file,
        range: nodeRange(value),
        message: "Mutable default argument is shared across calls.",
        suggestion: MUTABLE_HINT,
      });
    }
  }
}

function isMutableExpr(
  node: PythonNode,
  aliases: ReadonlySet<string>,
  factories: ReadonlySet<string>,
): boolean {
  if (node._type === "List" || node._type === "Dict" || node._type === "Set") {
    return true;
  }
  if (node._type !== "Call" || !isPythonNode(node.func) || node.func._type !== "Name") {
    return false;
  }
  if (typeof node.func.id !== "string") {
    return false;
  }
  return (
    MUTABLE_CTORS.has(node.func.id) || aliases.has(node.func.id) || factories.has(node.func.id)
  );
}

function readCtorAliases(tree: PythonNode): Set<string> {
  const aliases = new Set<string>();
  for (const stmt of asNodes(tree.body)) {
    if (stmt._type === "Assign" || stmt._type === "AnnAssign" || stmt._type === "ImportFrom") {
      addAssignAlias(stmt, aliases);
      addImportAlias(stmt, aliases);
    }
  }
  return aliases;
}

function addAssignAlias(stmt: PythonNode, aliases: Set<string>) {
  if (stmt._type === "Assign") {
    const targets = asNodes(stmt.targets);
    const target = targets[0];
    if (targets.length === 1 && isPythonNode(target) && target._type === "Name") {
      if (typeof target.id === "string" && isCtorName(stmt.value)) {
        aliases.add(target.id);
      }
    }
  }
  if (stmt._type === "AnnAssign" && isPythonNode(stmt.target) && stmt.target._type === "Name") {
    if (typeof stmt.target.id === "string" && isCtorName(stmt.value)) {
      aliases.add(stmt.target.id);
    }
  }
}

function addImportAlias(stmt: PythonNode, aliases: Set<string>) {
  if (stmt._type !== "ImportFrom") {
    return;
  }
  for (const alias of asNodes(stmt.names)) {
    if (typeof alias.name === "string" && MUTABLE_CTORS.has(alias.name)) {
      const local = typeof alias.asname === "string" ? alias.asname : alias.name;
      aliases.add(local);
    }
  }
}

function isCtorName(value: unknown): boolean {
  return isPythonNode(value) && value._type === "Name" && typeof value.id === "string"
    ? MUTABLE_CTORS.has(value.id)
    : false;
}

function readFactories(tree: PythonNode): Set<string> {
  const factories = new Set<string>();
  for (const stmt of asNodes(tree.body)) {
    if (stmt._type !== "FunctionDef" && stmt._type !== "AsyncFunctionDef") {
      continue;
    }
    if (typeof stmt.name === "string" && isEmptyCollectionFactory(stmt)) {
      factories.add(stmt.name);
    }
  }
  return factories;
}

function isEmptyCollectionFactory(fn: PythonNode): boolean {
  const body = asNodes(fn.body);
  if (body.length !== 1) {
    return false;
  }
  const stmt = body[0];
  if (stmt === undefined || stmt._type !== "Return" || !isPythonNode(stmt.value)) {
    return false;
  }
  return isMutableExpr(stmt.value, new Set(), new Set());
}
