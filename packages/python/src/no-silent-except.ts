import { defineRule, type RuleContext } from "qualety";
import type { PythonNode } from "./python.ts";
import { asNodes, childNodes, forEachPythonSource, isPythonNode, nodeRange } from "./walk.ts";

const SILENT_HINT =
  "Log and re-raise, catch a narrower type, or handle with a real branch, return, or raise.";

export const noSilentExcept = defineRule({
  meta: {
    requires: ["python"],
    docs: {
      description: "Do not swallow exceptions with a no-op except body.",
    },
  },
  create(context) {
    const python = context.getArtifact("python");
    const cwd = context.getCwd();
    forEachPythonSource(python.sources, cwd, (unit) => {
      const ancestors: PythonNode[] = [];
      (function visit(node: PythonNode) {
        if (node._type === "ExceptHandler") {
          reportSilent(node, ancestors, unit.file, context);
        }
        ancestors.push(node);
        for (const child of childNodes(node)) {
          visit(child);
        }
        ancestors.pop();
      })(unit.tree);
    });
  },
});

function reportSilent(
  handler: PythonNode,
  ancestors: readonly PythonNode[],
  file: string,
  context: Pick<RuleContext, "report">,
) {
  const kind = silentBodyKind(asNodes(handler.body));
  if (kind === undefined) {
    return;
  }
  if (kind === "continue" && loopExits(ancestors)) {
    return;
  }
  if (kind === "passEllipsis" && tryFallsThrough(ancestors)) {
    return;
  }
  context.report({
    severity: "error",
    file,
    range: nodeRange(handler),
    message:
      "Exception handler body is only pass, ellipsis, continue, or a string — the exception is swallowed.",
    suggestion: SILENT_HINT,
  });
}

function silentBodyKind(
  body: readonly PythonNode[],
): "string" | "continue" | "passEllipsis" | "mixed" | undefined {
  if (body.length === 0) {
    return undefined;
  }
  let hasContinue = false;
  let hasPassEllipsis = false;
  let hasString = false;
  for (const stmt of body) {
    const kind = noopStmtKind(stmt);
    if (kind === undefined) {
      return undefined;
    }
    hasContinue = hasContinue || kind === "continue";
    hasString = hasString || kind === "string";
    hasPassEllipsis = hasPassEllipsis || kind === "passEllipsis";
  }
  if (hasString) {
    return "string";
  }
  if (hasContinue && !hasPassEllipsis) {
    return "continue";
  }
  if (hasPassEllipsis && !hasContinue) {
    return "passEllipsis";
  }
  return "mixed";
}

function noopStmtKind(stmt: PythonNode): "passEllipsis" | "continue" | "string" | undefined {
  if (stmt._type === "Pass" || stmt._type === "Continue") {
    return stmt._type === "Pass" ? "passEllipsis" : "continue";
  }
  if (stmt._type === "Expr" && isPythonNode(stmt.value) && stmt.value._type === "Constant") {
    const value = stmt.value.value;
    if (value === "Ellipsis") {
      return "passEllipsis";
    }
    if (typeof value === "string") {
      return "string";
    }
  }
  return undefined;
}

function loopExits(ancestors: readonly PythonNode[]): boolean {
  for (let i = ancestors.length - 1; i >= 1; i -= 1) {
    const node = ancestors[i];
    const parent = ancestors[i - 1];
    if (node === undefined || parent === undefined) {
      continue;
    }
    if (node._type === "For" || node._type === "AsyncFor" || node._type === "While") {
      const next = nextSibling(node, parent);
      return next !== undefined && (next._type === "Raise" || next._type === "Return");
    }
  }
  return false;
}

function tryFallsThrough(ancestors: readonly PythonNode[]): boolean {
  for (let i = ancestors.length - 1; i >= 1; i -= 1) {
    const node = ancestors[i];
    const parent = ancestors[i - 1];
    if (node === undefined || parent === undefined) {
      continue;
    }
    if (node._type === "Try" || node._type === "TryStar") {
      const next = nextSibling(node, parent);
      if (next === undefined) {
        return false;
      }
      if (next._type === "Return" || next._type === "Raise" || next._type === "Assign") {
        return true;
      }
      return next._type === "AnnAssign" && next.value != null;
    }
  }
  return false;
}

function nextSibling(node: PythonNode, parent: PythonNode): PythonNode | undefined {
  for (const field of ["body", "orelse", "finalbody"] as const) {
    const list = asNodes(parent[field]);
    const index = list.indexOf(node);
    if (index >= 0) {
      return list[index + 1];
    }
  }
  return undefined;
}
