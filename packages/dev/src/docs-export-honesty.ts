import { join } from "node:path";
import { defineRule, type RuleContext } from "qualety";
import { Node, type SourceFile } from "ts-morph";
import { findSource, lineRange, rangeOf } from "./ast.ts";

const PLUGIN_CATALOGS = [
  { dir: "typescript", catalog: "docs/rulesets/typescript.md" },
  { dir: "react", catalog: "docs/rulesets/react.md" },
  { dir: "dry", catalog: "docs/rulesets/dry.md" },
  { dir: "dev", catalog: "docs/rulesets/dev.md" },
] as const;

export const docsExportHonesty = defineRule({
  meta: {
    requires: ["typescript", "workspace-docs"],
    docs: {
      description:
        "Public core exports and implemented plugin rule ids must match their documentation inventories.",
    },
  },
  create(context) {
    const sources = context.getArtifact("typescript").sources;
    const docs = context.getArtifact("workspace-docs");
    checkCoreApi(context, sources, docs.files);
    checkCatalogs(context, sources, docs.files);
  },
});

function checkCoreApi(
  context: RuleContext,
  sources: ReadonlyMap<string, unknown>,
  files: ReadonlyMap<string, string>,
) {
  const entry = findSource(sources, "/packages/qualety/src/index.ts");
  if (entry === undefined) {
    return;
  }
  const exported = collectExportNames(entry);
  const documented = tableNames(files.get("docs/api.md") ?? "", "Exports", "Export");
  const apiPath = join(context.getCwd(), "docs/api.md");
  for (const [name, node] of exported) {
    if (!documented.has(name)) {
      context.report({
        severity: "error",
        file: entry.getFilePath(),
        range: rangeOf(node),
        message: `Public export "${name}" is missing from docs/api.md.`,
        suggestion: `Add a \`${name}\` row to the ## Exports table in docs/api.md.`,
      });
    }
  }
  for (const [name, loc] of documented) {
    if (!exported.has(name)) {
      context.report({
        severity: "error",
        file: apiPath,
        range: lineRange(loc.line),
        message: `docs/api.md lists "${name}" but it is not exported from the qualety public entry.`,
        suggestion: `Remove \`${name}\` from docs/api.md or export it from packages/qualety/src/index.ts.`,
      });
    }
  }
}

function checkCatalogs(
  context: RuleContext,
  sources: ReadonlyMap<string, unknown>,
  files: ReadonlyMap<string, string>,
) {
  for (const item of PLUGIN_CATALOGS) {
    const pluginFile = findSource(sources, `/packages/${item.dir}/src/index.ts`);
    const implemented =
      pluginFile !== undefined ? readPluginRules(pluginFile) : new Map<string, Node>();
    const documented = tableNames(files.get(item.catalog) ?? "", "Implemented", "ID");
    const catalogPath = join(context.getCwd(), item.catalog);
    for (const [id, node] of implemented) {
      if (!documented.has(id)) {
        context.report({
          severity: "error",
          file: pluginFile?.getFilePath() ?? catalogPath,
          range: rangeOf(node),
          message: `Rule "${id}" is implemented but missing from ${item.catalog} Implemented table.`,
          suggestion: `Add a \`${id}\` row to the ## Implemented table in ${item.catalog}.`,
        });
      }
    }
    for (const [id, loc] of documented) {
      if (!implemented.has(id)) {
        context.report({
          severity: "error",
          file: catalogPath,
          range: lineRange(loc.line),
          message: `${item.catalog} lists "${id}" but no plugin module defines that rule.`,
          suggestion: `Remove \`${id}\` from ${item.catalog} or add it to packages/${item.dir}/src/index.ts rules.`,
        });
      }
    }
  }
}

function collectExportNames(sourceFile: SourceFile): Map<string, Node> {
  const names = new Map<string, Node>();
  const push = (name: string, node: Node) => {
    if (!names.has(name)) {
      names.set(name, node);
    }
  };
  for (const stmt of sourceFile.getStatements()) {
    if (Node.isExportDeclaration(stmt)) {
      if (stmt.isNamespaceExport()) {
        continue;
      }
      for (const spec of stmt.getNamedExports()) {
        push(spec.getName(), spec.getNameNode());
      }
      continue;
    }
    if (Node.isExportAssignment(stmt) && !stmt.isExportEquals()) {
      push("default", stmt);
      continue;
    }
    if (
      Node.isFunctionDeclaration(stmt) ||
      Node.isClassDeclaration(stmt) ||
      Node.isEnumDeclaration(stmt)
    ) {
      if (!stmt.hasExportKeyword()) {
        continue;
      }
      if (stmt.isDefaultExport()) {
        push("default", stmt.getNameNode() ?? stmt);
        continue;
      }
      const name = stmt.getName();
      const nameNode = stmt.getNameNode();
      if (name !== undefined && nameNode !== undefined) {
        push(name, nameNode);
      }
      continue;
    }
    if (Node.isVariableStatement(stmt) && stmt.hasExportKeyword()) {
      for (const decl of stmt.getDeclarations()) {
        push(decl.getName(), decl.getNameNode() ?? decl);
      }
      continue;
    }
    if (
      (Node.isTypeAliasDeclaration(stmt) || Node.isInterfaceDeclaration(stmt)) &&
      stmt.hasExportKeyword()
    ) {
      push(stmt.getName(), stmt.getNameNode());
    }
  }
  return names;
}

function readPluginRules(sourceFile: SourceFile): Map<string, Node> {
  const ids = new Map<string, Node>();
  sourceFile.forEachDescendant((node) => {
    if (!Node.isObjectLiteralExpression(node)) {
      return;
    }
    const nameProp = node.getProperty("name");
    const rulesProp = node.getProperty("rules");
    if (!Node.isPropertyAssignment(nameProp) || !Node.isPropertyAssignment(rulesProp)) {
      return;
    }
    const nameInit = nameProp.getInitializer();
    const rulesInit = rulesProp.getInitializer();
    if (!Node.isStringLiteral(nameInit) || !Node.isObjectLiteralExpression(rulesInit)) {
      return;
    }
    const pluginName = nameInit.getLiteralValue();
    for (const prop of rulesInit.getProperties()) {
      if (!Node.isPropertyAssignment(prop) && !Node.isShorthandPropertyAssignment(prop)) {
        continue;
      }
      const key = prop.getName().replaceAll(/['"]/g, "");
      if (key.length > 0) {
        ids.set(`${pluginName}/${key}`, prop);
      }
    }
  });
  return ids;
}

function tableNames(
  markdown: string,
  heading: string,
  headerCell: string,
): Map<string, { line: number }> {
  const names = new Map<string, { line: number }>();
  if (markdown.length === 0) {
    return names;
  }
  const lines = markdown.split(/\r?\n/);
  let inSection = false;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    if (line.startsWith("## ")) {
      inSection = line.slice(3).trim() === heading;
      continue;
    }
    if (!inSection) {
      continue;
    }
    const match = /^\|\s*`([^`]+)`\s*\|/.exec(line);
    const name = match?.[1];
    if (name === undefined || name === headerCell) {
      continue;
    }
    names.set(name, { line: index + 1 });
  }
  return names;
}
