import { join } from "node:path";
import { defineRule, type RuleContext } from "qualety";
import { Node, type ObjectLiteralExpression } from "ts-morph";
import { findSource, lineRange, rangeOf } from "./ast.ts";

const PLUGIN_CATALOGS = [
  { dir: "typescript", catalog: "docs/rulesets/typescript.md" },
  { dir: "react", catalog: "docs/rulesets/react.md" },
  { dir: "dry", catalog: "docs/rulesets/dry.md" },
  { dir: "python", catalog: "docs/rulesets/python.md" },
  { dir: "dev", catalog: "docs/rulesets/dev.md" },
  { dir: "plugin-kit", catalog: "docs/rulesets/plugin-kit.md" },
] as const;

export const docsExportHonesty = defineRule({
  meta: {
    requires: ["typescript", "workspace-docs"],
    docs: {
      description:
        "Public core exports and implemented plugin rule ids must match their documentation inventories.",
    },
  },
  create: (context) => {
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
  const exported = new Map<string, Node>();
  for (const stmt of entry.getStatements()) {
    addExportFromStatement(stmt, exported);
  }
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
    if (pluginFile === undefined) {
      continue;
    }
    const implemented = new Map<string, Node>();
    pluginFile.forEachDescendant((node) => {
      addRulesFromLiteral(node, implemented);
    });
    const documented = tableNames(files.get(item.catalog) ?? "", "Implemented", "ID");
    const catalogPath = join(context.getCwd(), item.catalog);
    for (const [id, node] of implemented) {
      if (!documented.has(id)) {
        context.report({
          severity: "error",
          file: pluginFile.getFilePath(),
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

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: export-form dispatch; splitting recreates single-use helpers
function addExportFromStatement(stmt: Node, names: Map<string, Node>) {
  if (Node.isExportDeclaration(stmt)) {
    if (!stmt.isNamespaceExport()) {
      for (const spec of stmt.getNamedExports()) {
        if (!names.has(spec.getName())) {
          names.set(spec.getName(), spec.getNameNode());
        }
      }
    }
    return;
  }
  if (Node.isExportAssignment(stmt) && !stmt.isExportEquals()) {
    if (!names.has("default")) {
      names.set("default", stmt);
    }
    return;
  }
  if (addNamedExportable(stmt, names)) {
    return;
  }
  if (Node.isVariableStatement(stmt) && stmt.hasExportKeyword()) {
    for (const decl of stmt.getDeclarations()) {
      if (!names.has(decl.getName())) {
        names.set(decl.getName(), decl.getNameNode() ?? decl);
      }
    }
    return;
  }
  if (
    (Node.isTypeAliasDeclaration(stmt) || Node.isInterfaceDeclaration(stmt)) &&
    stmt.hasExportKeyword()
  ) {
    if (!names.has(stmt.getName())) {
      names.set(stmt.getName(), stmt.getNameNode());
    }
  }
}

function addNamedExportable(stmt: Node, names: Map<string, Node>): boolean {
  const named =
    Node.isFunctionDeclaration(stmt) ||
    Node.isClassDeclaration(stmt) ||
    Node.isEnumDeclaration(stmt);
  if (!named) {
    return false;
  }
  if (!stmt.hasExportKeyword()) {
    return true;
  }
  if (stmt.isDefaultExport()) {
    if (!names.has("default")) {
      names.set("default", stmt.getNameNode() ?? stmt);
    }
    return true;
  }
  const nameNode = stmt.getNameNode();
  if (nameNode !== undefined) {
    const name = stmt.getName();
    if (name !== undefined && !names.has(name)) {
      names.set(name, nameNode);
    }
  }
  return true;
}

function addRulesFromLiteral(node: Node, ids: Map<string, Node>) {
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
  addRuleIds(nameInit.getLiteralValue(), rulesInit, ids);
}

function addRuleIds(
  pluginName: string,
  rulesInit: ObjectLiteralExpression,
  ids: Map<string, Node>,
) {
  for (const prop of rulesInit.getProperties()) {
    if (!Node.isPropertyAssignment(prop) && !Node.isShorthandPropertyAssignment(prop)) {
      continue;
    }
    const key = prop.getName().replaceAll(/['"]/g, "");
    if (key.length > 0) {
      ids.set(`${pluginName}/${key}`, prop);
    }
  }
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
