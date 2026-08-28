import { defineRule, type RuleContext } from "qualety";
import type { PythonNode } from "./python.ts";
import { asNodes, forEachPythonSource, isPythonNode, nodeRange, walkNodes } from "./walk.ts";

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
      walkNodes(unit.tree, (node) => {
        if (node._type === "ExceptHandler") {
          reportSilent(node, unit.file, context);
        }
      });
    });
  },
});

function reportSilent(handler: PythonNode, file: string, context: Pick<RuleContext, "report">) {
  const body = asNodes(handler.body);
  if (body.length === 0) {
    return;
  }
  for (const stmt of body) {
    if (stmt._type === "Pass" || stmt._type === "Continue") {
      continue;
    }
    if (stmt._type !== "Expr" || !isPythonNode(stmt.value) || stmt.value._type !== "Constant") {
      return;
    }
    const value = stmt.value.value;
    if (value !== "Ellipsis" && typeof value !== "string") {
      return;
    }
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
