import { defineRule, type RuleContext } from "qualety";
import { type GetAccessorDeclaration, Node, SyntaxKind, type VariableDeclaration } from "ts-morph";
import { unwrapParens } from "./narrowing.ts";
import { type FunctionLike, isFunctionLike } from "./parse-flow.ts";
import { reportAt, walkTsSources } from "./ts-source.ts";

export const explicitPublicReturnTypes = defineRule({
  meta: {
    requires: ["typescript"],
    docs: {
      description: "Exported functions and public class methods must have an explicit return type.",
    },
  },
  create(context) {
    const artifact = context.getArtifact("typescript");
    walkTsSources(artifact.sources, (unit, file) => {
      for (const stmt of unit.getStatements()) {
        if (stmt.getPos() >= 0) {
          considerStatement(stmt, file, context);
        }
      }
    });
  },
});

function considerStatement(stmt: Node, file: string, context: Pick<RuleContext, "report">) {
  if (considerExportedFunction(stmt, file, context) || considerExportedVars(stmt, file, context)) {
    return;
  }
  if (Node.isClassDeclaration(stmt) && stmt.hasExportKeyword() && !stmt.hasDeclareKeyword()) {
    considerClass(stmt, stmt.getName() ?? "default", file, context);
    return;
  }
  if (Node.isExportAssignment(stmt) && !stmt.isExportEquals()) {
    const expr = unwrapParens(stmt.getExpression());
    if (isFunctionLike(expr)) {
      considerFn(expr, "default", file, context);
    }
  }
}

function considerExportedFunction(
  stmt: Node,
  file: string,
  context: Pick<RuleContext, "report">,
): boolean {
  if (Node.isFunctionDeclaration(stmt)) {
    if (stmt.hasExportKeyword() && !stmt.hasDeclareKeyword()) {
      const name = stmt.isDefaultExport() ? "default" : (stmt.getName() ?? "default");
      considerFn(stmt, name, file, context);
      return true;
    }
  }
  return false;
}

function considerExportedVars(
  stmt: Node,
  file: string,
  context: Pick<RuleContext, "report">,
): boolean {
  if (Node.isVariableStatement(stmt)) {
    if (stmt.hasExportKeyword()) {
      for (const decl of stmt.getDeclarations()) {
        considerVar(decl, file, context);
      }
      return true;
    }
  }
  return false;
}

function considerVar(
  decl: VariableDeclaration,
  file: string,
  context: Pick<RuleContext, "report">,
) {
  const init = decl.getInitializer();
  if (init === undefined) {
    return;
  }
  const expr = unwrapParens(init);
  if (!isFunctionLike(expr)) {
    return;
  }
  if (decl.getTypeNode() !== undefined && decl.getType().getCallSignatures().length > 0) {
    return;
  }
  considerFn(expr, decl.getName(), file, context);
}

function considerClass(
  stmt: Node,
  className: string,
  file: string,
  context: Pick<RuleContext, "report">,
) {
  if (!Node.isClassDeclaration(stmt)) {
    return;
  }
  for (const member of stmt.getMembers()) {
    if (Node.isMethodDeclaration(member) && publicMember(member)) {
      considerFn(member, `${className}.${member.getName()}`, file, context);
    }
    if (Node.isGetAccessorDeclaration(member) && publicMember(member)) {
      considerGetter(member, `${className}.${member.getName()}`, file, context);
    }
  }
}

function publicMember(member: Node): boolean {
  if (!Node.isMethodDeclaration(member) && !Node.isGetAccessorDeclaration(member)) {
    return false;
  }
  if (
    member.hasModifier(SyntaxKind.PrivateKeyword) ||
    member.hasModifier(SyntaxKind.ProtectedKeyword)
  ) {
    return false;
  }
  return !Node.isPrivateIdentifier(member.getNameNode());
}

function considerFn(
  fn: FunctionLike,
  name: string,
  file: string,
  context: Pick<RuleContext, "report">,
) {
  if (fn.getReturnTypeNode() !== undefined) {
    return;
  }
  const at =
    Node.isFunctionDeclaration(fn) || Node.isMethodDeclaration(fn) || Node.isFunctionExpression(fn)
      ? (fn.getNameNode() ?? fn)
      : fn;
  reportAt(
    context,
    file,
    at,
    `Public export "${name}" is missing an explicit return type.`,
    returnHint(fn),
  );
}

function considerGetter(
  getter: GetAccessorDeclaration,
  name: string,
  file: string,
  context: Pick<RuleContext, "report">,
) {
  if (getter.getReturnTypeNode() !== undefined) {
    return;
  }
  reportAt(
    context,
    file,
    getter.getNameNode() ?? getter,
    `Public export "${name}" is missing an explicit return type.`,
    returnHint(getter),
  );
}

function returnHint(fn: FunctionLike | GetAccessorDeclaration): string {
  const text = fn.getReturnType().getText();
  if (
    text === "error" ||
    text === "any" ||
    text === "unknown" ||
    text.length > 40 ||
    text.includes("import(")
  ) {
    return "Add an explicit return type annotation.";
  }
  return `Add an explicit return type (e.g. ): ${text}).`;
}
