import { defineRule, type RuleContext } from "qualety";
import { Node, SyntaxKind, type Type } from "ts-morph";
import { isFunctionLike } from "./parse-flow.ts";
import { reportAt, walkTsSources } from "./ts-source.ts";

const HINT = "Add the missing case(s) or `const _exhaustive: never = …`.";

export const exhaustiveSwitch = defineRule({
  meta: {
    requires: ["typescript"],
    docs: {
      description:
        "Switch on a finite union or enum must handle every member or use a never-typed default.",
    },
  },
  create(context) {
    const artifact = context.getArtifact("typescript");
    walkTsSources(artifact.sources, (unit, file) => {
      for (const node of unit.getDescendantsOfKind(SyntaxKind.SwitchStatement)) {
        if (Node.isSwitchStatement(node)) {
          considerSwitch(node, file, context);
        }
      }
    });
  },
});

function considerSwitch(stmt: Node, file: string, context: Pick<RuleContext, "report">) {
  if (!Node.isSwitchStatement(stmt)) {
    return;
  }
  const units = finiteUnits(stmt.getExpression().getType());
  if (units === undefined) {
    return;
  }
  const remaining = uncoveredUnits(stmt, units);
  if (remaining === undefined || remaining.length === 0) {
    return;
  }
  const names = remaining
    .map((type) => type.getText())
    .filter((text) => text.length <= 40 && !text.includes("import("));
  const listed = names.length > 0 ? names.join(", ") : "union members";
  reportAt(context, file, stmt.getExpression(), `Switch is missing case(s) ${listed}.`, HINT);
}

function uncoveredUnits(stmt: Node, units: Type[]): Type[] | undefined {
  if (!Node.isSwitchStatement(stmt)) {
    return units;
  }
  const remaining = [...units];
  for (const clause of stmt.getCaseBlock().getClauses()) {
    if (Node.isDefaultClause(clause)) {
      if (hasExhaustiveDefault(clause)) {
        return undefined;
      }
      continue;
    }
    if (Node.isCaseClause(clause)) {
      dropCovered(remaining, clause.getExpression().getType());
    }
  }
  return remaining;
}

function dropCovered(remaining: Type[], caseType: Type): void {
  for (let index = remaining.length - 1; index >= 0; index -= 1) {
    const member = remaining[index];
    if (member !== undefined && sameUnit(caseType, member)) {
      remaining.splice(index, 1);
    }
  }
}

function finiteUnits(type: Type): Type[] | undefined {
  if (type.isAny() || type.isUnknown() || type.getText() === "error") {
    return undefined;
  }
  const parts = type.isUnion() ? type.getUnionTypes() : [type];
  const units: Type[] = [];
  for (const part of parts) {
    if (part.isNever()) {
      continue;
    }
    if (part.isEnum()) {
      const members = enumMemberTypes(part);
      if (members === undefined) {
        return undefined;
      }
      units.push(...members);
      continue;
    }
    if (
      !(
        part.isStringLiteral() ||
        part.isNumberLiteral() ||
        part.isBooleanLiteral() ||
        part.isNull() ||
        part.isUndefined() ||
        part.isEnumLiteral()
      )
    ) {
      return undefined;
    }
    units.push(part);
  }
  if (units.length === 0) {
    return undefined;
  }
  return units;
}

function enumMemberTypes(type: Type): Type[] | undefined {
  const symbol = type.getSymbol();
  if (symbol === undefined) {
    return undefined;
  }
  const members: Type[] = [];
  for (const exported of symbol.getExports()) {
    const decl = exported.getDeclarations()[0];
    if (decl === undefined || !Node.isEnumMember(decl)) {
      continue;
    }
    members.push(decl.getType());
  }
  if (members.length === 0) {
    return undefined;
  }
  return members;
}

function sameUnit(left: Type, right: Type): boolean {
  if (left.getText() === right.getText()) {
    return true;
  }
  if (left.isAssignableTo(right) && right.isAssignableTo(left)) {
    return true;
  }
  const leftValue = unitValue(left);
  const rightValue = unitValue(right);
  return leftValue !== undefined && leftValue === rightValue;
}

function unitValue(type: Type): string | undefined {
  if (type.isNull()) {
    return "null";
  }
  if (type.isUndefined()) {
    return "undefined";
  }
  if (type.isBooleanLiteral()) {
    return type.getText();
  }
  if (type.isNumberLiteral()) {
    return `v:${type.getText()}`;
  }
  if (type.isStringLiteral()) {
    return unquote(type.getText());
  }
  return enumMemberValue(type);
}

function unquote(text: string): string {
  if (text.startsWith('"') || text.startsWith("'")) {
    if (text.endsWith('"') || text.endsWith("'")) {
      return text.slice(1, -1);
    }
  }
  return text;
}

function enumMemberValue(type: Type): string | undefined {
  const decl = type.getSymbol()?.getDeclarations()[0];
  if (decl === undefined || !Node.isEnumMember(decl)) {
    return undefined;
  }
  const value = decl.getValue();
  if (typeof value === "number") {
    return `v:${value}`;
  }
  if (typeof value === "string") {
    return value;
  }
  return undefined;
}

function hasExhaustiveDefault(clause: Node): boolean {
  for (const node of clause.getDescendants()) {
    if (nestedInFunction(node, clause)) {
      continue;
    }
    if (Node.isVariableDeclaration(node) && node.getTypeNode()?.getText().trim() === "never") {
      return true;
    }
    if (Node.isReturnStatement(node)) {
      const expr = node.getExpression();
      if (
        expr !== undefined &&
        (expr.getType().isNever() || expr.getType().getText() === "never")
      ) {
        return true;
      }
    }
  }
  return false;
}

function nestedInFunction(node: Node, root: Node): boolean {
  let current = node.getParent();
  while (current !== undefined && current !== root) {
    if (isFunctionLike(current)) {
      return true;
    }
    current = current.getParent();
  }
  return false;
}
