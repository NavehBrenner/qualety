import type { RuleContext } from "qualety";
import { type Node, SourceFile } from "ts-morph";

export function walkTsSources(
  sources: ReadonlyMap<string, unknown>,
  visit: (sourceFile: SourceFile, file: string) => void,
): void {
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

export function walkTsArtifact(
  context: Pick<RuleContext, "getArtifact">,
  visit: (sourceFile: SourceFile, file: string) => void,
): void {
  walkTsSources(context.getArtifact("typescript").sources, visit);
}

export function reportAt(
  context: Pick<RuleContext, "report">,
  file: string,
  node: Node,
  message: string,
  suggestion: string,
): void {
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
