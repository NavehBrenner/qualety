import { dirname, extname, join, resolve } from "node:path";
import { defineRule, type Range, type RuleContext } from "qualety";
import { type ExportDeclaration, Node, SourceFile, SyntaxKind } from "ts-morph";

const TS_EXTS = [".ts", ".tsx", ".mts", ".cts"] as const;
const SWAP_EXTS = new Set([".js", ".jsx", ".mjs", ".cjs", ...TS_EXTS]);

type PublicExport = {
  key: string;
  name: string;
  file: string;
  display: string;
  range: Range;
};

export const publicExportsTested = defineRule({
  meta: {
    requires: ["typescript"],
    docs: {
      description:
        "Every public value export in included non-test sources must be referenced from a test path.",
    },
  },
  create(context) {
    const sources = context.getArtifact("typescript").sources;
    const displayByAbs = mapDisplayPaths(context, sources);
    const referenced = new Set<string>();
    const exported: PublicExport[] = [];

    for (const [abs, unit] of sources) {
      if (/\.d\.(?:ts|mts|cts)$/.test(posix(abs)) || !(unit instanceof SourceFile)) {
        continue;
      }
      const normalized = posix(abs);
      const base = normalized.slice(normalized.lastIndexOf("/") + 1);
      if (/\.(?:test|spec)\./.test(base) || normalized.split("/").includes("__tests__")) {
        collectReferences(unit, abs, sources, referenced);
      } else {
        const display = displayByAbs.get(abs) ?? posix(abs);
        exported.push(...collectPublicExports(unit, abs, display));
      }
    }

    const seen = new Set<string>();
    for (const item of exported) {
      if (seen.has(item.key) || referenced.has(item.key)) {
        continue;
      }
      seen.add(item.key);
      context.report({
        severity: "error",
        file: item.file,
        range: item.range,
        message: `Public export "${item.name}" in ${item.display} is not referenced from a test file.`,
        suggestion: `Import "${item.name}" from a test path (*.test.*, *.spec.*, or a __tests__/ directory).`,
      });
    }
  },
});

function mapDisplayPaths(
  context: Pick<RuleContext, "getCwd" | "getFiles">,
  sources: ReadonlyMap<string, unknown>,
): Map<string, string> {
  const cwd = context.getCwd();
  const displayByAbs = new Map<string, string>();
  for (const name of context.getFiles()) {
    const abs = resolve(cwd, name);
    if (sources.has(abs)) {
      displayByAbs.set(abs, name);
    }
  }
  return displayByAbs;
}

function collectPublicExports(sf: SourceFile, abs: string, display: string): PublicExport[] {
  const result: PublicExport[] = [];
  const push = (name: string, node: Node) => {
    const start = sf.getLineAndColumnAtPos(node.getStart());
    const end = sf.getLineAndColumnAtPos(node.getEnd());
    result.push({
      key: `${abs}#${name}`,
      name,
      file: abs,
      display,
      range: {
        start: { line: start.line, column: start.column },
        end: { line: end.line, column: end.column },
      },
    });
  };

  for (const stmt of sf.getStatements()) {
    collectStatementExport(stmt, push);
  }
  return result;
}

function collectStatementExport(stmt: Node, push: (name: string, node: Node) => void) {
  if (Node.isExportDeclaration(stmt)) {
    collectExportDeclaration(stmt, push);
    return;
  }
  if (Node.isExportAssignment(stmt)) {
    if (!stmt.isExportEquals()) {
      push("default", defaultKeyword(stmt) ?? stmt);
    }
    return;
  }
  if (collectNamedValueExport(stmt, push)) {
    return;
  }
  if (Node.isVariableStatement(stmt) && stmt.hasExportKeyword()) {
    for (const decl of stmt.getDeclarations()) {
      push(decl.getName(), decl.getNameNode() ?? decl);
    }
  }
}

function collectNamedValueExport(stmt: Node, push: (name: string, node: Node) => void): boolean {
  if (
    !Node.isFunctionDeclaration(stmt) &&
    !Node.isClassDeclaration(stmt) &&
    !Node.isEnumDeclaration(stmt)
  ) {
    return false;
  }
  if (!stmt.hasExportKeyword()) {
    return true;
  }
  if (stmt.isDefaultExport()) {
    push("default", defaultKeyword(stmt) ?? stmt.getNameNode() ?? stmt);
    return true;
  }
  const nameNode = stmt.getNameNode();
  const name = stmt.getName();
  if (name !== undefined && nameNode !== undefined) {
    push(name, nameNode);
  }
  return true;
}

function collectExportDeclaration(
  stmt: ExportDeclaration,
  push: (name: string, node: Node) => void,
): void {
  if (stmt.isTypeOnly() || stmt.isNamespaceExport()) {
    return;
  }
  for (const spec of stmt.getNamedExports()) {
    if (spec.isTypeOnly()) {
      continue;
    }
    push(spec.compilerNode.name.text, spec.getNameNode());
  }
}

function collectReferences(
  sf: SourceFile,
  fromFile: string,
  sources: ReadonlyMap<string, unknown>,
  referenced: Set<string>,
): void {
  for (const decl of sf.getImportDeclarations()) {
    const specifier = decl.getModuleSpecifierValue();
    const target = resolveImportTarget(fromFile, specifier, sources);
    if (target === undefined) {
      continue;
    }
    if (decl.getDefaultImport() !== undefined) {
      referenced.add(`${target}#default`);
    }
    for (const named of decl.getNamedImports()) {
      referenced.add(`${target}#${named.getName()}`);
    }
  }
}

function resolveImportTarget(
  fromFile: string,
  specifier: string,
  sources: ReadonlyMap<string, unknown>,
): string | undefined {
  if (!specifier.startsWith(".")) {
    return undefined;
  }
  const resolved = resolve(dirname(fromFile), specifier);
  const ext = extname(resolved);
  const stem = SWAP_EXTS.has(ext) ? resolved.slice(0, -ext.length) : resolved;
  const paths = [resolved];
  TS_EXTS.forEach((tsExt) => {
    paths.push(stem + tsExt);
    paths.push(join(resolved, `index${tsExt}`));
  });
  const found = paths.find((path) => sources.has(path) || sources.has(resolve(path)));
  if (found === undefined) {
    return undefined;
  }
  return sources.has(found) ? found : resolve(found);
}

function defaultKeyword(node: Node): Node | undefined {
  return node.getFirstChildByKind(SyntaxKind.DefaultKeyword);
}

function posix(filePath: string): string {
  return filePath.split("\\").join("/");
}
