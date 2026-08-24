import { defineRule, NO_SUGGESTION, type RuleContext } from "qualety";
import { Node, type SourceFile } from "ts-morph";
import { importNameMap, isProductPluginPath, isSourceFile, isTestPath, rangeOf } from "./ast.ts";

const SUGGESTION = "Pass a concrete suggestion that tells another agent how to fix the violation.";

export const concreteSuggestion = defineRule({
  meta: {
    requires: ["typescript"],
    docs: {
      description: "In-repo product rules must not report the NO_SUGGESTION sentinel.",
    },
  },
  create(context) {
    const sources = context.getArtifact("typescript").sources;
    for (const [abs, unit] of sources) {
      if (!isProductPluginPath(abs) || isTestPath(abs) || !isSourceFile(unit)) {
        continue;
      }
      scanReports(unit, abs, context);
    }
  },
});

function scanReports(sourceFile: SourceFile, file: string, context: Pick<RuleContext, "report">) {
  const sentinels = sentinelNames(sourceFile);
  sourceFile.forEachDescendant((node) => {
    if (!Node.isCallExpression(node) || !isReportCall(node)) {
      return;
    }
    const arg = node.getArguments()[0];
    if (arg === undefined || !Node.isObjectLiteralExpression(arg)) {
      return;
    }
    const prop = arg.getProperty("suggestion");
    if (!Node.isPropertyAssignment(prop)) {
      return;
    }
    const init = prop.getInitializer();
    if (init === undefined || !isSentinelValue(init, sentinels)) {
      return;
    }
    context.report({
      severity: "error",
      file,
      range: rangeOf(init),
      message: "Product rules must not report the NO_SUGGESTION sentinel.",
      suggestion: SUGGESTION,
    });
  });
}

function sentinelNames(sourceFile: SourceFile): Set<string> {
  const names = new Set<string>();
  const importMap = importNameMap(sourceFile);
  for (const [local, specifier] of importMap) {
    if (specifier === "qualety" || specifier.endsWith("/index.ts")) {
      if (local === "NO_SUGGESTION") {
        names.add(local);
      }
    }
  }
  for (const decl of sourceFile.getImportDeclarations()) {
    if (
      decl.getModuleSpecifierValue() !== "qualety" &&
      !decl.getModuleSpecifierValue().endsWith("/index.ts")
    ) {
      continue;
    }
    for (const named of decl.getNamedImports()) {
      if (named.getName() === "NO_SUGGESTION") {
        names.add(named.getAliasNode()?.getText() ?? named.getName());
      }
    }
  }
  return names;
}

function isReportCall(node: Node): boolean {
  if (!Node.isCallExpression(node)) {
    return false;
  }
  const expr = node.getExpression();
  if (Node.isIdentifier(expr)) {
    return expr.getText() === "report";
  }
  return Node.isPropertyAccessExpression(expr) && expr.getName() === "report";
}

function isSentinelValue(node: Node, sentinels: ReadonlySet<string>): boolean {
  if (Node.isStringLiteral(node) || Node.isNoSubstitutionTemplateLiteral(node)) {
    return node.getLiteralText() === NO_SUGGESTION;
  }
  if (Node.isIdentifier(node)) {
    return sentinels.has(node.getText());
  }
  if (Node.isPropertyAccessExpression(node)) {
    return node.getName() === "NO_SUGGESTION";
  }
  return false;
}
