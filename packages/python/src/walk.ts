import { basename, dirname, join, resolve } from "node:path";
import type { PythonNode, PythonSource } from "./python.ts";

const MAX_NONBLANK_LINES = 10;
const CONTROL = new Set(["If", "For", "AsyncFor", "While", "Try", "Match"]);
const NESTED_STOP = new Set(["FunctionDef", "AsyncFunctionDef", "ClassDef", "Lambda"]);
const DUNDER = /^__\w+__$/;
const OVERLOAD = new Set(["overload"]);

export type NamedImport = { file: string; name: string };

export type FileBinds = {
  named: Map<string, NamedImport>;
  modules: Map<string, string>;
};

type Reexport = { name: string; node: PythonNode };

export function isDunder(name: string): boolean {
  return DUNDER.test(name);
}

export function isInitModule(file: string): boolean {
  return basename(file) === "__init__.py";
}

export function isPythonNode(value: unknown): value is PythonNode {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  return "_type" in value && typeof value._type === "string";
}

export function asNodes(value: unknown): PythonNode[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item) => isPythonNode(item));
}

export function childNodes(node: PythonNode): PythonNode[] {
  const out: PythonNode[] = [];
  for (const value of Object.values(node)) {
    if (isPythonNode(value)) {
      out.push(value);
    } else if (Array.isArray(value)) {
      for (const item of value) {
        if (isPythonNode(item)) {
          out.push(item);
        }
      }
    }
  }
  return out;
}

export function isTestPath(file: string, cwd: string): boolean {
  const rel = relativePosix(file, cwd);
  const base = basename(rel);
  if (base === "conftest.py" || base.endsWith("_test.py")) {
    return true;
  }
  if (base.startsWith("test_") && base.endsWith(".py")) {
    return true;
  }
  return /(?:^|\/)(?:tests|__tests__)(?:\/|$)/.test(rel);
}

export function isSkippedSource(file: string, cwd: string): boolean {
  const rel = relativePosix(file, cwd);
  const base = basename(rel);
  if (base.endsWith(".pyi")) {
    return true;
  }
  if (isTestPath(file, cwd)) {
    return true;
  }
  return /(?:^|\/)(?:fixtures|__pycache__)(?:\/|$)/.test(rel);
}

export function forEachPythonSource(
  sources: unknown,
  cwd: string,
  visit: (unit: PythonSource) => void,
) {
  if (!(sources instanceof Map)) {
    return;
  }
  for (const [abs, unit] of sources) {
    if (isSkippedSource(abs, cwd)) {
      continue;
    }
    visit(unit);
  }
}

export function walkNodes(node: PythonNode, visit: (node: PythonNode) => void) {
  visit(node);
  for (const child of childNodes(node)) {
    walkNodes(child, visit);
  }
}

export function collectModuleAliases(
  tree: PythonNode,
  visit: (stmt: PythonNode, aliases: Set<string>) => void,
): Set<string> {
  const aliases = new Set<string>();
  for (const stmt of asNodes(tree.body)) {
    visit(stmt, aliases);
  }
  return aliases;
}

export function groupByPackage(
  sources: ReadonlyMap<string, PythonSource>,
  cwd: string,
): Map<string, PythonSource[]> {
  const scanned = new Map<string, PythonSource[]>();
  for (const [abs, unit] of sources) {
    if (isSkippedSource(abs, cwd)) {
      continue;
    }
    const group = scanned.get(unit.packageDir) ?? [];
    if (group.length === 0) {
      scanned.set(unit.packageDir, group);
    }
    group.push(unit);
  }
  return scanned;
}

export function collectImports(
  unit: PythonSource,
  sources: ReadonlyMap<string, PythonSource>,
): FileBinds {
  const named = new Map<string, NamedImport>();
  const modules = new Map<string, string>();
  for (const stmt of asNodes(unit.tree.body)) {
    if (stmt._type === "Import") {
      collectImport(stmt, unit, sources, modules);
    }
    if (stmt._type === "ImportFrom") {
      collectImportFrom(stmt, unit, sources, named, modules);
    }
  }
  return { named, modules };
}

function resolveModuleFile(
  fromFile: string,
  module: string | undefined,
  level: number,
  packageDir: string,
  sources: ReadonlyMap<string, PythonSource>,
): string | undefined {
  const parts = module === undefined || module.length === 0 ? [] : module.split(".");
  if (level === 0) {
    const sibling = moduleHit(join(dirname(fromFile), ...parts), sources);
    if (sibling !== undefined) {
      return sibling;
    }
    return moduleHit(join(packageDir, ...parts), sources);
  }
  let dir = dirname(fromFile);
  for (let index = 1; index < level; index += 1) {
    dir = dirname(dir);
  }
  return moduleHit(join(dir, ...parts), sources);
}

export function isPassThrough(fn: PythonNode): boolean {
  const body = asNodes(fn.body);
  if (body.length !== 1) {
    return false;
  }
  const stmt = body[0];
  if (stmt === undefined) {
    return false;
  }
  if (stmt._type === "Return") {
    return isUnwrappedCall(stmt.value);
  }
  return stmt._type === "Expr" && isUnwrappedCall(stmt.value);
}

export function isSmallAndFlat(fn: PythonNode, text: string): boolean {
  if (bodyLineCount(fn, text) > MAX_NONBLANK_LINES) {
    return false;
  }
  for (const stmt of asNodes(fn.body)) {
    if (hasNestedControl(stmt, false)) {
      return false;
    }
  }
  return true;
}

export function nameRange(node: PythonNode): {
  start: { line: number; column: number };
  end: { line: number; column: number };
} {
  const line = typeof node.lineno === "number" ? node.lineno : 1;
  const col = (typeof node.col_offset === "number" ? node.col_offset : 0) + 1;
  const prefix =
    node._type === "AsyncFunctionDef"
      ? "async def "
      : node._type === "ClassDef"
        ? "class "
        : "def ";
  const name = typeof node.name === "string" ? node.name : "";
  const startCol = col + prefix.length;
  return {
    start: { line, column: startCol },
    end: { line, column: startCol + name.length },
  };
}

export function nodeRange(node: PythonNode): {
  start: { line: number; column: number };
  end: { line: number; column: number };
} {
  const line = typeof node.lineno === "number" ? node.lineno : 1;
  const col = (typeof node.col_offset === "number" ? node.col_offset : 0) + 1;
  const endLine = typeof node.end_lineno === "number" ? node.end_lineno : line;
  const endCol = typeof node.end_col_offset === "number" ? node.end_col_offset + 1 : col + 1;
  return {
    start: { line, column: col },
    end: { line: endLine, column: endCol },
  };
}

export function containsPos(node: PythonNode, lineno: number): boolean {
  if (typeof node.lineno === "number") {
    const end = typeof node.end_lineno === "number" ? node.end_lineno : node.lineno;
    if (lineno >= node.lineno && lineno <= end) {
      return true;
    }
  }
  return false;
}

export function hasDecorator(fn: PythonNode, names: ReadonlySet<string>): boolean {
  for (const dec of asNodes(fn.decorator_list)) {
    if (decoratorHits(dec, names)) {
      return true;
    }
  }
  return false;
}

export function readDunderAll(
  tree: PythonNode,
):
  | { kind: "absent" }
  | { kind: "silence" }
  | { kind: "names"; names: { name: string; node: PythonNode }[] } {
  let found: PythonNode | undefined;
  for (const stmt of asNodes(tree.body)) {
    if (stmt._type === "AugAssign" && isNameId(stmt.target, "__all__")) {
      return { kind: "silence" };
    }
    const assigned =
      stmt._type === "AnnAssign"
        ? isNameId(stmt.target, "__all__")
        : stmt._type === "Assign" &&
          asNodes(stmt.targets).length === 1 &&
          isNameId(asNodes(stmt.targets)[0], "__all__");
    if (!assigned) {
      continue;
    }
    if (found !== undefined) {
      return { kind: "silence" };
    }
    found = stmt;
  }
  if (found === undefined) {
    return { kind: "absent" };
  }
  const names = listOfStrings(found.value);
  return names === undefined ? { kind: "silence" } : { kind: "names", names };
}

export function clearReexports(tree: PythonNode): Reexport[] {
  const out: Reexport[] = [];
  for (const stmt of asNodes(tree.body)) {
    if (stmt._type === "ImportFrom") {
      pushImportFromReexports(stmt, out);
    }
    if (stmt._type === "Assign") {
      pushAliasReexport(stmt, out);
    }
  }
  return out;
}

export function publicInitNames(unit: PythonSource): Set<string> | undefined {
  if (!isInitModule(unit.file)) {
    return undefined;
  }
  const all = readDunderAll(unit.tree);
  if (all.kind !== "names") {
    return new Set();
  }
  const names = new Set<string>();
  for (const item of all.names) {
    if (!item.name.startsWith("_")) {
      names.add(item.name);
    }
  }
  return names;
}

export function walkCallables(
  node: PythonNode,
  className: string,
  inFn: boolean,
  visit: (fn: PythonNode, className: string, nested: boolean) => void,
) {
  if (node._type === "FunctionDef" || node._type === "AsyncFunctionDef") {
    visit(node, className, inFn);
    for (const child of childNodes(node)) {
      walkCallables(child, "", true, visit);
    }
    return;
  }
  if (node._type === "ClassDef") {
    const next = typeof node.name === "string" ? node.name : className;
    for (const child of childNodes(node)) {
      walkCallables(child, next, inFn, visit);
    }
    return;
  }
  for (const child of childNodes(node)) {
    walkCallables(child, className, inFn, visit);
  }
}

export function isPublicCallable(
  fn: PythonNode,
  className: string,
  nested: boolean,
  initNames: Set<string> | undefined,
): boolean {
  if (nested || typeof fn.name !== "string") {
    return false;
  }
  if (fn.name.startsWith("_") || isDunder(fn.name) || className.startsWith("_")) {
    return false;
  }
  if (hasDecorator(fn, OVERLOAD)) {
    return false;
  }
  if (initNames !== undefined && !initNames.has(fn.name)) {
    return false;
  }
  return true;
}

function relativePosix(file: string, cwd: string): string {
  const slash = file.split("\\").join("/");
  const root = cwd.split("\\").join("/");
  return slash.startsWith(`${root}/`) ? slash.slice(root.length + 1) : slash;
}

function collectImport(
  stmt: PythonNode,
  unit: PythonSource,
  sources: ReadonlyMap<string, PythonSource>,
  modules: Map<string, string>,
) {
  for (const alias of asNodes(stmt.names)) {
    if (typeof alias.name !== "string") {
      continue;
    }
    if (alias.asname === undefined && alias.name.includes(".")) {
      continue;
    }
    bindModuleAlias(alias, unit, 0, sources, modules);
  }
}

function collectImportFrom(
  stmt: PythonNode,
  unit: PythonSource,
  sources: ReadonlyMap<string, PythonSource>,
  named: Map<string, NamedImport>,
  modules: Map<string, string>,
) {
  const level = typeof stmt.level === "number" ? stmt.level : 0;
  const module = typeof stmt.module === "string" ? stmt.module : undefined;
  if (module === undefined && level > 0) {
    for (const alias of asNodes(stmt.names)) {
      bindModuleAlias(alias, unit, level, sources, modules);
    }
    return;
  }
  const targetFile = resolveModuleFile(unit.file, module, level, unit.packageDir, sources);
  if (targetFile === undefined) {
    return;
  }
  for (const alias of asNodes(stmt.names)) {
    if (typeof alias.name !== "string" || alias.name === "*") {
      continue;
    }
    const local = typeof alias.asname === "string" ? alias.asname : alias.name;
    named.set(local, { file: targetFile, name: alias.name });
  }
}

function bindModuleAlias(
  alias: PythonNode,
  unit: PythonSource,
  level: number,
  sources: ReadonlyMap<string, PythonSource>,
  modules: Map<string, string>,
) {
  if (typeof alias.name === "string") {
    if (alias.name !== "*") {
      const local = typeof alias.asname === "string" ? alias.asname : alias.name;
      const target = resolveModuleFile(unit.file, alias.name, level, unit.packageDir, sources);
      if (target !== undefined) {
        modules.set(local, target);
      }
    }
  }
}

function moduleHit(base: string, sources: ReadonlyMap<string, PythonSource>): string | undefined {
  const py = `${base}.py`;
  if (sources.has(py)) {
    return py;
  }
  const init = join(base, "__init__.py");
  if (sources.has(init)) {
    return init;
  }
  const normalizedPy = resolve(py);
  if (sources.has(normalizedPy)) {
    return normalizedPy;
  }
  const normalizedInit = resolve(init);
  return sources.has(normalizedInit) ? normalizedInit : undefined;
}

function isUnwrappedCall(value: unknown): boolean {
  let current = value;
  while (isPythonNode(current) && current._type === "Await") {
    current = current.value;
  }
  return isPythonNode(current) && current._type === "Call";
}

function bodyLineCount(fn: PythonNode, text: string): number {
  const body = asNodes(fn.body);
  const first = body[0];
  const start =
    typeof first?.lineno === "number"
      ? first.lineno
      : typeof fn.lineno === "number"
        ? fn.lineno
        : 1;
  const end = typeof fn.end_lineno === "number" ? fn.end_lineno : start;
  const lines = text.split("\n");
  let count = 0;
  for (let line = start; line <= end; line += 1) {
    if ((lines[line - 1] ?? "").trim() !== "") {
      count += 1;
    }
  }
  return count;
}

function hasNestedControl(node: PythonNode, inside: boolean): boolean {
  if (NESTED_STOP.has(node._type)) {
    return false;
  }
  const control = CONTROL.has(node._type);
  if (control && inside) {
    return true;
  }
  for (const [field, value] of Object.entries(node)) {
    const elif = node._type === "If" && field === "orelse" && isElifList(value);
    const next = elif ? inside : inside || control;
    if (walkField(value, next)) {
      return true;
    }
  }
  return false;
}

function walkField(value: unknown, inside: boolean): boolean {
  if (isPythonNode(value)) {
    if (hasNestedControl(value, inside)) {
      return true;
    }
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      if (isPythonNode(item)) {
        if (hasNestedControl(item, inside)) {
          return true;
        }
      }
    }
  }
  return false;
}

function isElifList(value: unknown): boolean {
  if (Array.isArray(value)) {
    if (value.length === 1) {
      const only = value[0];
      if (isPythonNode(only)) {
        return only._type === "If";
      }
    }
  }
  return false;
}

function decoratorHits(dec: PythonNode, names: ReadonlySet<string>): boolean {
  if (dec._type === "Name" && typeof dec.id === "string") {
    return names.has(dec.id);
  }
  if (dec._type === "Attribute" && typeof dec.attr === "string") {
    return names.has(dec.attr);
  }
  if (dec._type === "Call" && isPythonNode(dec.func)) {
    return decoratorHits(dec.func, names);
  }
  return false;
}

function isNameId(node: unknown, id: string): boolean {
  return isPythonNode(node) && node._type === "Name" && node.id === id;
}

function listOfStrings(value: unknown): { name: string; node: PythonNode }[] | undefined {
  if (!isPythonNode(value) || (value._type !== "List" && value._type !== "Tuple")) {
    return undefined;
  }
  const names: { name: string; node: PythonNode }[] = [];
  for (const elt of asNodes(value.elts)) {
    const text =
      elt._type === "Constant" && typeof elt.value === "string"
        ? elt.value
        : elt._type === "Str" && typeof elt.s === "string"
          ? elt.s
          : undefined;
    if (text === undefined) {
      return undefined;
    }
    names.push({ name: text, node: elt });
  }
  return names;
}

function pushImportFromReexports(stmt: PythonNode, out: Reexport[]) {
  for (const alias of asNodes(stmt.names)) {
    if (typeof alias.name !== "string" || alias.name === "*") {
      continue;
    }
    const local = typeof alias.asname === "string" ? alias.asname : alias.name;
    if (!local.startsWith("_")) {
      out.push({ name: local, node: alias });
    }
  }
}

function pushAliasReexport(stmt: PythonNode, out: Reexport[]) {
  const targets = asNodes(stmt.targets);
  const target = targets[0];
  if (targets.length !== 1 || !isPythonNode(target) || target._type !== "Name") {
    return;
  }
  if (typeof target.id !== "string" || target.id.startsWith("_")) {
    return;
  }
  if (isPythonNode(stmt.value) && stmt.value._type === "Name") {
    out.push({ name: target.id, node: target });
  }
}
