import { defineRule, type RuleContext } from "qualety";
import { Node, type SourceFile } from "ts-morph";
import { unwrapParens } from "./narrowing.ts";
import { type FunctionLike, isFunctionLike } from "./parse-flow.ts";
import { reportAt, walkTsArtifact } from "./ts-source.ts";

const HINT = "Replace any with a real type or unknown, then narrow.";

export const noPublicAny = defineRule({
  meta: {
    requires: ["typescript"],
    docs: {
      description: "Public value exports must not be annotated as any, any[], Function, or Object.",
    },
  },
  create(context) {
    walkTsArtifact(context, (unit, file) => {
      for (const stmt of unit.getStatements()) {
        if (
          Node.isFunctionDeclaration(stmt) ||
          Node.isVariableStatement(stmt) ||
          Node.isExportAssignment(stmt)
        ) {
          scanFile(unit, file, context);
          break;
        }
      }
    });
  },
});

function scanFile(sourceFile: SourceFile, file: string, context: Pick<RuleContext, "report">) {
  for (const stmt of sourceFile.getStatements()) {
    if (Node.isFunctionDeclaration(stmt) && stmt.hasExportKeyword()) {
      const name = stmt.isDefaultExport() ? "default" : (stmt.getName() ?? "default");
      scanFn(stmt, name, file, context);
      continue;
    }
    if (Node.isVariableStatement(stmt) && stmt.hasExportKeyword()) {
      scanVars(stmt, file, context);
      continue;
    }
    if (Node.isExportAssignment(stmt) && !stmt.isExportEquals()) {
      scanDefault(stmt, file, context);
    }
  }
}

function scanVars(stmt: Node, file: string, context: Pick<RuleContext, "report">) {
  if (!Node.isVariableStatement(stmt)) {
    return;
  }
  for (const decl of stmt.getDeclarations()) {
    const name = decl.getName();
    reportIfAny(decl.getTypeNode(), name, file, context);
    const init = decl.getInitializer();
    if (init === undefined) {
      continue;
    }
    const expr = unwrapParens(init);
    if (Node.isAsExpression(expr)) {
      reportIfAny(expr.getTypeNode(), name, file, context);
    }
    if (isFunctionLike(expr)) {
      scanFn(expr, name, file, context);
    }
  }
}

function scanDefault(stmt: Node, file: string, context: Pick<RuleContext, "report">) {
  if (!Node.isExportAssignment(stmt)) {
    return;
  }
  const expr = unwrapParens(stmt.getExpression());
  if (Node.isAsExpression(expr)) {
    reportIfAny(expr.getTypeNode(), "default", file, context);
  }
  if (isFunctionLike(expr)) {
    scanFn(expr, "default", file, context);
  }
}

function scanFn(
  fn: FunctionLike,
  name: string,
  file: string,
  context: Pick<RuleContext, "report">,
) {
  for (const param of fn.getParameters()) {
    reportIfAny(param.getTypeNode(), name, file, context);
  }
  reportIfAny(fn.getReturnTypeNode(), name, file, context);
}

function reportIfAny(
  typeNode: Node | undefined,
  name: string,
  file: string,
  context: Pick<RuleContext, "report">,
) {
  if (typeNode === undefined) {
    return;
  }
  const text = typeNode.getText().trim();
  if (text !== "any" && text !== "any[]" && text !== "Function" && text !== "Object") {
    return;
  }
  reportAt(context, file, typeNode, `Public export "${name}" is typed as any.`, HINT);
}
