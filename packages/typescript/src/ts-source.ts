import type { RuleContext } from "qualety";
import { type Node, SourceFile } from "ts-morph";

export function walkTsSources(
  sources: ReadonlyMap<string, unknown>,
  visit: (sourceFile: SourceFile, file: string) => void,
) {
  for (const [abs, unit] of sources) {
    const path = abs.split("\\").join("/");
    const base = path.slice(path.lastIndexOf("/") + 1);
    if (
      !(unit instanceof SourceFile) ||
      /\.d\.(?:ts|mts|cts)$/.test(base) ||
      /\.(?:test|spec)\./.test(base) ||
      path.split("/").includes("__tests__")
    ) {
      continue;
    }
    visit(unit, abs);
  }
}

export function reportAt(
  context: Pick<RuleContext, "report">,
  file: string,
  node: Node,
  message: string,
  suggestion: string,
) {
  const sourceFile = node.getSourceFile();
  context.report({
    severity: "error",
    file,
    range: {
      start: sourceFile.getLineAndColumnAtPos(node.getStart()),
      end: sourceFile.getLineAndColumnAtPos(node.getEnd()),
    },
    message,
    suggestion,
  });
}
