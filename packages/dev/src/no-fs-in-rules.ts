import { defineRule, type RuleContext } from "qualety";
import { Node, type SourceFile } from "ts-morph";
import {
  findSource,
  isProductPluginPath,
  isSourceFile,
  isTestPath,
  PRODUCT_PLUGIN_DIRS,
  rangeOf,
  resolveRelativeSpecifier,
  specifierIsFs,
  walkReachable,
} from "./ast.ts";

const SUGGESTION =
  "Move this filesystem access into a plugin provides.*.build function (see @qualety/dry dupehound).";

export const noFsInRules = defineRule({
  meta: {
    requires: ["typescript"],
    docs: {
      description:
        "In-repo product rule modules must not import node:fs; artifact provider build may.",
    },
  },
  create(context) {
    const sources = context.getArtifact("typescript").sources;
    const { ruleFiles, providerFiles } = collectGraphs(sources);
    const exempt = walkReachable(providerFiles, sources);
    const scanned = walkReachable(ruleFiles, sources);
    for (const file of scanned) {
      if (exempt.has(file) || isTestPath(file) || !isProductPluginPath(file)) {
        continue;
      }
      const unit = sources.get(file);
      if (isSourceFile(unit)) {
        scanFsImports(unit, file, context);
      }
    }
  },
});

function collectGraphs(sources: ReadonlyMap<string, unknown>): {
  ruleFiles: Set<string>;
  providerFiles: Set<string>;
} {
  const ruleFiles = new Set<string>();
  const providerFiles = new Set<string>();
  for (const dir of PRODUCT_PLUGIN_DIRS) {
    const index = findSource(sources, `/packages/${dir}/src/index.ts`);
    if (index === undefined) {
      continue;
    }
    const indexPath = index.getFilePath();
    ruleFiles.add(indexPath);
    ingestIndex(index, sources, ruleFiles, providerFiles);
  }
  return { ruleFiles, providerFiles };
}

function ingestIndex(
  index: SourceFile,
  sources: ReadonlyMap<string, unknown>,
  ruleFiles: Set<string>,
  providerFiles: Set<string>,
) {
  const localImports = localNameTargets(index, sources);
  for (const node of index.getDescendants()) {
    if (!Node.isPropertyAssignment(node)) {
      continue;
    }
    const name = node.getName();
    const init = node.getInitializer();
    if (name === "rules" && init !== undefined && Node.isObjectLiteralExpression(init)) {
      collectIdentifierTargets(init, localImports, ruleFiles);
    }
    if (name === "provides" && init !== undefined && Node.isObjectLiteralExpression(init)) {
      collectIdentifierTargets(init, localImports, providerFiles);
    }
  }
}

function localNameTargets(
  sourceFile: SourceFile,
  sources: ReadonlyMap<string, unknown>,
): Map<string, string> {
  const importMap = new Map<string, string>();
  for (const decl of sourceFile.getImportDeclarations()) {
    const target = resolveRelativeSpecifier(
      sourceFile.getFilePath(),
      decl.getModuleSpecifierValue(),
      sources,
    );
    if (target === undefined) {
      continue;
    }
    const def = decl.getDefaultImport();
    if (def !== undefined) {
      importMap.set(def.getText(), target);
    }
    const namespaceImport = decl.getNamespaceImport();
    if (namespaceImport !== undefined) {
      importMap.set(namespaceImport.getText(), target);
    }
    for (const named of decl.getNamedImports()) {
      importMap.set(named.getAliasNode()?.getText() ?? named.getName(), target);
    }
  }
  return importMap;
}

function collectIdentifierTargets(
  node: Node,
  importMap: ReadonlyMap<string, string>,
  into: Set<string>,
) {
  node.forEachDescendant((child) => {
    if (Node.isIdentifier(child)) {
      const target = importMap.get(child.getText());
      if (target !== undefined) {
        into.add(target);
      }
    }
  });
}

function scanFsImports(sourceFile: SourceFile, file: string, context: Pick<RuleContext, "report">) {
  for (const decl of sourceFile.getImportDeclarations()) {
    if (specifierIsFs(decl.getModuleSpecifierValue())) {
      context.report({
        severity: "error",
        file,
        range: rangeOf(decl.getModuleSpecifier()),
        message: `Rule module must not import "${decl.getModuleSpecifierValue()}". Use an artifact provider build for filesystem access.`,
        suggestion: SUGGESTION,
      });
    }
  }
  sourceFile.forEachDescendant((node) => {
    if (!Node.isCallExpression(node)) {
      return;
    }
    const expr = node.getExpression();
    if (!Node.isIdentifier(expr) || expr.getText() !== "require") {
      return;
    }
    const arg = node.getArguments()[0];
    if (arg === undefined || !Node.isStringLiteral(arg) || !specifierIsFs(arg.getLiteralValue())) {
      return;
    }
    context.report({
      severity: "error",
      file,
      range: rangeOf(node),
      message: `Rule module must not import "${arg.getLiteralValue()}". Use an artifact provider build for filesystem access.`,
      suggestion: SUGGESTION,
    });
  });
}
