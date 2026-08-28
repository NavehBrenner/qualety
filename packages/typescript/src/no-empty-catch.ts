import { defineRule } from "qualety";
import { SyntaxKind } from "ts-morph";
import { reportAt, walkTsSources } from "./ts-source.ts";

const HINT = "Handle the error, rethrow, or throw.";

export const noEmptyCatch = defineRule({
  meta: {
    requires: ["typescript"],
    docs: {
      description: "Do not use a catch clause whose body is empty or only comments.",
    },
  },
  create(context) {
    const sources = context.getArtifact("typescript").sources;
    walkTsSources(sources, (unit, file) => {
      for (const node of unit.getDescendantsOfKind(SyntaxKind.CatchClause)) {
        if (node.getBlock().getStatements().length === 0) {
          reportAt(context, file, node, "Empty catch swallows errors.", HINT);
        }
      }
    });
  },
});
