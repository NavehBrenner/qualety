import { defineRule } from "qualety";
import { SyntaxKind } from "ts-morph";
import { reportAt, walkTsSources } from "./ts-source.ts";

const MSG = "Non-null assertion hides an undefined or null possibility.";
const HINT = "Narrow with a type guard, provide a default, or throw.";

export const noNonNullAssertion = defineRule({
  meta: {
    requires: ["typescript"],
    docs: {
      description: "Do not use a non-null assertion on an expression.",
    },
  },
  create(context) {
    const artifact = context.getArtifact("typescript");
    walkTsSources(artifact.sources, (unit, file) => {
      for (const node of unit.getDescendantsOfKind(SyntaxKind.NonNullExpression)) {
        if (node.getKind() === SyntaxKind.NonNullExpression) {
          reportAt(context, file, node, MSG, HINT);
        }
      }
    });
  },
});
