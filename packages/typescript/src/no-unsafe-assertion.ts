import { defineRule } from "qualety";
import { Node, SyntaxKind } from "ts-morph";
import { unwrapParens } from "./narrowing.ts";
import { reportAt, walkTsSources } from "./ts-source.ts";

const HINT = "Narrow with a type guard, schema parse, or fix the upstream type.";

export const noUnsafeAssertion = defineRule({
  meta: {
    requires: ["typescript"],
    docs: {
      description:
        "Do not use as any, as unknown as T, or <any>x assertions that erase type safety.",
    },
  },
  create(context) {
    const sources = context.getArtifact("typescript").sources;
    walkTsSources(sources, (unit, file) => {
      for (const node of unit.getDescendantsOfKind(SyntaxKind.AsExpression)) {
        if (isUnsafeAssertion(node)) {
          reportAt(context, file, node, "Unsafe type assertion erases type safety.", HINT);
        }
      }
      for (const node of unit.getDescendantsOfKind(SyntaxKind.TypeAssertionExpression)) {
        if (node.getTypeNode()?.getKind() === SyntaxKind.AnyKeyword) {
          reportAt(context, file, node, "Unsafe type assertion erases type safety.", HINT);
        }
      }
    });
  },
});

function isUnsafeAssertion(node: Node): boolean {
  if (!Node.isAsExpression(node)) {
    return false;
  }
  const typeNode = node.getTypeNode();
  if (typeNode === undefined) {
    return false;
  }
  if (typeNode.getKind() === SyntaxKind.AnyKeyword) {
    return true;
  }
  const inner = unwrapParens(node.getExpression());
  return Node.isAsExpression(inner) && inner.getTypeNode()?.getKind() === SyntaxKind.UnknownKeyword;
}
