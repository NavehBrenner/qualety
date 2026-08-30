import {
  type ArrowFunction,
  type CallExpression,
  type ElementAccessExpression,
  type FunctionDeclaration,
  type FunctionExpression,
  type MethodDeclaration,
  Node,
  type ObjectBindingPattern,
  type PropertyAccessExpression,
} from "ts-morph";

export type FunctionLike =
  | FunctionDeclaration
  | FunctionExpression
  | ArrowFunction
  | MethodDeclaration;

export const BOUNDARY_NAMES = new Set([
  "validateConfig",
  "readConfigFile",
  "loadConfig",
  "loadPlugin",
]);
export const BOUNDARY_PREFIX = /^(read|load|parse)/i;

export function isFunctionLike(node: Node): node is FunctionLike {
  return (
    Node.isFunctionDeclaration(node) ||
    Node.isFunctionExpression(node) ||
    Node.isArrowFunction(node) ||
    Node.isMethodDeclaration(node)
  );
}

export function functionLikeName(node: FunctionLike): string | undefined {
  if (Node.isFunctionDeclaration(node) || Node.isMethodDeclaration(node)) {
    return node.getName();
  }
  const parent = node.getParent();
  if (Node.isVariableDeclaration(parent)) {
    return parent.getName();
  }
  return undefined;
}

export function unknownParamNames(node: FunctionLike): string[] {
  const names: string[] = [];
  for (const param of node.getParameters()) {
    const typeNode = param.getTypeNode();
    if (typeNode !== undefined && typeNode.getText() === "unknown") {
      const name = param.getName();
      if (!name.startsWith("{") && !name.startsWith("[")) {
        names.push(name);
      }
    }
  }
  return names;
}

const SCHEMA_PARSE_NAMES = new Set(["parse", "safeParse"]);

export function isPropertyParseCall(
  node: Node,
  names: ReadonlySet<string>,
  wantJson: boolean,
): node is CallExpression {
  if (!Node.isCallExpression(node)) {
    return false;
  }
  const expr = node.getExpression();
  if (!Node.isPropertyAccessExpression(expr) || !names.has(expr.getName())) {
    return false;
  }
  const obj = expr.getExpression();
  const isJson = Node.isIdentifier(obj) && obj.getText() === "JSON";
  return wantJson === isJson;
}

export function isSchemaParseCall(node: Node): node is CallExpression {
  return isPropertyParseCall(node, SCHEMA_PARSE_NAMES, false);
}

export function firstArgIdentifier(node: Node): string | undefined {
  if (!Node.isCallExpression(node)) {
    return undefined;
  }
  const arg = node.getArguments()[0];
  return arg !== undefined && Node.isIdentifier(arg) ? arg.getText() : undefined;
}

export function aliasesOf(fn: FunctionLike, root: string): Set<string> {
  const names = new Set([root]);
  let grew = true;
  while (grew) {
    grew = false;
    fn.forEachDescendant((node) => {
      if (!Node.isVariableDeclaration(node)) {
        return;
      }
      const init = node.getInitializer();
      if (init !== undefined && Node.isIdentifier(init) && names.has(init.getText())) {
        if (!names.has(node.getName())) {
          names.add(node.getName());
          grew = true;
        }
      }
    });
  }
  return names;
}

export function isPropertyUse(
  node: Node,
  names: ReadonlySet<string>,
): node is PropertyAccessExpression | ElementAccessExpression | ObjectBindingPattern {
  if (Node.isPropertyAccessExpression(node) || Node.isElementAccessExpression(node)) {
    const expr = node.getExpression();
    return Node.isIdentifier(expr) && names.has(expr.getText());
  }
  if (Node.isObjectBindingPattern(node)) {
    const parent = node.getParent();
    if (Node.isVariableDeclaration(parent)) {
      const init = parent.getInitializer();
      return init !== undefined && Node.isIdentifier(init) && names.has(init.getText());
    }
  }
  return false;
}

export function isTypeofObjectGuard(node: Node, names: ReadonlySet<string>): boolean {
  if (!Node.isBinaryExpression(node)) {
    return false;
  }
  const op = node.getOperatorToken().getText();
  if (op !== "===" && op !== "==" && op !== "!==" && op !== "!=") {
    return false;
  }
  const left = node.getLeft();
  const right = node.getRight();
  const typeofOperand = typeofTarget(left) ?? typeofTarget(right);
  const literal = stringLiteral(left) ?? stringLiteral(right);
  return typeofOperand !== undefined && names.has(typeofOperand) && literal === "object";
}

export function isHandGuardCall(node: Node, names: ReadonlySet<string>): boolean {
  if (!Node.isCallExpression(node)) {
    return false;
  }
  const expr = node.getExpression();
  if (!Node.isIdentifier(expr) || !/^is[A-Z]/.test(expr.getText())) {
    return false;
  }
  const arg = node.getArguments()[0];
  return arg !== undefined && Node.isIdentifier(arg) && names.has(arg.getText());
}

export function typeofTarget(node: Node): string | undefined {
  if (!Node.isTypeOfExpression(node)) {
    return undefined;
  }
  let expr: Node = node.getExpression();
  while (Node.isParenthesizedExpression(expr)) {
    expr = expr.getExpression();
  }
  return Node.isIdentifier(expr) ? expr.getText() : undefined;
}

function stringLiteral(node: Node): string | undefined {
  if (Node.isStringLiteral(node) || Node.isNoSubstitutionTemplateLiteral(node)) {
    return node.getLiteralText();
  }
  return undefined;
}
