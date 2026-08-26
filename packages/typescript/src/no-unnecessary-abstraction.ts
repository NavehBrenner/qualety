import { basename, dirname, join, resolve } from "node:path";
import { defineRule, type RuleContext } from "qualety";
import {
  type FileSystemHost,
  type InterfaceDeclaration,
  type Symbol as MorphSymbol,
  Node,
  Project,
  SourceFile,
  SyntaxKind,
  type TypeAliasDeclaration,
} from "ts-morph";
import { type FunctionLike, functionLikeName, isFunctionLike } from "./parse-flow.ts";

const FUNCTION_SUGGESTION =
  "Inline at its only call site, or keep only if the name still hides real complexity; wait for a second real call site before keeping a pass-through.";
const UNUSED_FN_HINT =
  "Remove this helper, or wait for a second real call site before keeping the indirection.";
const TYPE_SUGGESTION = "Inline the type at its only use.";
const UNUSED_TYPE_HINT = "Remove this type, or wait for a second real use.";
const MAX_NONBLANK_LINES = 10;
const INDEX_NAMES = new Set(["index.ts", "index.tsx", "index.mts", "index.cts"]);
const REACT_PACKAGES = new Set(["react", "react-dom", "preact"]);
const EXPORT_CONDITION_KEYS = new Set(["import", "require", "default", "types"]);

type PackageInfo = {
  dir: string;
  exportTargets: ReadonlySet<string>;
  react: boolean;
};

type ScannedFile = {
  sourceFile: SourceFile;
  file: string;
  quiet: boolean;
  react: boolean;
};

type TypeDecl = TypeAliasDeclaration | InterfaceDeclaration;

export const noUnnecessaryAbstraction = defineRule({
  meta: {
    requires: ["typescript"],
    docs: {
      description:
        "Do not keep a local abstraction that does not pay for its indirection (single-use helpers and types).",
    },
  },
  create(context) {
    const artifact = context.getArtifact("typescript");
    if (!(artifact.project instanceof Project)) {
      return;
    }
    const fileSystem = artifact.project.getFileSystem();
    const packages = new Map<string, PackageInfo | undefined>();
    const workspace = readPackageJson(fileSystem, join(context.getCwd(), "package.json"), packages);
    const scannedByPackage = new Map<string, ScannedFile[]>();
    for (const [abs, unit] of artifact.sources) {
      if (!(unit instanceof SourceFile) || isSkippedSource(abs, context.getCwd())) {
        continue;
      }
      const owning = findOwningPackage(fileSystem, dirname(abs), packages);
      const quiet =
        INDEX_NAMES.has(basename(abs)) || owning?.exportTargets.has(resolve(abs)) === true;
      const react = (owning?.react ?? false) || (workspace?.react ?? false);
      const key = owning?.dir ?? abs;
      const group = scannedByPackage.get(key) ?? [];
      if (group.length === 0) {
        scannedByPackage.set(key, group);
      }
      group.push({ sourceFile: unit, file: abs, quiet, react });
    }
    for (const group of scannedByPackage.values()) {
      scanPackageGroup(group, context);
    }
  },
});

function scanPackageGroup(group: readonly ScannedFile[], context: Pick<RuleContext, "report">) {
  const callCounts = new Map<string, number>();
  const typeCounts = new Map<string, number>();
  countPackageUses(
    group.map((item) => item.sourceFile),
    callCounts,
    typeCounts,
  );
  for (const item of group) {
    item.sourceFile.forEachDescendant((node) => {
      if (isFunctionLike(node)) {
        considerFunction(node, item.file, context, item.quiet, item.react, callCounts);
      }
      if (Node.isTypeAliasDeclaration(node) || Node.isInterfaceDeclaration(node)) {
        considerType(node, item.file, context, item.quiet, typeCounts);
      }
    });
  }
}

function isSkippedSource(file: string, cwd: string): boolean {
  const normalizedAbs = file.split("\\").join("/");
  const normalizedCwd = cwd.split("\\").join("/");
  const relative =
    normalizedAbs === normalizedCwd
      ? basename(normalizedAbs)
      : normalizedAbs.startsWith(`${normalizedCwd}/`)
        ? normalizedAbs.slice(normalizedCwd.length + 1)
        : normalizedAbs;
  const base = basename(relative);
  const parts = relative.split("/");
  return (
    /\.d\.(?:ts|mts|cts)$/.test(base) ||
    /\.(?:test|spec)\./.test(base) ||
    parts.includes("__tests__") ||
    parts.includes("fixtures")
  );
}

function countPackageUses(
  files: readonly SourceFile[],
  callCounts: Map<string, number>,
  typeCounts: Map<string, number>,
) {
  for (const sourceFile of files) {
    for (const ident of sourceFile.getDescendantsOfKind(SyntaxKind.Identifier)) {
      tallyCall(ident, callCounts);
      tallyType(ident, typeCounts);
    }
  }
}

function tallyCall(ident: Node, counts: Map<string, number>) {
  if (!isCalleeIdentifier(ident)) {
    return;
  }
  const symbol = unwrapSymbol(ident.getSymbol());
  if (
    symbol === undefined ||
    symbol.getDeclarations().some((decl) => {
      const fn = functionLikeOf(decl);
      return (
        fn !== undefined &&
        fn.getSourceFile().getFilePath() === ident.getSourceFile().getFilePath() &&
        fn.containsRange(ident.getStart(), ident.getEnd())
      );
    })
  ) {
    return;
  }
  const key = symbolKey(symbol);
  if (key !== undefined) {
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
}

function tallyType(ident: Node, counts: Map<string, number>) {
  if (isImportOrExportName(ident)) {
    return;
  }
  const symbol = unwrapSymbol(ident.getSymbol());
  if (symbol === undefined) {
    return;
  }
  const key = symbolKey(symbol);
  const decl = symbol.getDeclarations()[0];
  if (
    key === undefined ||
    decl === undefined ||
    !(Node.isTypeAliasDeclaration(decl) || Node.isInterfaceDeclaration(decl))
  ) {
    return;
  }
  if (decl.getNameNode() === ident || decl === ident.getParent()) {
    return;
  }
  counts.set(key, (counts.get(key) ?? 0) + 1);
}

function considerFunction(
  fn: FunctionLike,
  file: string,
  context: Pick<RuleContext, "report">,
  quiet: boolean,
  react: boolean,
  callCounts: ReadonlyMap<string, number>,
) {
  if (quiet || shouldSkipFunction(fn)) {
    return;
  }
  const name = functionLikeName(fn);
  if (name === undefined) {
    return;
  }
  if (skipReactFunction(name, fn, react)) {
    return;
  }
  const symbol = unwrapSymbol(nameNodeOf(fn)?.getSymbol() ?? fn.getSymbol());
  const key = symbol === undefined ? undefined : symbolKey(symbol);
  const uses = key === undefined ? 0 : (callCounts.get(key) ?? 0);
  if (uses > 1 || (!isPassThrough(fn) && !isSmallAndFlat(fn))) {
    return;
  }
  const fnAt = nameNodeOf(fn) ?? fn;
  const fnFile = fnAt.getSourceFile();
  context.report({
    severity: "error",
    file,
    range: {
      start: fnFile.getLineAndColumnAtPos(fnAt.getStart()),
      end: fnFile.getLineAndColumnAtPos(fnAt.getEnd()),
    },
    message:
      uses === 0
        ? `"${name}" is not called and does not pay for the indirection.`
        : `"${name}" is only called once and does not pay for the indirection.`,
    suggestion: uses === 0 ? UNUSED_FN_HINT : FUNCTION_SUGGESTION,
  });
}

function considerType(
  decl: TypeDecl,
  file: string,
  context: Pick<RuleContext, "report">,
  quiet: boolean,
  typeCounts: ReadonlyMap<string, number>,
) {
  if (quiet || shouldSkipType(decl)) {
    return;
  }
  const symbol = decl.getNameNode().getSymbol() ?? decl.getSymbol();
  if (symbol === undefined || symbol.getDeclarations().length !== 1) {
    return;
  }
  const uses = typeCounts.get(symbolKey(symbol) ?? "") ?? 0;
  if (uses > 1) {
    return;
  }
  const typeAt = decl.getNameNode();
  const typeFile = typeAt.getSourceFile();
  context.report({
    severity: "error",
    file,
    range: {
      start: typeFile.getLineAndColumnAtPos(typeAt.getStart()),
      end: typeFile.getLineAndColumnAtPos(typeAt.getEnd()),
    },
    message:
      uses === 0
        ? `"${decl.getName()}" is not referenced.`
        : `"${decl.getName()}" is only referenced once.`,
    suggestion: uses === 0 ? UNUSED_TYPE_HINT : TYPE_SUGGESTION,
  });
}

function shouldSkipType(decl: TypeDecl): boolean {
  if (decl.hasDeclareKeyword()) {
    return true;
  }
  if (Node.isInterfaceDeclaration(decl)) {
    if (decl.getExtends().length > 0) {
      return true;
    }
  }
  if (Node.isTypeAliasDeclaration(decl)) {
    const typeNode = decl.getTypeNode();
    if (
      typeNode === undefined ||
      Node.isIntersectionTypeNode(typeNode) ||
      typeNode.getDescendantsOfKind(SyntaxKind.UniqueKeyword).length > 0
    ) {
      return true;
    }
  }
  return false;
}

function skipReactFunction(name: string, fn: FunctionLike, react: boolean): boolean {
  if (!react) {
    return false;
  }
  if (/^use[A-Z]/.test(name)) {
    return true;
  }
  if (/^[A-Z]/.test(name)) {
    if (isComponentShaped(fn)) {
      return true;
    }
  }
  return false;
}

function shouldSkipFunction(fn: FunctionLike): boolean {
  if (Node.isFunctionDeclaration(fn) && (fn.hasDeclareKeyword() || fn.isOverload())) {
    return true;
  }
  return (
    (Node.isFunctionDeclaration(fn) ||
      Node.isFunctionExpression(fn) ||
      Node.isMethodDeclaration(fn)) &&
    (fn.isGenerator() || fn.getBody() === undefined)
  );
}

function isComponentShaped(fn: FunctionLike): boolean {
  const parent = fn.getParent();
  const typeNode =
    Node.isFunctionDeclaration(fn) || Node.isMethodDeclaration(fn)
      ? fn.getReturnTypeNode()
      : Node.isVariableDeclaration(parent)
        ? parent.getTypeNode()
        : undefined;
  if (typeNode !== undefined && /(?:React\.)?(?:FC|FunctionComponent)\b/.test(typeNode.getText())) {
    return true;
  }
  const body = fn.getBody();
  if (body === undefined) {
    return false;
  }
  return [body, ...body.getDescendants()].some(
    (node) =>
      Node.isJsxElement(node) || Node.isJsxSelfClosingElement(node) || Node.isJsxFragment(node),
  );
}

function isPassThrough(fn: FunctionLike): boolean {
  const body = fn.getBody();
  if (body === undefined) {
    return false;
  }
  if (!Node.isBlock(body)) {
    return isUnwrappedCall(body);
  }
  const statements = body.getStatements();
  if (statements.length !== 1) {
    return false;
  }
  const statement = statements[0];
  if (Node.isReturnStatement(statement)) {
    const expr = statement.getExpression();
    return expr !== undefined && isUnwrappedCall(expr);
  }
  return Node.isExpressionStatement(statement) && isUnwrappedCall(statement.getExpression());
}

function isUnwrappedCall(node: Node): boolean {
  let current = node;
  while (
    Node.isParenthesizedExpression(current) ||
    Node.isAwaitExpression(current) ||
    Node.isVoidExpression(current)
  ) {
    current = current.getExpression();
  }
  return Node.isCallExpression(current);
}

function isSmallAndFlat(fn: FunctionLike): boolean {
  const body = fn.getBody();
  if (body === undefined) {
    return false;
  }
  // Non-blank lines of getBody() text (`split(/\n/)`, trim, drop empty). Braces count if they occupy their own line.
  const lines = body
    .getText()
    .split("\n")
    .filter((line) => line.trim() !== "").length;
  if (lines > MAX_NONBLANK_LINES) {
    return false;
  }
  return !body
    .getDescendants()
    .some((node) => isControlFlow(node) && hasControlAncestor(node, body));
}

function hasControlAncestor(node: Node, body: Node): boolean {
  let ancestor = node.getParent();
  while (ancestor !== undefined && ancestor !== body) {
    const elseIf =
      Node.isIfStatement(node) &&
      Node.isIfStatement(ancestor) &&
      ancestor.getElseStatement() === node;
    if (isControlFlow(ancestor) && !elseIf) {
      return true;
    }
    ancestor = ancestor.getParent();
  }
  return false;
}

function isControlFlow(node: Node): boolean {
  return (
    Node.isIfStatement(node) ||
    Node.isForStatement(node) ||
    Node.isForOfStatement(node) ||
    Node.isForInStatement(node) ||
    Node.isWhileStatement(node) ||
    Node.isDoStatement(node) ||
    Node.isTryStatement(node) ||
    Node.isSwitchStatement(node)
  );
}

function isCalleeIdentifier(ident: Node): boolean {
  const parent = ident.getParent();
  if (parent === undefined) {
    return false;
  }
  if (Node.isCallExpression(parent) && parent.getExpression() === ident) {
    return true;
  }
  if (!Node.isPropertyAccessExpression(parent) || parent.getNameNode() !== ident) {
    return false;
  }
  const call = parent.getParent();
  return Node.isCallExpression(call) && call.getExpression() === parent;
}

function nameNodeOf(fn: FunctionLike) {
  if (Node.isFunctionDeclaration(fn) || Node.isMethodDeclaration(fn)) {
    return fn.getNameNode();
  }
  const parent = fn.getParent();
  return Node.isVariableDeclaration(parent) ? parent.getNameNode() : undefined;
}

function symbolKey(symbol: MorphSymbol): string | undefined {
  const decl = symbol.getDeclarations()[0];
  if (decl === undefined) {
    return undefined;
  }
  return `${decl.getSourceFile().getFilePath()}:${decl.getStart()}`;
}

function functionLikeOf(decl: Node): FunctionLike | undefined {
  if (isFunctionLike(decl)) {
    return decl;
  }
  if (Node.isVariableDeclaration(decl)) {
    const init = decl.getInitializer();
    if (init !== undefined && isFunctionLike(init)) {
      return init;
    }
  }
  return undefined;
}

function unwrapSymbol(symbol: MorphSymbol | undefined): MorphSymbol | undefined {
  return symbol === undefined ? undefined : (symbol.getAliasedSymbol() ?? symbol);
}

function isImportOrExportName(ident: Node): boolean {
  const parent = ident.getParent();
  if (parent === undefined) {
    return false;
  }
  return (
    Node.isImportSpecifier(parent) ||
    Node.isExportSpecifier(parent) ||
    Node.isImportClause(parent) ||
    Node.isNamespaceImport(parent) ||
    Node.isNamespaceExport(parent)
  );
}

function findOwningPackage(
  fileSystem: FileSystemHost,
  startDir: string,
  packages: Map<string, PackageInfo | undefined>,
): PackageInfo | undefined {
  let dir = startDir;
  while (true) {
    const info = readPackageJson(fileSystem, join(dir, "package.json"), packages);
    if (info !== undefined) {
      return info;
    }
    const parent = dirname(dir);
    if (parent === dir) {
      return undefined;
    }
    dir = parent;
  }
}

function readPackageJson(
  fileSystem: FileSystemHost,
  path: string,
  packages: Map<string, PackageInfo | undefined>,
): PackageInfo | undefined {
  if (packages.has(path)) {
    return packages.get(path);
  }
  const info = parsePackageFile(fileSystem, path);
  packages.set(path, info);
  return info;
}

function parsePackageFile(fileSystem: FileSystemHost, path: string): PackageInfo | undefined {
  if (!fileSystem.fileExistsSync(path)) {
    return undefined;
  }
  let raw: unknown;
  try {
    raw = JSON.parse(fileSystem.readFileSync(path));
  } catch {
    return undefined;
  }
  if (!isObject(raw)) {
    return undefined;
  }
  return {
    dir: dirname(path),
    exportTargets: collectExportTargets(dirname(path), raw.exports),
    react: hasReactDependency(raw),
  };
}

function hasReactDependency(pkg: Record<string, unknown>): boolean {
  for (const key of ["dependencies", "peerDependencies", "devDependencies"]) {
    const block = pkg[key];
    if (isObject(block) && Object.keys(block).some((name) => REACT_PACKAGES.has(name))) {
      return true;
    }
  }
  return false;
}

function collectExportTargets(pkgDir: string, exportsValue: unknown): Set<string> {
  const targets = new Set<string>();
  if (typeof exportsValue === "string") {
    addExportTarget(targets, pkgDir, exportsValue);
    return targets;
  }
  if (!isObject(exportsValue)) {
    return targets;
  }
  for (const value of Object.values(exportsValue)) {
    addExportEntry(targets, pkgDir, value);
  }
  return targets;
}

function addExportEntry(targets: Set<string>, pkgDir: string, value: unknown) {
  if (typeof value === "string") {
    addExportTarget(targets, pkgDir, value);
    return;
  }
  if (!isObject(value)) {
    return;
  }
  for (const key of EXPORT_CONDITION_KEYS) {
    const inner = value[key];
    if (typeof inner === "string") {
      addExportTarget(targets, pkgDir, inner);
    }
  }
}

function addExportTarget(targets: Set<string>, pkgDir: string, spec: string) {
  if (spec.startsWith(".")) {
    targets.add(resolve(pkgDir, spec));
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
