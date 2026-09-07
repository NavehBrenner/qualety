import { dirname, join, resolve } from "node:path";
import {
  asNodes,
  collectImports,
  isDunder,
  isPythonNode,
  nameRange,
  type PythonNode,
  type PythonSource,
  stringConstant,
  walkNodes,
} from "@qualety/python/walk";
import type { RuleContext } from "qualety";

const SETUP_RANGE = { start: { line: 1, column: 1 }, end: { line: 1, column: 1 } };
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
const UNBOUND_HINT =
  "Name at least one fully-qualified callable in hashFunctions, or turn the rule off.";

type BoundHashFn = {
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

function parseStringList(options: unknown, key: string): string[] {
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
  const reads = new Set<string>();
  walkBoundFunction(
    bound.def,
    param.name,
    moduleCallables(bound.unit.tree),
    forwardedName,
    (node, configName) => {
      addConfigRead(node, configName, reads);
    },
  );
  return [...fields].filter((field) => !holes.has(field) && !reads.has(field)).sort();
}

export function boundPayloadRule(spec: {
  extraKey: string;
  match: (name: string, extra: readonly string[]) => boolean;
  message: (fq: string) => string;
  suggestion: string;
}): (context: RuleContext<["python"]>) => void {
  return (context) => {
    const names = parseHashFunctions(context.options);
    if (names.length === 0) {
      reportUnbound(context);
      return;
    }
    const extra = parseStringList(context.options, spec.extraKey);
    const python = context.getArtifact("python");
    for (const bound of bindHashFunctions(names, python.sources, context.getCwd())) {
      if (payloadContains(bound, (name) => spec.match(name, extra))) {
        continue;
      }
      context.report({
        severity: "error",
        file: bound.unit.file,
        range: nameRange(bound.def),
        message: spec.message(bound.fq),
        suggestion: spec.suggestion,
      });
    }
  };
}

function payloadContains(bound: BoundHashFn, match: (name: string) => boolean): boolean {
  let found = false;
  walkBoundFunction(
    bound.def,
    null,
    moduleCallables(bound.unit.tree),
    () => null,
    (node) => {
      if (found || node._type !== "Call") {
        return;
      }
      const name = calleeName(node);
      if (name !== undefined && HASH_CALLEES.has(name) && argsMatch(node, match)) {
        found = true;
      }
    },
  );
  return found;
}

function walkBoundFunction<State>(
  start: PythonNode,
  startState: State,
  callables: ReadonlyMap<string, PythonNode>,
  nextState: (call: PythonNode, callee: PythonNode, state: State) => State | undefined,
  visit: (node: PythonNode, state: State) => void,
): void {
  const seen = new Set<PythonNode>();
  const stack: { fn: PythonNode; state: State; depth: number }[] = [
    { fn: start, state: startState, depth: 0 },
  ];
  while (stack.length > 0) {
    const item = stack.pop();
    if (item === undefined || seen.has(item.fn) || item.depth > 2) {
      continue;
    }
    seen.add(item.fn);
    walkNodes(item.fn, (node) => {
      visit(node, item.state);
      if (item.depth >= 2) {
        return;
      }
      const callee = namedCallee(node, callables);
      if (callee === undefined) {
        return;
      }
      const next = nextState(node, callee, item.state);
      if (next !== undefined) {
        stack.push({ fn: callee, state: next, depth: item.depth + 1 });
      }
    });
  }
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
    for (const root of [join(dir, ...parts), join(dir, "src", ...parts)]) {
      const hit = [`${root}.py`, join(root, "__init__.py")]
        .flatMap((path) => [path, resolve(path)])
        .find((path) => sources.has(path));
      if (hit !== undefined) {
        return hit;
      }
    }
  }
  return undefined;
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
  const cls = classDef(tree, className);
  if (cls === undefined) {
    return undefined;
  }
  for (const member of asNodes(cls.body)) {
    if (isFn(member) && member.name === method) {
      return member;
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

function sliceNode(node: PythonNode): PythonNode | undefined {
  if (!isPythonNode(node.slice)) {
    return undefined;
  }
  if (node.slice._type === "Index" && isPythonNode(node.slice.value)) {
    return node.slice.value;
  }
  return node.slice;
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
  if (isDunder(id)) {
    return;
  }
  if (
    isPythonNode(stmt.annotation) &&
    stmt.annotation._type === "Subscript" &&
    isPythonNode(stmt.annotation.value) &&
    nameOf(stmt.annotation.value) === "ClassVar"
  ) {
    return;
  }
  fields.add(id);
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
    const inner = sliceNode(node);
    const key = inner === undefined ? undefined : stringConstant(inner);
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

function calleeName(node: PythonNode): string | undefined {
  return isPythonNode(node.func) ? nameOf(node.func) : undefined;
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
      const name = nameOf(node) ?? stringConstant(node);
      if (name !== undefined && match(name)) {
        found = true;
      }
    });
  }
  return found;
}

function namedCallee(
  node: PythonNode,
  callables: ReadonlyMap<string, PythonNode>,
): PythonNode | undefined {
  if (node._type === "Call" && isPythonNode(node.func) && node.func._type === "Name") {
    if (typeof node.func.id === "string") {
      return callables.get(node.func.id);
    }
  }
  return undefined;
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
