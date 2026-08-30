import { defineRule, type RuleContext } from "qualety";
import { Node, SyntaxKind, type Type } from "ts-morph";
import { unwrapParens } from "./narrowing.ts";
import { isFunctionLike } from "./parse-flow.ts";
import { reportAt, walkTsSources } from "./ts-source.ts";

const HINT = "await, return, void, or .catch(...) the Promise.";

export const noFloatingPromises = defineRule({
  meta: {
    requires: ["typescript"],
    docs: {
      description:
        "Do not leave a Promise as an expression statement without await, return, void, or a rejection handler.",
    },
  },
  create(context) {
    const sources = context.getArtifact("typescript").sources;
    walkTsSources(sources, (unit, file) => {
      for (const stmt of unit.getDescendantsOfKind(SyntaxKind.ExpressionStatement)) {
        if (Node.isExpressionStatement(stmt)) {
          considerStatement(stmt, file, context);
        }
      }
    });
  },
});

function considerStatement(stmt: Node, file: string, context: Pick<RuleContext, "report">) {
  if (!Node.isExpressionStatement(stmt)) {
    return;
  }
  const expr = unwrapParens(stmt.getExpression());
  if (Node.isVoidExpression(expr) || Node.isAwaitExpression(expr)) {
    return;
  }
  const peeled = peelPromiseChain(expr);
  if (handlesRejection(expr) || !(checkerSaysPromise(expr) || calleeLooksAsync(peeled))) {
    return;
  }
  reportAt(
    context,
    file,
    expr,
    "Promise is not awaited, returned, voided, or given a rejection handler.",
    HINT,
  );
}

function handlesRejection(expr: Node): boolean {
  let current = unwrapParens(expr);
  while (Node.isCallExpression(current)) {
    const callee = unwrapParens(current.getExpression());
    if (!Node.isPropertyAccessExpression(callee)) {
      break;
    }
    const name = callee.getName();
    if (name === "catch" || (name === "then" && current.getArguments().length >= 2)) {
      return true;
    }
    current = unwrapParens(callee.getExpression());
  }
  return false;
}

export function checkerSaysPromise(expr: Node): boolean {
  const type = expr.getType();
  if (!type.isAny()) {
    if (typeIsPromise(type)) {
      return true;
    }
  }
  return false;
}

export function typeIsPromise(type: Type): boolean {
  if (type.isAny() || type.isUnknown() || type.isUnion() || type.isIntersection()) {
    return false;
  }
  if (type.getText() === "error") {
    return false;
  }
  const name = type.getAliasSymbol()?.getName() ?? type.getSymbol()?.getName();
  return name === "Promise" || /^Promise</.test(type.getText());
}

function peelPromiseChain(expr: Node): Node {
  let current = unwrapParens(expr);
  while (Node.isCallExpression(current)) {
    const callee = unwrapParens(current.getExpression());
    if (!Node.isPropertyAccessExpression(callee)) {
      break;
    }
    const name = callee.getName();
    if (name !== "then" && name !== "catch" && name !== "finally") {
      break;
    }
    current = unwrapParens(callee.getExpression());
  }
  return current;
}

export function calleeLooksAsync(expr: Node): boolean {
  if (Node.isNewExpression(expr)) {
    const ctor = unwrapParens(expr.getExpression());
    return Node.isIdentifier(ctor) && ctor.getText() === "Promise";
  }
  if (!Node.isCallExpression(expr)) {
    return false;
  }
  const symbol = unwrapParens(expr.getExpression()).getSymbol();
  const resolved = symbol?.getAliasedSymbol() ?? symbol;
  for (const decl of resolved?.getDeclarations() ?? []) {
    if (declReturnsPromise(decl)) {
      return true;
    }
  }
  return false;
}

export function declReturnsPromise(decl: Node): boolean {
  if (declIsAsync(decl)) {
    return true;
  }
  if (!isFunctionLike(decl)) {
    return false;
  }
  const typeNode = decl.getReturnTypeNode();
  return typeNode !== undefined && /^Promise\b/.test(typeNode.getText().trim());
}

export function declIsAsync(decl: Node): boolean {
  if (isFunctionLike(decl)) {
    return decl.isAsync();
  }
  if (!Node.isVariableDeclaration(decl)) {
    return false;
  }
  const init = decl.getInitializer();
  if (init === undefined) {
    return false;
  }
  const inner = unwrapParens(init);
  return isFunctionLike(inner) && inner.isAsync();
}
