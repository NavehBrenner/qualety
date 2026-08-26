import { dirname, extname, join, resolve } from "node:path";
import { Node, type ObjectLiteralExpression, SourceFile } from "ts-morph";

const TS_EXTS = [".ts", ".tsx", ".mts", ".cts"] as const;
const SWAP_EXTS = new Set([".js", ".jsx", ".mjs", ".cjs", ...TS_EXTS]);

export function objectInit(literal: ObjectLiteralExpression, name: string): Node | undefined {
  const prop = literal.getProperty(name);
  if (!Node.isPropertyAssignment(prop)) {
    return undefined;
  }
  return prop.getInitializer();
}

export function isPluginLiteral(node: Node): node is ObjectLiteralExpression {
  if (!Node.isObjectLiteralExpression(node)) {
    return false;
  }
  const nameInit = objectInit(node, "name");
  if (
    nameInit === undefined ||
    !(
      Node.isStringLiteral(nameInit) ||
      Node.isNoSubstitutionTemplateLiteral(nameInit) ||
      Node.isIdentifier(nameInit)
    )
  ) {
    return false;
  }
  const rules = objectInit(node, "rules");
  const provides = objectInit(node, "provides");
  return Node.isObjectLiteralExpression(rules) || Node.isObjectLiteralExpression(provides);
}

export function pluginLiterals(sourceFile: SourceFile): ObjectLiteralExpression[] {
  const found: ObjectLiteralExpression[] = [];
  sourceFile.forEachDescendant((node) => {
    if (isPluginLiteral(node)) {
      found.push(node);
    }
  });
  return found;
}

export function unwrapRule(node: Node): ObjectLiteralExpression | undefined {
  if (Node.isObjectLiteralExpression(node)) {
    return node;
  }
  if (!Node.isCallExpression(node)) {
    return undefined;
  }
  const expr = node.getExpression();
  if (!Node.isIdentifier(expr) || expr.getText() !== "defineRule") {
    return undefined;
  }
  const arg = node.getArguments()[0];
  return arg !== undefined && Node.isObjectLiteralExpression(arg) ? arg : undefined;
}

export function entryValue(prop: Node): Node | undefined {
  if (Node.isPropertyAssignment(prop)) {
    return prop.getInitializer();
  }
  if (Node.isShorthandPropertyAssignment(prop)) {
    return prop.getNameNode();
  }
  return undefined;
}

export function ruleCreate(rule: ObjectLiteralExpression): Node | undefined {
  const prop = rule.getProperty("create");
  if (Node.isMethodDeclaration(prop)) {
    return prop;
  }
  if (Node.isShorthandPropertyAssignment(prop)) {
    return prop.getNameNode();
  }
  if (!Node.isPropertyAssignment(prop)) {
    return undefined;
  }
  return prop.getInitializer();
}

export function resolveBinding(
  name: string,
  fromFile: SourceFile,
  sources: ReadonlyMap<string, unknown>,
): Node | undefined {
  const local = localBinding(fromFile, name);
  if (local !== undefined) {
    return local;
  }
  return importedBinding(fromFile, name, sources);
}

function localBinding(sourceFile: SourceFile, name: string): Node | undefined {
  for (const stmt of sourceFile.getVariableStatements()) {
    for (const decl of stmt.getDeclarations()) {
      if (decl.getName() === name) {
        return decl.getInitializer();
      }
    }
  }
  for (const fn of sourceFile.getFunctions()) {
    if (fn.getName() === name) {
      return fn;
    }
  }
  return undefined;
}

function importedBinding(
  sourceFile: SourceFile,
  name: string,
  sources: ReadonlyMap<string, unknown>,
): Node | undefined {
  for (const decl of sourceFile.getImportDeclarations()) {
    const found = namedImportTarget(decl, name, sourceFile, sources);
    if (found !== undefined) {
      return found;
    }
  }
  return undefined;
}

function namedImportTarget(
  decl: Node,
  name: string,
  sourceFile: SourceFile,
  sources: ReadonlyMap<string, unknown>,
): Node | undefined {
  if (!Node.isImportDeclaration(decl)) {
    return undefined;
  }
  for (const named of decl.getNamedImports()) {
    const local = named.getAliasNode()?.getText() ?? named.getName();
    if (local !== name) {
      continue;
    }
    const specifier = decl.getModuleSpecifierValue();
    if (!specifier.startsWith(".")) {
      return undefined;
    }
    return exportFromSpecifier(sourceFile.getFilePath(), specifier, named.getName(), sources);
  }
  return undefined;
}

function exportFromSpecifier(
  fromFile: string,
  specifier: string,
  exportName: string,
  sources: ReadonlyMap<string, unknown>,
): Node | undefined {
  const resolved = resolve(dirname(fromFile), specifier);
  const ext = extname(resolved);
  const stem = SWAP_EXTS.has(ext) ? resolved.slice(0, -ext.length) : resolved;
  const hits = [resolved];
  for (const tsExt of TS_EXTS) {
    hits.push(stem + tsExt);
  }
  for (const tsExt of TS_EXTS) {
    hits.push(join(resolved, `index${tsExt}`));
  }
  let target: string | undefined;
  for (const hit of hits) {
    if (sources.has(hit)) {
      target = hit;
      break;
    }
    const normalized = resolve(hit);
    if (sources.has(normalized)) {
      target = normalized;
      break;
    }
  }
  if (target === undefined) {
    return undefined;
  }
  const unit = sources.get(target);
  if (!(unit instanceof SourceFile)) {
    return undefined;
  }
  return localBinding(unit, exportName);
}
