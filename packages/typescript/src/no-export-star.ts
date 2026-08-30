import { defineRule } from "qualety";
import type { ExportDeclaration } from "ts-morph";
import { reportAt, walkTsSources } from "./ts-source.ts";

const HINT = 'Replace with explicit named re-exports (export { A, B } from "…").';

export const noExportStar = defineRule({
  meta: {
    requires: ["typescript"],
    docs: {
      description: "Do not use export * or export * as ns; name the public surface.",
    },
  },
  create(context) {
    const artifact = context.getArtifact("typescript");
    walkTsSources(artifact.sources, (unit, file) => {
      for (const node of unit.getExportDeclarations()) {
        if (starExport(node)) {
          reportAt(context, file, node, "Star export hides the public surface.", HINT);
        }
      }
    });
  },
});

function starExport(node: ExportDeclaration): boolean {
  if (node.getModuleSpecifier() !== undefined) {
    if (node.isNamespaceExport() || node.getNamespaceExport() !== undefined) {
      return true;
    }
  }
  return false;
}
