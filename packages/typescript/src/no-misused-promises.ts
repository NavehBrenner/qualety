import { defineRule, type RuleContext } from "qualety";
import { Node, type SourceFile, SyntaxKind, type Type } from "ts-morph";
import { unwrapParens } from "./narrowing.ts";
import { declReturnsPromise, typeIsPromise } from "./no-floating-promises.ts";
import { reportAt, walkTsSources } from "./ts-source.ts";

const HINT =
  "Do not pass async here; void the work, hoist to an outer async, or .catch the Promise.";

export const noMisusedPromises = defineRule({
  meta: {
    requires: ["typescript"],
    docs: {
      description:
        "Do not pass a Promise-returning function where a sync void callback is expected.",
    },
  },
  create(context) {
    const artifact = context.getArtifact("typescript");
    walkTsSources(artifact.sources, (unit, file) => {
      for (const call of unit.getDescendantsOfKind(SyntaxKind.CallExpression)) {
        if (Node.isCallExpression(call)) {
          break;
        }
      }
      scanMisused(unit, file, context);
    });
  },
});

function scanMisused(unit: SourceFile, file: string, context: Pick<RuleContext, "report">) {
  const seen = new Set<number>();
  const report = (node: Node) => {
    const start = node.getStart();
    if (seen.has(start)) {
      return;
    }
    seen.add(start);
    reportAt(
      context,
      file,
      node,
      "Promise-returning function passed where a sync void callback is expected.",
      HINT,
    );
  };
  for (const node of unit.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    if (Node.isCallExpression(node)) {
      considerCall(node, report);
    }
  }
  for (const node of unit.getDescendantsOfKind(SyntaxKind.BinaryExpression)) {
    considerAssign(node, report);
  }
  for (const node of unit.getDescendantsOfKind(SyntaxKind.VariableDeclaration)) {
    considerVar(node, report);
  }
}

function considerCall(call: Node, report: (node: Node) => void) {
  if (!Node.isCallExpression(call)) {
    return;
  }
  const forEach = isForEachCall(call);
  const slots = forEach ? undefined : voidCallbackSlots(call);
  for (const [index, arg] of call.getArguments().entries()) {
    if (Node.isSpreadElement(arg)) {
      continue;
    }
    const inner = unwrapParens(arg);
    if (!nodeReturnsPromise(inner)) {
      continue;
    }
    if (forEach || slots?.[index] === true) {
      report(inner);
    }
  }
}

function considerAssign(node: Node, report: (node: Node) => void) {
  if (Node.isBinaryExpression(node)) {
    if (node.getOperatorToken().getText() === "=") {
      const right = unwrapParens(node.getRight());
      if (isSyncVoidFunctionType(node.getLeft().getType()) && nodeReturnsPromise(right)) {
        report(right);
      }
    }
  }
}

function considerVar(node: Node, report: (node: Node) => void) {
  if (!Node.isVariableDeclaration(node) || node.getTypeNode() === undefined) {
    return;
  }
  const init = node.getInitializer();
  if (init === undefined) {
    return;
  }
  const inner = unwrapParens(init);
  if (isSyncVoidFunctionType(node.getType()) && nodeReturnsPromise(inner)) {
    report(inner);
  }
}

function isForEachCall(call: Node): boolean {
  if (Node.isCallExpression(call)) {
    const callee = unwrapParens(call.getExpression());
    if (Node.isPropertyAccessExpression(callee)) {
      return callee.getName() === "forEach";
    }
  }
  return false;
}

function voidCallbackSlots(call: Node): boolean[] | undefined {
  if (!Node.isCallExpression(call)) {
    return undefined;
  }
  const calleeType = unwrapParens(call.getExpression()).getType();
  if (!typeIsUsable(calleeType)) {
    return undefined;
  }
  const signatures = calleeType.getCallSignatures();
  const signature = signatures.length === 1 ? signatures[0] : undefined;
  if (signature === undefined) {
    return undefined;
  }
  const params = signature.getParameters();
  return call.getArguments().map((arg, index) => {
    const param = params[index];
    if (param === undefined || Node.isSpreadElement(arg)) {
      return false;
    }
    return isSyncVoidFunctionType(param.getTypeAtLocation(arg));
  });
}

function isSyncVoidFunctionType(type: Type): boolean {
  if (!typeIsUsable(type)) {
    return false;
  }
  const signatures = type.getCallSignatures();
  const signature = signatures.length === 1 ? signatures[0] : undefined;
  if (signature === undefined) {
    return false;
  }
  const ret = signature.getReturnType();
  return isVoidish(ret) && !includesPromise(ret);
}

function nodeReturnsPromise(node: Node): boolean {
  if (declReturnsPromise(node) || typeReturnsPromise(node)) {
    return true;
  }
  if (!Node.isIdentifier(node)) {
    return false;
  }
  const symbol = node.getSymbol();
  const resolved = symbol?.getAliasedSymbol() ?? symbol;
  for (const decl of resolved?.getDeclarations() ?? []) {
    if (declReturnsPromise(decl)) {
      return true;
    }
  }
  return false;
}

function typeReturnsPromise(node: Node): boolean {
  const signatures = node.getType().getCallSignatures();
  if (signatures.length === 1) {
    const returned = signatures[0]?.getReturnType();
    if (returned !== undefined) {
      return typeIsPromise(returned);
    }
  }
  return false;
}

function typeIsUsable(type: Type): boolean {
  return !type.isAny() && !type.isUnknown() && type.getText() !== "error";
}

function isVoidish(type: Type): boolean {
  const text = type.getText();
  if (text === "void" || text === "undefined") {
    return true;
  }
  if (!type.isUnion()) {
    return false;
  }
  const parts = type.getUnionTypes();
  return (
    parts.length > 0 &&
    parts.every((part) => {
      const partText = part.getText();
      return partText === "void" || partText === "undefined";
    })
  );
}

function includesPromise(type: Type): boolean {
  if (typeIsPromise(type)) {
    return true;
  }
  if (type.isUnion()) {
    if (type.getUnionTypes().some(typeIsPromise)) {
      return true;
    }
  }
  return false;
}
