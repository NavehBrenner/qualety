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
const TYPE_SUGGESTION = "Inline the type at its only use.";
const MAX_NONBLANK_LINES = 10;
const INDEX_NAMES = new Set(["index.ts", "index.tsx", "index.mts", "index.cts"]);
const REACT_PACKAGES = new Set(["react", "react-dom", "preact"]);
const EXPORT_CONDITION_KEYS = new Set(["import", "require", "default", "types"]);

type PackageInfo = {
  dir: string;
  exportTargets: ReadonlySet<string>;
  react: boolean;
};

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
    for (const [abs, unit] of artifact.sources) {
      if (unit instanceof SourceFile) {
        scanSourceFile(unit, abs, context, fileSystem, packages, workspace);
      }
    }
  },
});

function scanSourceFile(
  sourceFile: SourceFile,
  file: string,
  context: Pick<RuleContext, "getCwd" | "report">,
  fileSystem: FileSystemHost,
  packages: Map<string, PackageInfo | undefined>,
  workspace: PackageInfo | undefined,
) {
  const normalizedAbs = file.split("\\").join("/");
  const normalizedCwd = context.getCwd().split("\\").join("/");
  const relative =
    normalizedAbs === normalizedCwd
      ? basename(normalizedAbs)
      : normalizedAbs.startsWith(`${normalizedCwd}/`)
        ? normalizedAbs.slice(normalizedCwd.length + 1)
        : normalizedAbs;
  const base = basename(relative);
  const parts = relative.split("/");
  if (
    /\.d\.(?:ts|mts|cts)$/.test(base) ||
    /\.(?:test|spec)\./.test(base) ||
    parts.includes("__tests__") ||
    parts.includes("fixtures")
  ) {
    return;
  }
  const owning = findOwningPackage(fileSystem, dirname(file), packages);
  const quiet =
    INDEX_NAMES.has(basename(file)) || owning?.exportTargets.has(resolve(file)) === true;
  const react = (owning?.react ?? false) || (workspace?.react ?? false);
  sourceFile.forEachDescendant((node) => {
    if (isFunctionLike(node)) {
      considerFunction(node, file, context, quiet, react);
    }
    if (Node.isTypeAliasDeclaration(node) || Node.isInterfaceDeclaration(node)) {
      considerType(node, file, context, quiet);
    }
  });
}

function considerFunction(
  fn: FunctionLike,
  file: string,
  context: Pick<RuleContext, "report">,
  quiet: boolean,
  react: boolean,
) {
  if (quiet || shouldSkipFunction(fn)) {
    return;
  }
  const name = functionLikeName(fn);
  if (name === undefined) {
    return;
  }
  if (react && /^use[A-Z]/.test(name)) {
    return;
  }
  if (react && /^[A-Z]/.test(name) && isComponentShaped(fn)) {
    return;
  }
  if (sameFileCallCount(fn) !== 1 || (!isPassThrough(fn) && !isSmallAndFlat(fn))) {
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
    message: `"${name}" is only called once in this file and does not pay for the indirection.`,
    suggestion: FUNCTION_SUGGESTION,
  });
}

function considerType(
  decl: TypeAliasDeclaration | InterfaceDeclaration,
  file: string,
  context: Pick<RuleContext, "report">,
  quiet: boolean,
) {
  if (quiet || decl.hasDeclareKeyword()) {
    return;
  }
  if (Node.isInterfaceDeclaration(decl) && decl.getExtends().length > 0) {
    return;
  }
  if (Node.isTypeAliasDeclaration(decl)) {
    const typeNode = decl.getTypeNode();
    if (
      typeNode === undefined ||
      Node.isIntersectionTypeNode(typeNode) ||
      typeNode.getDescendantsOfKind(SyntaxKind.UniqueKeyword).length > 0
    ) {
      return;
    }
  }
  const symbol = decl.getNameNode().getSymbol() ?? decl.getSymbol();
  if (symbol === undefined || symbol.getDeclarations().length !== 1) {
    return;
  }
  if (sameFileTypeUses(decl) !== 1) {
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
    message: `"${decl.getName()}" is only referenced once in this file.`,
    suggestion: TYPE_SUGGESTION,
  });
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

function sameFileCallCount(fn: FunctionLike): number {
  const nameNode = nameNodeOf(fn);
  const symbol = nameNode?.getSymbol();
  if (nameNode === undefined || symbol === undefined) {
    return 0;
  }
  let count = 0;
  for (const node of fn.getSourceFile().getDescendantsOfKind(SyntaxKind.Identifier)) {
    if (node === nameNode || node.getText() !== nameNode.getText()) {
      continue;
    }
    if (!sameSymbol(node.getSymbol(), symbol) || !isCalleeIdentifier(node)) {
      continue;
    }
    if (!fn.containsRange(node.getStart(), node.getEnd())) {
      count += 1;
    }
  }
  return count;
}

function sameFileTypeUses(decl: TypeAliasDeclaration | InterfaceDeclaration): number {
  const nameNode = decl.getNameNode();
  const symbol = nameNode.getSymbol() ?? decl.getSymbol();
  if (symbol === undefined) {
    return 0;
  }
  let count = 0;
  for (const node of decl.getSourceFile().getDescendantsOfKind(SyntaxKind.Identifier)) {
    if (node === nameNode || node.getText() !== decl.getName()) {
      continue;
    }
    if (sameSymbol(node.getSymbol(), symbol)) {
      count += 1;
    }
  }
  return count;
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

function sameSymbol(left: MorphSymbol | undefined, right: MorphSymbol): boolean {
  if (left === undefined) {
    return false;
  }
  return left === right || left.getDeclarations()[0] === right.getDeclarations()[0];
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
