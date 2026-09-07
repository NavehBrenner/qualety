import { dirname, join, resolve } from "node:path";
import {
  asNodes,
  collectImports,
  isDunder,
  isPythonNode,
  type PythonNode,
  type PythonSource,
  stringConstant,
  walkNodes,
} from "@qualety/python/walk";
import type { RuleContext } from "qualety";

const SETUP_RANGE = { start: { line: 1, column: 1 }, end: { line: 1, column: 1 } };
const VERSION_RE = /(schema_)?version|_VERSION$/i;
const HASH_CALLEES = new Set([
  "update",
  "sha256",
  "sha1",
  "md5",
  "blake2b",
  "blake2s",
  "dumps",
  "hash",
]);
const CODE_DEFAULTS = ["CODE_VERSION", "GIT_SHA", "git_sha"];
const UNBOUND_HINT =
  "Name at least one fully-qualified callable in hashFunctions, or turn the rule off.";

export type BoundHashFn = {
  fq: string;
  unit: PythonSource;
  def: PythonNode;
};

function readOption(options: unknown, key: string): unknown {
  if (typeof options !== "object" || options === null) {
    return undefined;
  }
  for (const [name, value] of Object.entries(options)) {
    if (name === key) {
      return value;
    }
  }
  return undefined;
}

export function parseHashFunctions(options: unknown): string[] {
  return parseStringList(options, "hashFunctions");
}

export function parseStringList(options: unknown, key: string): string[] {
  const raw = readOption(options, key);
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw.filter((item): item is string => typeof item === "string" && item.length > 0);
}

export function parseExcludeFields(options: unknown): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  const raw = readOption(options, "excludeFields");
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return out;
  }
  for (const [typeName, fields] of Object.entries(raw)) {
    if (!Array.isArray(fields)) {
      continue;
    }
    const names = fields.filter((item): item is string => typeof item === "string");
    if (names.length > 0) {
      out.set(typeName, new Set(names));
    }
  }
  return out;
}

export function reportUnbound(context: Pick<RuleContext, "id" | "report" | "getFiles">): void {
  const files = context.getFiles();
  const file = files.includes("qualety.config.json")
    ? "qualety.config.json"
    : (files[0] ?? "qualety.config.json");
  context.report({
    severity: "warn",
    file,
    range: SETUP_RANGE,
    message: `${context.id} is enabled but hashFunctions is empty.`,
    suggestion: UNBOUND_HINT,
  });
}

export function bindHashFunctions(
  names: readonly string[],
  sources: ReadonlyMap<string, PythonSource>,
  cwd: string,
): BoundHashFn[] {
  const out: BoundHashFn[] = [];
  for (const fq of names) {
    const bound = resolveFq(fq, sources, cwd);
    if (bound !== undefined) {
      out.push(bound);
    }
  }
  return out;
}

export function missingConfigFields(
  bound: BoundHashFn,
  sources: ReadonlyMap<string, PythonSource>,
  exclude: ReadonlyMap<string, Set<string>>,
): string[] | undefined {
  const param = configParam(bound.def);
  if (param === undefined || !isPythonNode(param.annotation)) {
    return undefined;
  }
  const typeNode = unwrapType(param.annotation);
  const typeName = nameOf(typeNode);
  if (typeName === undefined) {
    return undefined;
  }
  const hit = resolveClass(typeName, bound.unit, sources);
  if (hit === undefined) {
    return undefined;
  }
  const fields = classFields(hit, sources, new Set());
  const holes = exclude.get(hit.name) ?? new Set();
  const reads = collectReads(bound.def, param.name, moduleCallables(bound.unit.tree), 0, new Set());
  return [...fields].filter((field) => !holes.has(field) && !reads.has(field)).sort();
}

export function hasVersionInPayload(bound: BoundHashFn, extraKeys: readonly string[]): boolean {
  return payloadMatches(bound, (name) => extraKeys.includes(name) || VERSION_RE.test(name));
}

// hasCodeVersionInPayload
export function hasCodeVersion(bound: BoundHashFn, extraNames: readonly string[]): boolean {
  return payloadMatches(bound, (name) => CODE_DEFAULTS.includes(name) || extraNames.includes(name));
}

function payloadMatches(bound: BoundHashFn, match: (name: string) => boolean): boolean {
  return foldHasName(bound.def, moduleCallables(bound.unit.tree), match, 0, new Set());
}

function resolveFq(
  fq: string,
  sources: ReadonlyMap<string, PythonSource>,
  cwd: string,
): BoundHashFn | undefined {
  const parts = fq.split(".").filter((part) => part.length > 0);
  if (parts.length < 2) {
    return undefined;
  }
  for (let index = parts.length - 1; index >= 1; index -= 1) {
    const rest = parts.slice(index);
    if (rest.length > 2) {
      continue;
    }
    const file = moduleFile(parts.slice(0, index).join("."), sources, cwd);
    if (file === undefined) {
      continue;
    }
    const unit = sources.get(file);
    if (unit === undefined) {
      continue;
    }
    const def =
      rest.length === 1
        ? moduleFn(unit.tree, rest[0] ?? "")
        : classMethod(unit.tree, rest[0] ?? "", rest[1] ?? "");
    if (def !== undefined) {
      return { fq, unit, def };
    }
  }
  return undefined;
}

function moduleFile(
  module: string,
  sources: ReadonlyMap<string, PythonSource>,
  cwd: string,
): string | undefined {
  const parts = module.split(".");
  const dirs = new Set<string>([cwd]);
  for (const unit of sources.values()) {
    dirs.add(unit.packageDir);
    dirs.add(dirname(unit.file));
  }
  for (const dir of dirs) {
    const hit =
      moduleHit(join(dir, ...parts), sources) ?? moduleHit(join(dir, "src", ...parts), sources);
    if (hit !== undefined) {
      return hit;
    }
  }
  return undefined;
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
  const resolvedPy = resolve(py);
  if (sources.has(resolvedPy)) {
    return resolvedPy;
  }
  const resolvedInit = resolve(init);
  return sources.has(resolvedInit) ? resolvedInit : undefined;
}

function moduleFn(tree: PythonNode, name: string): PythonNode | undefined {
  for (const stmt of asNodes(tree.body)) {
    if (isFn(stmt) && stmt.name === name) {
      return stmt;
    }
  }
  return undefined;
}

function classMethod(tree: PythonNode, className: string, method: string): PythonNode | undefined {
  for (const stmt of asNodes(tree.body)) {
    if (stmt._type !== "ClassDef" || stmt.name !== className) {
      continue;
    }
    for (const member of asNodes(stmt.body)) {
      if (isFn(member) && member.name === method) {
        return member;
      }
    }
  }
  return undefined;
}

function isFn(node: PythonNode): boolean {
  return node._type === "FunctionDef" || node._type === "AsyncFunctionDef";
}

function configParam(fn: PythonNode): { name: string; annotation: unknown } | undefined {
  if (!isPythonNode(fn.args) || fn.args._type !== "arguments") {
    return undefined;
  }
  const params = [
    ...asNodes(fn.args.posonlyargs),
    ...asNodes(fn.args.args),
    ...asNodes(fn.args.kwonlyargs),
  ];
  const named = params.find((param) => param.arg === "config" || param.arg === "cfg");
  if (named !== undefined && typeof named.arg === "string") {
    return { name: named.arg, annotation: named.annotation };
  }
  const first = params.find((param) => param.arg !== "self" && param.arg !== "cls");
  if (first !== undefined && typeof first.arg === "string") {
    return { name: first.arg, annotation: first.annotation };
  }
  return undefined;
}

function unwrapType(node: PythonNode): PythonNode {
  const fromSub = unwrapSubscript(node);
  if (fromSub !== undefined) {
    return unwrapType(fromSub);
  }
  const fromUnion = unwrapBitOr(node);
  if (fromUnion !== undefined) {
    return unwrapType(fromUnion);
  }
  return node;
}

function unwrapSubscript(node: PythonNode): PythonNode | undefined {
  if (node._type !== "Subscript" || !isPythonNode(node.value)) {
    return undefined;
  }
  const ctor = nameOf(node.value);
  const inner = sliceNode(node);
  if (inner === undefined) {
    return undefined;
  }
  if (ctor === "Optional") {
    return inner;
  }
  if (ctor !== "Union") {
    return undefined;
  }
  const elts = inner._type === "Tuple" ? asNodes(inner.elts) : [inner];
  const nonNone = elts.filter((elt) => !isNone(elt));
  return nonNone.length === 1 ? nonNone[0] : undefined;
}

function unwrapBitOr(node: PythonNode): PythonNode | undefined {
  if (node._type !== "BinOp" || !isPythonNode(node.op) || node.op._type !== "BitOr") {
    return undefined;
  }
  const left = isPythonNode(node.left) ? node.left : undefined;
  const right = isPythonNode(node.right) ? node.right : undefined;
  if (left === undefined || right === undefined) {
    return undefined;
  }
  if (isNone(right)) {
    return left;
  }
  return isNone(left) ? right : undefined;
}

function sliceNode(node: PythonNode): PythonNode | undefined {
  if (!isPythonNode(node.slice)) {
    return undefined;
  }
  if (node.slice._type === "Index" && isPythonNode(node.slice.value)) {
    return node.slice.value;
  }
  return node.slice;
}

function isNone(node: PythonNode): boolean {
  return node._type === "Constant" && node.value === null;
}

function nameOf(node: PythonNode): string | undefined {
  if (node._type === "Name" && typeof node.id === "string") {
    return node.id;
  }
  if (node._type === "Attribute" && typeof node.attr === "string") {
    return node.attr;
  }
  return undefined;
}

type ClassHit = { name: string; node: PythonNode; unit: PythonSource };

function resolveClass(
  name: string,
  unit: PythonSource,
  sources: ReadonlyMap<string, PythonSource>,
): ClassHit | undefined {
  const local = classDef(unit.tree, name);
  if (local !== undefined) {
    return { name, node: local, unit };
  }
  const imported = collectImports(unit, sources).named.get(name);
  if (imported === undefined) {
    return undefined;
  }
  const target = sources.get(imported.file);
  if (target === undefined) {
    return undefined;
  }
  const remote = classDef(target.tree, imported.name);
  if (remote === undefined) {
    return undefined;
  }
  return { name: imported.name, node: remote, unit: target };
}

function classDef(tree: PythonNode, name: string): PythonNode | undefined {
  for (const stmt of asNodes(tree.body)) {
    if (stmt._type === "ClassDef" && stmt.name === name) {
      return stmt;
    }
  }
  return undefined;
}

function classFields(
  hit: ClassHit,
  sources: ReadonlyMap<string, PythonSource>,
  seen: Set<string>,
): Set<string> {
  const key = `${hit.unit.file}::${hit.name}`;
  if (seen.has(key)) {
    return new Set();
  }
  seen.add(key);
  const fields = new Set<string>();
  for (const stmt of asNodes(hit.node.body)) {
    addAnnField(stmt, fields);
  }
  for (const base of asNodes(hit.node.bases)) {
    const baseName = nameOf(base);
    if (baseName === undefined) {
      continue;
    }
    const parent = resolveClass(baseName, hit.unit, sources);
    if (parent === undefined) {
      continue;
    }
    for (const field of classFields(parent, sources, seen)) {
      fields.add(field);
    }
  }
  return fields;
}

function addAnnField(stmt: PythonNode, fields: Set<string>): void {
  if (stmt._type !== "AnnAssign" || !isPythonNode(stmt.target)) {
    return;
  }
  if (stmt.target._type !== "Name" || typeof stmt.target.id !== "string") {
    return;
  }
  const id = stmt.target.id;
  if (isDunder(id) || isClassVar(stmt.annotation)) {
    return;
  }
  fields.add(id);
}

function isClassVar(annotation: unknown): boolean {
  if (
    !isPythonNode(annotation) ||
    annotation._type !== "Subscript" ||
    !isPythonNode(annotation.value)
  ) {
    return false;
  }
  return nameOf(annotation.value) === "ClassVar";
}

function moduleCallables(tree: PythonNode): Map<string, PythonNode> {
  const out = new Map<string, PythonNode>();
  for (const stmt of asNodes(tree.body)) {
    if (isFn(stmt) && typeof stmt.name === "string") {
      out.set(stmt.name, stmt);
    }
  }
  return out;
}

function collectReads(
  fn: PythonNode,
  configName: string,
  callables: ReadonlyMap<string, PythonNode>,
  depth: number,
  seen: Set<PythonNode>,
): Set<string> {
  const reads = new Set<string>();
  if (seen.has(fn) || depth > 2) {
    return reads;
  }
  seen.add(fn);
  walkNodes(fn, (node) => {
    addConfigRead(node, configName, reads);
    if (depth >= 2) {
      return;
    }
    const callee = namedCallee(node, callables);
    if (callee === undefined) {
      return;
    }
    const passed = forwardedName(node, callee, configName);
    if (passed === undefined) {
      return;
    }
    for (const field of collectReads(callee, passed, callables, depth + 1, seen)) {
      reads.add(field);
    }
  });
  return reads;
}

function addConfigRead(node: PythonNode, configName: string, reads: Set<string>): void {
  if (
    node._type === "Attribute" &&
    isNameId(node.value, configName) &&
    typeof node.attr === "string"
  ) {
    reads.add(node.attr);
    return;
  }
  if (node._type === "Subscript" && isNameId(node.value, configName)) {
    const key = subscriptKey(node);
    if (key !== undefined) {
      reads.add(key);
    }
    return;
  }
  if (node._type !== "Call" || calleeName(node) !== "getattr") {
    return;
  }
  const args = asNodes(node.args);
  const key = stringConstant(args[1]);
  if (isNameId(args[0], configName) && key !== undefined) {
    reads.add(key);
  }
}

function isNameId(node: unknown, id: string): boolean {
  return isPythonNode(node) && node._type === "Name" && node.id === id;
}

function subscriptKey(node: PythonNode): string | undefined {
  if (!isPythonNode(node.slice)) {
    return undefined;
  }
  if (node.slice._type === "Index" && isPythonNode(node.slice.value)) {
    return stringConstant(node.slice.value);
  }
  return stringConstant(node.slice);
}

function foldHasName(
  fn: PythonNode,
  callables: ReadonlyMap<string, PythonNode>,
  match: (name: string) => boolean,
  depth: number,
  seen: Set<PythonNode>,
): boolean {
  if (seen.has(fn) || depth > 2) {
    return false;
  }
  seen.add(fn);
  let found = false;
  walkNodes(fn, (node) => {
    if (found) {
      return;
    }
    if (isHashFold(node) && argsMatch(node, match)) {
      found = true;
      return;
    }
    if (depth >= 2) {
      return;
    }
    const callee = namedCallee(node, callables);
    if (callee !== undefined && foldHasName(callee, callables, match, depth + 1, seen)) {
      found = true;
    }
  });
  return found;
}

function argsMatch(call: PythonNode, match: (name: string) => boolean): boolean {
  const args = [
    ...asNodes(call.args),
    ...asNodes(call.keywords).flatMap((keyword) =>
      isPythonNode(keyword.value) ? [keyword.value] : [],
    ),
  ];
  let found = false;
  for (const arg of args) {
    walkNodes(arg, (node) => {
      const name = symbolName(node);
      if (name !== undefined && match(name)) {
        found = true;
      }
    });
  }
  return found;
}

function isHashFold(node: PythonNode): boolean {
  if (node._type !== "Call") {
    return false;
  }
  const name = calleeName(node);
  return name !== undefined && HASH_CALLEES.has(name);
}

function calleeName(node: PythonNode): string | undefined {
  return isPythonNode(node.func) ? nameOf(node.func) : undefined;
}

function namedCallee(
  node: PythonNode,
  callables: ReadonlyMap<string, PythonNode>,
): PythonNode | undefined {
  if (node._type !== "Call" || !isPythonNode(node.func) || node.func._type !== "Name") {
    return undefined;
  }
  if (typeof node.func.id !== "string") {
    return undefined;
  }
  return callables.get(node.func.id);
}

function forwardedName(
  call: PythonNode,
  callee: PythonNode,
  configName: string,
): string | undefined {
  const params = fnParamNames(callee);
  const args = asNodes(call.args);
  for (let index = 0; index < args.length; index += 1) {
    if (!isNameId(args[index], configName)) {
      continue;
    }
    const param = params[index];
    if (param !== undefined && param !== "self" && param !== "cls") {
      return param;
    }
  }
  for (const keyword of asNodes(call.keywords)) {
    if (typeof keyword.arg === "string" && isNameId(keyword.value, configName)) {
      return keyword.arg;
    }
  }
  return undefined;
}

function fnParamNames(fn: PythonNode): string[] {
  if (!isPythonNode(fn.args) || fn.args._type !== "arguments") {
    return [];
  }
  const params = [...asNodes(fn.args.posonlyargs), ...asNodes(fn.args.args)];
  const names: string[] = [];
  for (const param of params) {
    if (typeof param.arg === "string") {
      names.push(param.arg);
    }
  }
  return names;
}

function symbolName(node: PythonNode): string | undefined {
  if (node._type === "Name" && typeof node.id === "string") {
    return node.id;
  }
  if (node._type === "Attribute" && typeof node.attr === "string") {
    return node.attr;
  }
  return stringConstant(node);
}
