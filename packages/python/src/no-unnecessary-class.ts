import { defineRule, type RuleContext } from "qualety";
import type { PythonNode, PythonSource } from "./python.ts";
import {
  asNodes,
  childNodes,
  collectImports,
  collectLoadKeys,
  containsPos,
  type FileBinds,
  groupByPackage,
  hasDecorator,
  isDunder,
  isPassThrough,
  isPythonNode,
  isSmallAndFlat,
  isTestLoader,
  mergePathLoads,
  nameRange,
  silencedTargets,
} from "./walk.ts";

const CLASS_OR_STATIC = new Set(["classmethod", "staticmethod"]);
const UNUSED_CLASS_HINT =
  "Remove this class, or wait for a second instantiation or subclass before keeping the indirection.";
const ONCE_CLASS_HINT =
  "Inline at its only instantiation or subclass, or wait for a second use before keeping the class.";

type ClassInfo = {
  file: string;
  name: string;
  node: PythonNode;
  text: string;
};

type ClassRef = {
  file: string;
  name: string;
  owner: string | undefined;
  lineno: number;
};

export const noUnnecessaryClass = defineRule({
  meta: {
    requires: ["python"],
    docs: {
      description:
        "Do not keep a local class that does not pay for its indirection (thin or pass-through).",
    },
  },
  create: (context) => {
    const cwd = context.getCwd();
    const artifact = context.getArtifact("python");
    if (!(artifact.sources instanceof Map)) {
      return;
    }
    for (const group of groupByPackage(artifact.sources, cwd).values()) {
      if (group.length > 0) {
        scanClasses(group, artifact.sources, cwd, context);
      }
    }
  },
});

function scanClasses(
  group: readonly PythonSource[],
  allSources: ReadonlyMap<string, PythonSource>,
  cwd: string,
  context: Pick<RuleContext, "report">,
) {
  const classes: ClassInfo[] = [];
  const binds = new Map<string, FileBinds>();
  const sources = new Map(group.map((unit) => [unit.file, unit]));
  const loadTargets = new Set<string>();
  const boundFiles = new Set<string>();
  for (const unit of group) {
    const fileBinds = collectImports(unit, sources);
    mergePathLoads(unit, sources, fileBinds, loadTargets, boundFiles);
    binds.set(unit.file, fileBinds);
    collectClasses(unit, classes);
  }
  const byKey = new Map(classes.map((item) => [classKey(item), item]));
  const useCounts = new Map<string, number>();
  const valueLoads = new Set<string>();
  for (const unit of group) {
    tallyClassFile(unit, binds.get(unit.file), classes, byKey, useCounts, valueLoads);
  }
  const packageDir = group[0]?.packageDir;
  for (const unit of allSources.values()) {
    if (unit.packageDir !== packageDir || !isTestLoader(unit.file, cwd)) {
      continue;
    }
    const fileBinds: FileBinds = { named: new Map(), modules: new Map() };
    mergePathLoads(unit, sources, fileBinds, loadTargets, boundFiles);
    tallyClassFile(unit, fileBinds, classes, byKey, useCounts, valueLoads);
  }
  const silenced = silencedTargets(loadTargets, boundFiles);
  for (const item of classes) {
    if (!valueLoads.has(classKey(item))) {
      considerClass(item, context, useCounts, silenced);
    }
  }
}

function tallyClassFile(
  unit: PythonSource,
  fileBinds: FileBinds | undefined,
  classes: readonly ClassInfo[],
  byKey: ReadonlyMap<string, ClassInfo>,
  useCounts: Map<string, number>,
  valueLoads: Set<string>,
) {
  walkClassUses(unit.tree, unit.file, (ref) => {
    tallyClassUse(ref, fileBinds, classes, byKey, useCounts);
  });
  collectLoadKeys(
    unit.tree,
    "",
    unit.file,
    (parent, child) => {
      if (parent._type === "Call" && child === parent.func) {
        return true;
      }
      if (parent._type !== "ClassDef") {
        return false;
      }
      return asNodes(parent.bases).includes(child);
    },
    (ref) => resolveClass(ref, fileBinds, classes),
    (key) => byKey.get(key)?.node,
    valueLoads,
  );
}

function considerClass(
  item: ClassInfo,
  context: Pick<RuleContext, "report">,
  useCounts: ReadonlyMap<string, number>,
  silenced: ReadonlySet<string>,
) {
  if (silenced.has(item.file)) {
    return;
  }
  if (hasNonObjectBase(item.node) || hasMetaclass(item.node) || extraDunderCount(item.node) >= 2) {
    return;
  }
  const uses = useCounts.get(classKey(item)) ?? 0;
  if (uses > 1 || (!isThinNamespace(item.node) && !isPassThroughClass(item))) {
    return;
  }
  context.report({
    severity: "error",
    file: item.file,
    range: nameRange(item.node),
    message:
      uses === 0
        ? `"${item.name}" is not instantiated or subclassed and does not pay for the indirection.`
        : `"${item.name}" is only used once and does not pay for the indirection.`,
    suggestion: uses === 0 ? UNUSED_CLASS_HINT : ONCE_CLASS_HINT,
  });
}

function collectClasses(unit: PythonSource, classes: ClassInfo[]) {
  const stack: PythonNode[] = [unit.tree];
  const inFnAt: boolean[] = [false];
  while (stack.length > 0) {
    const node = stack.pop();
    const inFn = inFnAt.pop() === true;
    if (node === undefined) {
      continue;
    }
    const nested = node._type === "FunctionDef" || node._type === "AsyncFunctionDef";
    if (node._type === "ClassDef" && !inFn && typeof node.name === "string") {
      classes.push({ file: unit.file, name: node.name, node, text: unit.text });
    }
    for (const child of childNodes(node)) {
      stack.push(child);
      inFnAt.push(inFn || nested);
    }
  }
}

function walkClassUses(node: PythonNode, file: string, visit: (ref: ClassRef) => void) {
  if (node._type === "ClassDef") {
    for (const base of asNodes(node.bases)) {
      const ref = nameRef(unwrapSubscript(base), file);
      if (ref !== undefined) {
        visit(ref);
      }
    }
  }
  if (node._type === "Call") {
    const ref = nameRef(isPythonNode(node.func) ? node.func : undefined, file);
    if (ref !== undefined) {
      visit(ref);
    }
  }
  for (const child of childNodes(node)) {
    walkClassUses(child, file, visit);
  }
}

function tallyClassUse(
  ref: ClassRef,
  fileBinds: FileBinds | undefined,
  classes: readonly ClassInfo[],
  byKey: ReadonlyMap<string, ClassInfo>,
  counts: Map<string, number>,
) {
  const key = resolveClass(ref, fileBinds, classes);
  if (key === undefined) {
    return;
  }
  const item = byKey.get(key);
  if (item !== undefined && containsPos(item.node, ref.lineno)) {
    return;
  }
  counts.set(key, (counts.get(key) ?? 0) + 1);
}

function resolveClass(
  ref: ClassRef,
  fileBinds: FileBinds | undefined,
  classes: readonly ClassInfo[],
): string | undefined {
  if (typeof ref.owner === "string") {
    const moduleFile = fileBinds?.modules.get(ref.owner);
    if (moduleFile === undefined) {
      return undefined;
    }
    return findClassKey(classes, moduleFile, ref.name);
  }
  const imported = fileBinds?.named.get(ref.name);
  if (imported !== undefined) {
    return findClassKey(classes, imported.file, imported.name);
  }
  return findClassKey(classes, ref.file, ref.name);
}

function findClassKey(
  classes: readonly ClassInfo[],
  file: string,
  name: string,
): string | undefined {
  const hits = classes.filter((item) => item.file === file && item.name === name);
  const hit = hits[0];
  return hits.length === 1 && hit !== undefined ? classKey(hit) : undefined;
}

function classKey(item: Pick<ClassInfo, "file" | "name" | "node">): string {
  return `${item.file}:${item.node.lineno}:${item.name}`;
}

function nameRef(node: PythonNode | undefined, file: string): ClassRef | undefined {
  if (node === undefined) {
    return undefined;
  }
  const lineno = typeof node.lineno === "number" ? node.lineno : 1;
  if (node._type === "Name" && typeof node.id === "string") {
    return { file, name: node.id, owner: undefined, lineno };
  }
  if (node._type !== "Attribute" || typeof node.attr !== "string" || !isPythonNode(node.value)) {
    return undefined;
  }
  if (node.value._type !== "Name" || typeof node.value.id !== "string") {
    return undefined;
  }
  return { file, name: node.attr, owner: node.value.id, lineno };
}

function unwrapSubscript(node: PythonNode): PythonNode {
  if (node._type === "Subscript" && isPythonNode(node.value)) {
    return node.value;
  }
  return node;
}

function hasNonObjectBase(node: PythonNode): boolean {
  for (const base of asNodes(node.bases)) {
    const core = unwrapSubscript(base);
    if (core._type !== "Name" || core.id !== "object") {
      return true;
    }
  }
  return false;
}

function hasMetaclass(node: PythonNode): boolean {
  for (const keyword of asNodes(node.keywords)) {
    if (keyword.arg === "metaclass") {
      return true;
    }
  }
  return false;
}

function extraDunderCount(node: PythonNode): number {
  let count = 0;
  for (const stmt of asNodes(node.body)) {
    if (stmt._type !== "FunctionDef" && stmt._type !== "AsyncFunctionDef") {
      continue;
    }
    if (typeof stmt.name === "string" && isDunder(stmt.name) && stmt.name !== "__init__") {
      count += 1;
    }
  }
  return count;
}

function isThinNamespace(node: PythonNode): boolean {
  if (initIsMeaningful(node)) {
    return false;
  }
  for (const stmt of asNodes(node.body)) {
    if (!isThinStmt(stmt)) {
      return false;
    }
  }
  return true;
}

function isThinStmt(stmt: PythonNode): boolean {
  if (stmt._type === "FunctionDef" || stmt._type === "AsyncFunctionDef" || stmt._type === "Pass") {
    return true;
  }
  if (stmt._type === "Assign") {
    const targets = asNodes(stmt.targets);
    return targets.length > 0 && targets.every((target) => target._type === "Name");
  }
  if (stmt._type === "AnnAssign") {
    return isPythonNode(stmt.target) && stmt.target._type === "Name";
  }
  return stmt._type === "Expr" && isDocOrEllipsis(stmt);
}

function isDocOrEllipsis(stmt: PythonNode): boolean {
  const value = stmt.value;
  if (!isPythonNode(value)) {
    return false;
  }
  if (value._type === "Ellipsis") {
    return true;
  }
  if (value._type === "Constant") {
    return typeof value.value === "string" || value.value === "Ellipsis";
  }
  return value._type === "Str";
}

function initIsMeaningful(node: PythonNode): boolean {
  for (const stmt of asNodes(node.body)) {
    if (stmt._type === "FunctionDef" && stmt.name === "__init__") {
      return !isEmptyInit(stmt);
    }
  }
  return false;
}

function isEmptyInit(fn: PythonNode): boolean {
  for (const stmt of asNodes(fn.body)) {
    if (stmt._type === "Pass") {
      continue;
    }
    if (stmt._type === "Expr" && isDocOrEllipsis(stmt)) {
      continue;
    }
    return false;
  }
  return true;
}

function isPassThroughClass(item: ClassInfo): boolean {
  if (initIsMeaningful(item.node)) {
    return false;
  }
  let method: PythonNode | undefined;
  for (const stmt of asNodes(item.node.body)) {
    const next = passThroughStmt(stmt, method);
    if (next === "no") {
      return false;
    }
    if (next !== "skip") {
      method = next;
    }
  }
  if (method === undefined) {
    return false;
  }
  return isPassThrough(method) || isSmallAndFlat(method, item.text);
}

function passThroughStmt(
  stmt: PythonNode,
  method: PythonNode | undefined,
): PythonNode | "skip" | "no" {
  if (stmt._type === "Pass" || (stmt._type === "Expr" && isDocOrEllipsis(stmt))) {
    return "skip";
  }
  if (stmt._type !== "FunctionDef" && stmt._type !== "AsyncFunctionDef") {
    return "no";
  }
  if (typeof stmt.name !== "string") {
    return "no";
  }
  if (isDunder(stmt.name)) {
    return "skip";
  }
  if (hasDecorator(stmt, CLASS_OR_STATIC) || method !== undefined) {
    return "no";
  }
  return stmt;
}
