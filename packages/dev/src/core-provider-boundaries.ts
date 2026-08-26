import { defineRule, type RuleContext } from "qualety";
import { Node, type SourceFile } from "ts-morph";
import { isSourceFile, posix, rangeOf } from "./ast.ts";

const DUPE_SUGGESTION =
  "Keep dupehound, QUALETY_DUPEHOUND, and its install/path logic in @qualety/dry (provides.dupehound).";
const MORPH_SUGGESTION =
  "Import ts-morph only in the module that exports createTypeScriptProvider (packages/qualety/src/typescript-frontend.ts).";
const SPAWN_CALLEES = new Set(["spawn", "exec", "execFile", "spawnSync", "execSync"]);

export const coreProviderBoundaries = defineRule({
  meta: {
    requires: ["typescript"],
    docs: {
      description:
        "Core must not own dupehound or import ts-morph outside the default TypeScript provider module.",
    },
  },
  create(context) {
    const sources = context.getArtifact("typescript").sources;
    for (const [abs, unit] of sources) {
      if (!posix(abs).includes("/packages/qualety/") || !isSourceFile(unit)) {
        continue;
      }
      scanDupehound(unit, abs, context);
      if (!exportsCreateTypeScriptProvider(unit)) {
        scanTsMorph(unit, abs, context);
      }
    }
  },
});

function scanDupehound(sourceFile: SourceFile, file: string, context: Pick<RuleContext, "report">) {
  for (const decl of sourceFile.getImportDeclarations()) {
    if (decl.getModuleSpecifierValue().includes("dupehound")) {
      reportDupe(context, file, decl.getModuleSpecifier());
    }
  }
  sourceFile.forEachDescendant((node) => {
    if (reportDupehoundCall(node, file, context)) {
      return;
    }
    reportDupehoundText(node, file, context);
  });
}

function reportDupehoundCall(
  node: Node,
  file: string,
  context: Pick<RuleContext, "report">,
): boolean {
  if (!Node.isCallExpression(node)) {
    return false;
  }
  const expr = node.getExpression();
  if (Node.isIdentifier(expr)) {
    if (expr.getText() === "require" && stringArg(node, 0)?.includes("dupehound") === true) {
      reportDupe(context, file, node);
      return true;
    }
  }
  const spawnLike =
    (Node.isIdentifier(expr) && SPAWN_CALLEES.has(expr.getText())) ||
    (Node.isPropertyAccessExpression(expr) && SPAWN_CALLEES.has(expr.getName()));
  if (spawnLike && callMentionsDupehound(node)) {
    reportDupe(context, file, node);
    return true;
  }
  return false;
}

function reportDupehoundText(node: Node, file: string, context: Pick<RuleContext, "report">) {
  if (Node.isIdentifier(node) && node.getText() === "QUALETY_DUPEHOUND") {
    reportDupe(context, file, node);
    return;
  }
  if (!isStringy(node)) {
    return;
  }
  const text = node.getLiteralText();
  if (text.includes("QUALETY_DUPEHOUND") || text.includes("dupehound")) {
    reportDupe(context, file, node);
  }
}

function scanTsMorph(sourceFile: SourceFile, file: string, context: Pick<RuleContext, "report">) {
  for (const decl of sourceFile.getImportDeclarations()) {
    if (isTsMorphSpecifier(decl.getModuleSpecifierValue())) {
      context.report({
        severity: "error",
        file,
        range: rangeOf(decl.getModuleSpecifier()),
        message:
          "Core must not import ts-morph outside the default TypeScript provider module that exports createTypeScriptProvider.",
        suggestion: MORPH_SUGGESTION,
      });
    }
  }
  sourceFile.forEachDescendant((node) => {
    if (!Node.isCallExpression(node)) {
      return;
    }
    const callee = node.getExpression();
    if (!Node.isIdentifier(callee) || callee.getText() !== "require") {
      return;
    }
    const spec = stringArg(node, 0);
    if (spec !== undefined && isTsMorphSpecifier(spec)) {
      context.report({
        severity: "error",
        file,
        range: rangeOf(node),
        message:
          "Core must not import ts-morph outside the default TypeScript provider module that exports createTypeScriptProvider.",
        suggestion: MORPH_SUGGESTION,
      });
    }
  });
}

function reportDupe(context: Pick<RuleContext, "report">, file: string, node: Node) {
  context.report({
    severity: "error",
    file,
    range: rangeOf(node),
    message: "Core must not import, spawn, or own dupehound. That provider lives in @qualety/dry.",
    suggestion: DUPE_SUGGESTION,
  });
}

function exportsCreateTypeScriptProvider(sourceFile: SourceFile): boolean {
  for (const [name, decls] of sourceFile.getExportedDeclarations()) {
    if (name === "createTypeScriptProvider" && decls.length > 0) {
      return true;
    }
  }
  return false;
}

function isTsMorphSpecifier(specifier: string): boolean {
  return specifier === "ts-morph" || specifier.startsWith("ts-morph/");
}

function callMentionsDupehound(node: Node): boolean {
  if (!Node.isCallExpression(node)) {
    return false;
  }
  return node.getArguments().some((arg) => {
    if (isStringy(arg)) {
      return arg.getLiteralText().includes("dupehound");
    }
    if (Node.isArrayLiteralExpression(arg)) {
      return arg
        .getElements()
        .some((el) => isStringy(el) && el.getLiteralText().includes("dupehound"));
    }
    return false;
  });
}

function stringArg(node: Node, index: number): string | undefined {
  if (!Node.isCallExpression(node)) {
    return undefined;
  }
  const arg = node.getArguments()[index];
  return arg !== undefined && isStringy(arg) ? arg.getLiteralText() : undefined;
}

function isStringy(node: Node): node is Node & { getLiteralText(): string } {
  return Node.isStringLiteral(node) || Node.isNoSubstitutionTemplateLiteral(node);
}
