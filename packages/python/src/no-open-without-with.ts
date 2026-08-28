import { defineRule, type RuleContext } from "qualety";
import type { PythonNode } from "./python.ts";
import { asNodes, childNodes, isPythonNode, isSkippedSource, nodeRange } from "./walk.ts";

const OPEN_HINT = "Use with open(...) as …: (or pathlib.Path.open in with).";

export const noOpenWithoutWith = defineRule({
  meta: {
    requires: ["python"],
    docs: {
      description: "Do not call open(...) outside a with / async with in the same function.",
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
      checkScope(asNodes(unit.tree.body), unit.file, context);
      visitFunctions(unit.tree, unit.file, context);
    }
  },
});

function visitFunctions(node: PythonNode, file: string, context: Pick<RuleContext, "report">) {
  if (node._type === "FunctionDef" || node._type === "AsyncFunctionDef") {
    checkScope(asNodes(node.body), file, context);
    for (const child of childNodes(node)) {
      visitFunctions(child, file, context);
    }
    return;
  }
  for (const child of childNodes(node)) {
    visitFunctions(child, file, context);
  }
}

function checkScope(
  stmts: readonly PythonNode[],
  file: string,
  context: Pick<RuleContext, "report">,
) {
  for (const stmt of stmts) {
    if (stmt._type !== "FunctionDef" && stmt._type !== "AsyncFunctionDef") {
      considerOpen(stmt, file, context);
      for (const child of childNodes(stmt)) {
        walkOpen(child, file, context);
      }
    }
  }
}

function walkOpen(node: PythonNode, file: string, context: Pick<RuleContext, "report">) {
  if (node._type !== "FunctionDef" && node._type !== "AsyncFunctionDef") {
    considerOpen(node, file, context);
    for (const child of childNodes(node)) {
      walkOpen(child, file, context);
    }
  }
}

function considerOpen(node: PythonNode, file: string, context: Pick<RuleContext, "report">) {
  if (node._type === "Expr" && isOpenCall(node.value)) {
    reportOpen(node.value, file, context);
    return;
  }
  if (node._type === "Assign" && isOpenCall(node.value) && assignedToName(node)) {
    reportOpen(node.value, file, context);
    return;
  }
  if (node._type === "AnnAssign" && isOpenCall(node.value) && assignedToName(node)) {
    reportOpen(node.value, file, context);
  }
}

function assignedToName(stmt: PythonNode): boolean {
  if (stmt._type === "AnnAssign") {
    return isPythonNode(stmt.target) && stmt.target._type === "Name";
  }
  const targets = asNodes(stmt.targets);
  if (targets.length === 0) {
    return false;
  }
  return targets.every((target) => target._type === "Name");
}

function isOpenCall(value: unknown): value is PythonNode {
  if (!isPythonNode(value) || value._type !== "Call" || !isPythonNode(value.func)) {
    return false;
  }
  return value.func._type === "Name" && value.func.id === "open";
}

function reportOpen(call: PythonNode, file: string, context: Pick<RuleContext, "report">) {
  context.report({
    severity: "error",
    file,
    range: nodeRange(call),
    message: "open(...) is not used as a with / async with context manager.",
    suggestion: OPEN_HINT,
  });
}
