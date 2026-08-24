import { dirname, extname, join, resolve } from "node:path";
import type { Range } from "qualety";
import { type Node, SourceFile } from "ts-morph";

const TS_EXTS = [".ts", ".tsx", ".mts", ".cts"] as const;
const SWAP_EXTS = new Set([".js", ".jsx", ".mjs", ".cjs", ...TS_EXTS]);

export const PRODUCT_PLUGIN_DIRS = ["typescript", "react", "dry", "dev"] as const;

export function isSourceFile(value: unknown): value is SourceFile {
  return value instanceof SourceFile;
}

export function posix(filePath: string): string {
  return filePath.split("\\").join("/");
}

export function rangeOf(node: Node): Range {
  const sourceFile = node.getSourceFile();
  const start = sourceFile.getLineAndColumnAtPos(node.getStart());
  const end = sourceFile.getLineAndColumnAtPos(node.getEnd());
  return {
    start: { line: start.line, column: start.column },
    end: { line: end.line, column: end.column },
  };
}

export function lineRange(line: number): Range {
  return { start: { line, column: 1 }, end: { line, column: 1 } };
}

export function isTestPath(filePath: string): boolean {
  const normalized = posix(filePath);
  const base = normalized.slice(normalized.lastIndexOf("/") + 1);
  if (/\.(?:test|spec)\./.test(base)) {
    return true;
  }
  return normalized.split("/").includes("__tests__");
}

export function isCorePackagePath(filePath: string): boolean {
  return posix(filePath).includes("/packages/qualety/");
}

export function isProductPluginPath(filePath: string): boolean {
  const normalized = posix(filePath);
  return PRODUCT_PLUGIN_DIRS.some((dir) => normalized.includes(`/packages/${dir}/`));
}

export function findSource(
  sources: ReadonlyMap<string, unknown>,
  suffix: string,
): SourceFile | undefined {
  const needle = posix(suffix);
  for (const [abs, unit] of sources) {
    if (posix(abs).endsWith(needle) && isSourceFile(unit)) {
      return unit;
    }
  }
  return undefined;
}

export function resolveRelativeSpecifier(
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
  const hits = [resolved];
  for (const tsExt of TS_EXTS) {
    hits.push(stem + tsExt);
  }
  for (const tsExt of TS_EXTS) {
    hits.push(join(resolved, `index${tsExt}`));
  }
  for (const hit of hits) {
    if (sources.has(hit)) {
      return hit;
    }
    const normalized = resolve(hit);
    if (sources.has(normalized)) {
      return normalized;
    }
  }
  return undefined;
}

export function importNameMap(sourceFile: SourceFile): Map<string, string> {
  const importMap = new Map<string, string>();
  for (const decl of sourceFile.getImportDeclarations()) {
    const specifier = decl.getModuleSpecifierValue();
    for (const named of decl.getNamedImports()) {
      importMap.set(named.getAliasNode()?.getText() ?? named.getName(), specifier);
    }
    const def = decl.getDefaultImport();
    if (def !== undefined) {
      importMap.set(def.getText(), specifier);
    }
    const namespaceImport = decl.getNamespaceImport();
    if (namespaceImport !== undefined) {
      importMap.set(namespaceImport.getText(), specifier);
    }
  }
  return importMap;
}

export function relativeImportTargets(
  sourceFile: SourceFile,
  sources: ReadonlyMap<string, unknown>,
): string[] {
  const targets: string[] = [];
  for (const decl of sourceFile.getImportDeclarations()) {
    const target = resolveRelativeSpecifier(
      sourceFile.getFilePath(),
      decl.getModuleSpecifierValue(),
      sources,
    );
    if (target !== undefined) {
      targets.push(target);
    }
  }
  return targets;
}

export function specifierIsFs(specifier: string): boolean {
  return (
    specifier === "node:fs" ||
    specifier === "node:fs/promises" ||
    specifier === "fs" ||
    specifier === "fs/promises"
  );
}

export function walkReachable(
  start: Iterable<string>,
  sources: ReadonlyMap<string, unknown>,
): Set<string> {
  const seen = new Set<string>();
  const queue = [...start];
  while (queue.length > 0) {
    const file = queue.pop();
    if (file === undefined || seen.has(file)) {
      continue;
    }
    seen.add(file);
    const unit = sources.get(file);
    if (!isSourceFile(unit)) {
      continue;
    }
    for (const target of relativeImportTargets(unit, sources)) {
      queue.push(target);
    }
  }
  return seen;
}
