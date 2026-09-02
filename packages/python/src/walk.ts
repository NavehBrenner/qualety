import { basename, dirname, join, resolve } from "node:path";
import type { PythonNode, PythonSource } from "./python.ts";

export type { PythonNode, PythonSource };

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

export type LoadRef = {
  file: string;
  name: string;
  owner: string | undefined;
  className: string;
  lineno: number;
};

export function collectLoadKeys(
  node: PythonNode,
  className: string,
  file: string,
  skip: (parent: PythonNode, child: PythonNode) => boolean,
  resolve: (ref: LoadRef) => string | undefined,
  nodeForKey: (key: string) => PythonNode | undefined,
  keys: Set<string>,
): void {
  walkLoadRefs(node, className, file, skip, (ref) => {
    const key = resolve(ref);
    if (key === undefined) {
      return;
    }
    const target = nodeForKey(key);
    if (target !== undefined && containsPos(target, ref.lineno)) {
      return;
    }
    keys.add(key);
  });
}

function walkLoadRefs(
  node: PythonNode,
  className: string,
  file: string,
  skip: (parent: PythonNode, child: PythonNode) => boolean,
  visit: (ref: LoadRef) => void,
): void {
  const nextClass =
    node._type === "ClassDef" && typeof node.name === "string" ? node.name : className;
  emitLoadRef(node, nextClass, file, visit);
  for (const child of childNodes(node)) {
    if (!skip(node, child)) {
      walkLoadRefs(child, nextClass, file, skip, visit);
    }
  }
}

function emitLoadRef(
  node: PythonNode,
  className: string,
  file: string,
  visit: (ref: LoadRef) => void,
): void {
  if (!isPythonNode(node.ctx) || node.ctx._type !== "Load") {
    return;
  }
  const lineno = typeof node.lineno === "number" ? node.lineno : 1;
  if (node._type === "Name") {
    if (typeof node.id === "string") {
      visit({ file, name: node.id, owner: undefined, className, lineno });
    }
    return;
  }
  if (node._type !== "Attribute" || typeof node.attr !== "string") {
    return;
  }
  if (!isPythonNode(node.value)) {
    return;
  }
  if (node.value._type !== "Name" || typeof node.value.id !== "string") {
    return;
  }
  visit({ file, name: node.attr, owner: node.value.id, className, lineno });
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
): void {
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

export function walkNodes(node: PythonNode, visit: (node: PythonNode) => void): void {
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

export function collectPathLoads(
  unit: PythonSource,
  groupSources: ReadonlyMap<string, PythonSource>,
): { modules: Map<string, string>; targets: Set<string> } {
  const modules = new Map<string, string>();
  const targets = new Set<string>();
  // ponytail: one name map per file, per-scope tables if nested rebinds collide
  const pathNames = new Map<string, string>();
  const specAndLoaderFiles = new Map<string, string>();
  walkNodes(unit.tree, (node) => {
    if (node._type === "Call") {
      const file = pathLoadFile(node, pathNames, unit, groupSources);
      if (file !== undefined) {
        targets.add(file);
      }
    }
    bindPathAssign(node, pathNames, specAndLoaderFiles, modules, unit, groupSources);
  });
  return { modules, targets };
}

export function scanPathLoadUses(
  group: readonly PythonSource[],
  allSources: ReadonlyMap<string, PythonSource>,
  cwd: string,
  tally: (unit: PythonSource, fileBinds: FileBinds | undefined) => void,
): Set<string> {
  const sources = new Map(group.map((unit) => [unit.file, unit]));
  const binds = new Map<string, FileBinds>();
  const loadTargets = new Set<string>();
  const boundFiles = new Set<string>();
  for (const unit of group) {
    const fileBinds = collectImports(unit, sources);
    mergePathLoads(unit, sources, fileBinds, loadTargets, boundFiles);
    binds.set(unit.file, fileBinds);
  }
  for (const unit of group) {
    tally(unit, binds.get(unit.file));
  }
  const packageDir = group[0]?.packageDir;
  for (const unit of allSources.values()) {
    if (
      unit.packageDir !== packageDir ||
      !isTestPath(unit.file, cwd) ||
      /(?:^|\/)(?:fixtures|__pycache__)(?:\/|$)/.test(relativePosix(unit.file, cwd))
    ) {
      continue;
    }
    const fileBinds: FileBinds = { named: new Map(), modules: new Map() };
    mergePathLoads(unit, sources, fileBinds, loadTargets, boundFiles);
    tally(unit, fileBinds);
  }
  const silenced = new Set<string>();
  for (const file of loadTargets) {
    if (!boundFiles.has(file)) {
      silenced.add(file);
    }
  }
  return silenced;
}

function mergePathLoads(
  unit: PythonSource,
  groupSources: ReadonlyMap<string, PythonSource>,
  fileBinds: FileBinds,
  loadTargets: Set<string>,
  boundFiles: Set<string>,
) {
  const loads = collectPathLoads(unit, groupSources);
  for (const [alias, file] of loads.modules) {
    fileBinds.modules.set(alias, file);
    boundFiles.add(file);
  }
  for (const file of loads.targets) {
    loadTargets.add(file);
  }
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
    const fromPackage = moduleHit(join(packageDir, ...parts), sources);
    if (fromPackage !== undefined) {
      return fromPackage;
    }
    return moduleHit(join(packageDir, "src", ...parts), sources);
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

export function tallyResolvedUse(
  key: string | undefined,
  target: { file: string; node: PythonNode } | undefined,
  refFile: string,
  lineno: number,
  counts: Map<string, number>,
): void {
  if (key === undefined) {
    return;
  }
  if (target !== undefined && refFile === target.file && containsPos(target.node, lineno)) {
    return;
  }
  counts.set(key, (counts.get(key) ?? 0) + 1);
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
): void {
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
    const text = stringConstant(elt);
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

function bindPathAssign(
  node: PythonNode,
  pathNames: Map<string, string>,
  specAndLoaderFiles: Map<string, string>,
  modules: Map<string, string>,
  unit: PythonSource,
  groupSources: ReadonlyMap<string, PythonSource>,
) {
  const name = assignedName(node);
  if (name === undefined || !isPythonNode(node.value)) {
    return;
  }
  const folded = foldPath(node.value, pathNames, unit);
  if (folded !== undefined) {
    pathNames.set(name, folded);
  }
  const file = pathLoadFile(node.value, pathNames, unit, groupSources);
  const callee = callName(node.value);
  if (
    file !== undefined &&
    (callee === "spec_from_file_location" || callee === "SourceFileLoader")
  ) {
    specAndLoaderFiles.set(name, file);
    return;
  }
  const loaded = moduleFromLoad(node.value, specAndLoaderFiles, pathNames, unit, groupSources);
  if (loaded !== undefined) {
    modules.set(name, loaded);
  }
}

function moduleFromLoad(
  value: PythonNode,
  specAndLoaderFiles: Map<string, string>,
  pathNames: Map<string, string>,
  unit: PythonSource,
  groupSources: ReadonlyMap<string, PythonSource>,
): string | undefined {
  if (value._type !== "Call" || !isPythonNode(value.func)) {
    return undefined;
  }
  const callee = callName(value);
  if (callee === "module_from_spec") {
    const spec = callArg(value, 0, ["spec"]);
    if (!isPythonNode(spec)) {
      return undefined;
    }
    if (spec._type === "Name" && typeof spec.id === "string") {
      return specAndLoaderFiles.get(spec.id);
    }
    return pathLoadFile(spec, pathNames, unit, groupSources);
  }
  if (
    callee !== "load_module" ||
    value.func._type !== "Attribute" ||
    !isPythonNode(value.func.value)
  ) {
    return undefined;
  }
  const loader = value.func.value;
  if (loader._type === "Name" && typeof loader.id === "string") {
    return specAndLoaderFiles.get(loader.id);
  }
  return pathLoadFile(loader, pathNames, unit, groupSources);
}

function pathLoadFile(
  node: PythonNode,
  pathNames: Map<string, string>,
  unit: PythonSource,
  groupSources: ReadonlyMap<string, PythonSource>,
): string | undefined {
  if (node._type !== "Call") {
    return undefined;
  }
  const callee = callName(node);
  const pathNode =
    callee === "spec_from_file_location"
      ? callArg(node, 1, ["location"])
      : callee === "SourceFileLoader"
        ? callArg(node, 1, ["path"])
        : callee === "run_path"
          ? callArg(node, 0, ["path", "path_name"])
          : undefined;
  if (pathNode === undefined) {
    return undefined;
  }
  const folded = foldPath(pathNode, pathNames, unit);
  if (folded === undefined) {
    return undefined;
  }
  const abs = resolve(dirname(unit.file), folded);
  return groupSources.has(abs) ? abs : undefined;
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: path-node dispatch; splitting recreates single-use helpers
function foldPath(
  node: PythonNode,
  pathNames: Map<string, string>,
  unit: PythonSource,
): string | undefined {
  const text = stringConstant(node);
  if (text !== undefined) {
    return text;
  }
  if (node._type === "JoinedStr") {
    return foldJoined(node, pathNames, unit);
  }
  if (node._type === "Name") {
    if (typeof node.id !== "string") {
      return undefined;
    }
    return node.id === "__file__" ? unit.file : pathNames.get(node.id);
  }
  if (node._type === "Attribute") {
    if (node.attr !== "parent" || !isPythonNode(node.value)) {
      return undefined;
    }
    const inner = foldPath(node.value, pathNames, unit);
    return inner === undefined ? undefined : dirname(inner);
  }
  if (node._type === "BinOp") {
    if (!isPythonNode(node.op) || node.op._type !== "Div") {
      return undefined;
    }
    if (!isPythonNode(node.left) || !isPythonNode(node.right)) {
      return undefined;
    }
    const leftPath = foldPath(node.left, pathNames, unit);
    const rightPath = foldPath(node.right, pathNames, unit);
    return leftPath === undefined || rightPath === undefined
      ? undefined
      : join(leftPath, rightPath);
  }
  if (node._type === "Subscript") {
    return foldParentsAt(node, pathNames, unit);
  }
  if (node._type === "Call") {
    return foldPathCall(node, pathNames, unit);
  }
  return undefined;
}

function foldJoined(
  node: PythonNode,
  pathNames: Map<string, string>,
  unit: PythonSource,
): string | undefined {
  let out = "";
  for (const part of asNodes(node.values)) {
    const bit = foldPath(part, pathNames, unit);
    if (bit === undefined) {
      return undefined;
    }
    out += bit;
  }
  return out;
}

function foldParentsAt(
  node: PythonNode,
  pathNames: Map<string, string>,
  unit: PythonSource,
): string | undefined {
  if (
    !isPythonNode(node.value) ||
    node.value._type !== "Attribute" ||
    node.value.attr !== "parents"
  ) {
    return undefined;
  }
  if (!isPythonNode(node.value.value)) {
    return undefined;
  }
  const index = intConstant(
    isPythonNode(node.slice)
      ? node.slice._type === "Index" && isPythonNode(node.slice.value)
        ? node.slice.value
        : node.slice
      : undefined,
  );
  if (index === undefined || index < 0) {
    return undefined;
  }
  const inner = foldPath(node.value.value, pathNames, unit);
  if (inner === undefined) {
    return undefined;
  }
  let out = inner;
  for (let step = 0; step <= index; step += 1) {
    out = dirname(out);
  }
  return out;
}

function foldPathCall(
  node: PythonNode,
  pathNames: Map<string, string>,
  unit: PythonSource,
): string | undefined {
  const callee = callName(node);
  if (callee === "join" || callee === "joinpath") {
    return foldJoinCall(node, pathNames, unit, callee === "joinpath");
  }
  if (callee === "dirname") {
    return foldOne(callArg(node, 0, []), pathNames, unit, dirname);
  }
  if (callee === "abspath" || callee === "realpath") {
    return foldOne(callArg(node, 0, []), pathNames, unit, (path) => path);
  }
  if (callee === "resolve" || callee === "absolute") {
    return foldReceiver(node, pathNames, unit);
  }
  if (callee === "Path") {
    return foldJoinCall(node, pathNames, unit, false);
  }
  if (callee === "str") {
    return foldOne(callArg(node, 0, []), pathNames, unit, (path) => path);
  }
  return undefined;
}

function foldJoinCall(
  node: PythonNode,
  pathNames: Map<string, string>,
  unit: PythonSource,
  withReceiver: boolean,
): string | undefined {
  const parts: string[] = [];
  if (withReceiver) {
    const base = foldReceiver(node, pathNames, unit);
    if (base === undefined) {
      return undefined;
    }
    parts.push(base);
  }
  for (const arg of asNodes(node.args)) {
    if (arg._type === "Starred") {
      return undefined;
    }
    const next = foldPath(arg, pathNames, unit);
    if (next === undefined) {
      return undefined;
    }
    parts.push(next);
  }
  return parts.length === 0 ? undefined : join(...parts);
}

function foldReceiver(
  node: PythonNode,
  pathNames: Map<string, string>,
  unit: PythonSource,
): string | undefined {
  if (
    !isPythonNode(node.func) ||
    node.func._type !== "Attribute" ||
    !isPythonNode(node.func.value)
  ) {
    return undefined;
  }
  return foldPath(node.func.value, pathNames, unit);
}

function foldOne(
  node: PythonNode | undefined,
  pathNames: Map<string, string>,
  unit: PythonSource,
  then: (path: string) => string,
): string | undefined {
  if (node === undefined) {
    return undefined;
  }
  const inner = foldPath(node, pathNames, unit);
  return inner === undefined ? undefined : then(inner);
}

function assignedName(node: PythonNode): string | undefined {
  if (node._type === "Assign") {
    const targets = asNodes(node.targets);
    const target = targets[0];
    if (targets.length === 1 && target?._type === "Name" && typeof target.id === "string") {
      return target.id;
    }
  }
  if (node._type === "AnnAssign" && isPythonNode(node.target)) {
    if (node.target._type === "Name" && typeof node.target.id === "string") {
      return node.target.id;
    }
  }
  return undefined;
}

function callName(node: PythonNode): string | undefined {
  const func = node._type === "Call" && isPythonNode(node.func) ? node.func : node;
  if (func._type === "Name" && typeof func.id === "string") {
    return func.id;
  }
  if (func._type === "Attribute" && typeof func.attr === "string") {
    return func.attr;
  }
  return undefined;
}

function callArg(
  node: PythonNode,
  index: number,
  names: readonly string[],
): PythonNode | undefined {
  const args = asNodes(node.args);
  const positional = args[index];
  if (positional !== undefined && positional._type !== "Starred") {
    return positional;
  }
  for (const keyword of asNodes(node.keywords)) {
    if (
      typeof keyword.arg === "string" &&
      names.includes(keyword.arg) &&
      isPythonNode(keyword.value)
    ) {
      return keyword.value;
    }
  }
  return undefined;
}

export function intConstant(node: PythonNode | undefined): number | undefined {
  if (node === undefined) {
    return undefined;
  }
  if (node._type === "Constant" && typeof node.value === "number") {
    return node.value;
  }
  if (node._type === "Num" && typeof node.n === "number") {
    return node.n;
  }
  return undefined;
}

export function stringConstant(node: PythonNode | undefined): string | undefined {
  if (!isPythonNode(node)) {
    return undefined;
  }
  switch (node._type) {
    case "Constant":
      return typeof node.value === "string" ? node.value : undefined;
    case "Str":
      return typeof node.s === "string" ? node.s : undefined;
    default:
      return undefined;
  }
}
