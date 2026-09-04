import {
  asNodes,
  collectImports,
  containsPos,
  isPythonNode,
  type PythonNode,
  type PythonSource,
  stringConstant,
  walkNodes,
} from "@qualety/python/walk";
import {
  attrChain,
  callKeyword,
  collectTrainingEntries,
  forEachMlSource,
  isBackwardCall,
  isDataLoaderCall,
  lastAttr,
  optionsSchema,
  treeHas,
  walkSkipDefs,
} from "./ast.ts";

const DEFAULT_WRITER_NAME = "save_metadata";

const VERSION_KEYS = new Set([
  "git_commit",
  "git_sha",
  "git_rev",
  "code_version",
  "code_rev",
  "behaviour_version",
  "behavior_version",
]);

const WRITE_MODES = new Set(["w", "wb", "a"]);

export type GateSite = {
  unit: PythonSource;
  node: PythonNode;
  scope: PythonNode;
};

export type PayloadShape = {
  proven: boolean;
  keys: Set<string>;
  names: Set<string>;
};

export function parseWriterName(options: unknown): string {
  const parsed = optionsSchema.parse(options);
  const raw = parsed.writerName;
  return typeof raw === "string" && raw.length > 0 ? raw : DEFAULT_WRITER_NAME;
}

export function collectGateSites(
  sources: ReadonlyMap<string, PythonSource>,
  cwd: string,
  extraEntries: readonly string[],
): GateSite[] {
  const sites: GateSite[] = [];
  forEachMlSource(sources, cwd, { trainingOnly: false }, (unit) => {
    if (treeHas(unit.tree, (node) => isBackwardCall(node) || isDataLoaderCall(node))) {
      for (const entry of collectTrainingEntries(unit, extraEntries)) {
        addSite(sites, { unit, node: entry.node, scope: entry.node });
      }
    }
  });
  for (const artifactSave of collectArtifactSaves(sources, cwd)) {
    addSite(sites, artifactSave);
  }
  return sites;
}

export function collectArtifactSaves(
  sources: ReadonlyMap<string, PythonSource>,
  cwd: string,
): GateSite[] {
  const sites: GateSite[] = [];
  forEachMlSource(sources, cwd, { trainingOnly: false }, (unit) => {
    walkNodes(unit.tree, (node) => {
      if (!isArtifactSave(node)) {
        return;
      }
      sites.push({
        unit,
        node,
        scope: enclosingDef(unit.tree, node) ?? unit.tree,
      });
    });
  });
  return sites;
}

export function resolveWriter(
  unit: PythonSource,
  writerName: string,
  sources: ReadonlyMap<string, PythonSource>,
): { unit: PythonSource; def: PythonNode } | undefined {
  const local = moduleWriterDef(unit.tree, writerName);
  if (local !== undefined) {
    return { unit, def: local };
  }
  const named = collectImports(unit, sources).named.get(writerName);
  if (named === undefined) {
    return undefined;
  }
  const target = sources.get(named.file);
  if (target === undefined) {
    return undefined;
  }
  const def = moduleWriterDef(target.tree, named.name);
  return def === undefined ? undefined : { unit: target, def };
}

export function bodyWrites(fn: PythonNode): boolean {
  let dump = false;
  let pathWrite = false;
  let opened = false;
  let wrote = false;
  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: inlined open-write mode
  walkNodes(fn, (node) => {
    if (node._type !== "Call") {
      return;
    }
    const name = lastAttr(node.func);
    if (name === "dump" || name === "safe_dump") {
      dump = true;
    }
    if (name === "write_text" || name === "write_bytes") {
      pathWrite = true;
    }
    if (name === "write") {
      wrote = true;
    }
    if (name === "open") {
      const mode =
        stringConstant(callKeyword(node, "mode")) ?? stringConstant(asNodes(node.args)[1]) ?? "";
      if (WRITE_MODES.has(mode)) {
        opened = true;
      }
    }
  });
  return dump || pathWrite || (opened && wrote);
}

export function collectPayload(
  writerDef: PythonNode,
  scope: PythonNode,
  writerName: string,
): PayloadShape {
  const payload: PayloadShape = { proven: false, keys: new Set(), names: new Set() };
  walkNodes(writerDef, (node) => {
    takeDict(node, payload);
    takeEnv(node, payload);
  });
  walkScope(scope, (node) => {
    if (node._type !== "Call" || lastAttr(node.func) !== writerName) {
      return;
    }
    takeCallPayload(node, scope, payload);
  });
  return payload;
}

export function hasCodeVersion(payload: PayloadShape): boolean {
  for (const key of payload.keys) {
    if (VERSION_KEYS.has(key.toLowerCase())) {
      return true;
    }
  }
  for (const name of payload.names) {
    if (VERSION_KEYS.has(name.toLowerCase())) {
      return true;
    }
  }
  return false;
}

export function requiredMetadataNames(unit: PythonSource, scope: PythonNode): Set<string> {
  const names = new Set<string>();
  walkNodes(unit.tree, (node) => {
    const dest = argumentDest(node);
    if (dest !== undefined) {
      names.add(dest);
    }
  });
  const constructed = constructedConfig(unit.tree, scope);
  if (constructed !== undefined) {
    for (const field of classFields(constructed)) {
      names.add(field);
    }
  }
  return names;
}

function addSite(sites: GateSite[], site: GateSite): void {
  if (sites.some((item) => item.unit.file === site.unit.file && item.scope === site.scope)) {
    return;
  }
  sites.push(site);
}

export function isArtifactSave(node: PythonNode): boolean {
  if (node._type !== "Call") {
    return false;
  }
  const chain = attrChain(node.func);
  const tail = chain[chain.length - 1];
  if (tail === "save" && chain[0] === "torch") {
    return true;
  }
  return tail === "dump" && chain[0] === "joblib";
}

function enclosingDef(tree: PythonNode, target: PythonNode): PythonNode | undefined {
  const line = typeof target.lineno === "number" ? target.lineno : 1;
  let found: PythonNode | undefined;
  for (const stmt of asNodes(tree.body)) {
    if (stmt._type !== "FunctionDef" && stmt._type !== "AsyncFunctionDef") {
      continue;
    }
    if (containsPos(stmt, line)) {
      found = stmt;
    }
  }
  return found;
}

function moduleWriterDef(tree: PythonNode, writerName: string): PythonNode | undefined {
  for (const stmt of asNodes(tree.body)) {
    if (stmt._type !== "FunctionDef" && stmt._type !== "AsyncFunctionDef") {
      continue;
    }
    if (stmt.name === writerName) {
      return stmt;
    }
  }
  return undefined;
}

function moduleDefs(tree: PythonNode): Map<string, PythonNode> {
  const defs = new Map<string, PythonNode>();
  for (const stmt of asNodes(tree.body)) {
    if (stmt._type !== "FunctionDef" && stmt._type !== "AsyncFunctionDef") {
      continue;
    }
    if (typeof stmt.name === "string") {
      defs.set(stmt.name, stmt);
    }
  }
  return defs;
}

export function reachableNames(scope: PythonNode, tree: PythonNode): Set<string> {
  const defs = moduleDefs(tree);
  const seen = new Set<string>();
  const queue: PythonNode[] = [scope];
  while (queue.length > 0) {
    const node = queue.pop();
    if (node === undefined) {
      continue;
    }
    for (const name of directCalls(node)) {
      if (seen.has(name)) {
        continue;
      }
      seen.add(name);
      const def = defs.get(name);
      if (def !== undefined) {
        queue.push(def);
      }
    }
  }
  return seen;
}

function directCalls(scope: PythonNode): Set<string> {
  const names = new Set<string>();
  walkScope(scope, (node) => {
    if (node._type === "Call") {
      const name = lastAttr(node.func);
      if (name !== undefined) {
        names.add(name);
      }
    }
  });
  return names;
}

function takeCallPayload(node: PythonNode, scope: PythonNode, payload: PayloadShape): void {
  for (const keyword of asNodes(node.keywords)) {
    if (typeof keyword.arg === "string") {
      payload.proven = true;
      payload.keys.add(keyword.arg);
    }
    if (isPythonNode(keyword.value)) {
      addPayloadNames(keyword.value, payload.names);
    }
  }
  for (const arg of asNodes(node.args)) {
    takeDict(arg, payload);
    if (arg._type === "Name" && typeof arg.id === "string") {
      const bound = boundDict(scope, arg.id);
      if (bound !== undefined) {
        takeDict(bound, payload);
      }
    }
  }
}

function takeDict(node: PythonNode, payload: PayloadShape): void {
  if (node._type !== "Dict") {
    return;
  }
  payload.proven = true;
  for (const key of asNodes(node.keys)) {
    const text = stringConstant(key);
    if (text !== undefined) {
      payload.keys.add(text);
    }
  }
  for (const value of asNodes(node.values)) {
    addPayloadNames(value, payload.names);
  }
}

function takeEnv(node: PythonNode, payload: PayloadShape): void {
  if (node._type === "Subscript") {
    const chain = attrChain(node.value);
    if (chain.includes("environ")) {
      const key = stringConstant(isPythonNode(node.slice) ? node.slice : undefined);
      if (key !== undefined) {
        payload.keys.add(key);
      }
    }
    return;
  }
  if (node._type !== "Call") {
    return;
  }
  const name = lastAttr(node.func);
  const chain = attrChain(node.func);
  if (name !== "getenv" && !(name === "get" && chain.includes("environ"))) {
    return;
  }
  const key = stringConstant(asNodes(node.args)[0]);
  if (key !== undefined) {
    payload.keys.add(key);
  }
}

function addPayloadNames(node: PythonNode, names: Set<string>): void {
  if (node._type === "Name" && typeof node.id === "string") {
    names.add(node.id);
  }
}

function boundDict(scope: PythonNode, name: string): PythonNode | undefined {
  let found: PythonNode | undefined;
  for (const stmt of asNodes(scope.body)) {
    if (stmt._type !== "Assign") {
      continue;
    }
    const target = asNodes(stmt.targets)[0];
    if (
      target?._type === "Name" &&
      target.id === name &&
      isPythonNode(stmt.value) &&
      stmt.value._type === "Dict"
    ) {
      found = stmt.value;
    }
  }
  return found;
}

function argumentDest(node: PythonNode): string | undefined {
  if (node._type !== "Call" || lastAttr(node.func) !== "add_argument") {
    return undefined;
  }
  const dest = stringConstant(callKeyword(node, "dest"));
  if (dest !== undefined) {
    return dest;
  }
  let short: string | undefined;
  for (const arg of asNodes(node.args)) {
    const flag = stringConstant(arg);
    if (flag === undefined) {
      continue;
    }
    if (flag.startsWith("--")) {
      return flag.slice(2).replaceAll("-", "_");
    }
    if (!flag.startsWith("-")) {
      return flag;
    }
    short ??= flag.replace(/^--?/, "").replaceAll("-", "_");
  }
  return short;
}

function constructedConfig(tree: PythonNode, scope: PythonNode): PythonNode | undefined {
  const classes = new Map<string, PythonNode>();
  for (const stmt of asNodes(tree.body)) {
    if (stmt._type === "ClassDef" && typeof stmt.name === "string" && isConfigClass(stmt)) {
      classes.set(stmt.name, stmt);
    }
  }
  if (classes.size === 0) {
    return undefined;
  }
  const hits: PythonNode[] = [];
  walkScope(scope, (node) => {
    if (node._type !== "Call") {
      return;
    }
    const name = lastAttr(node.func);
    const cls = name === undefined ? undefined : classes.get(name);
    if (cls !== undefined && !hits.includes(cls)) {
      hits.push(cls);
    }
  });
  return hits.length === 1 ? hits[0] : undefined;
}

function isConfigClass(cls: PythonNode): boolean {
  for (const dec of asNodes(cls.decorator_list)) {
    const name = dec._type === "Call" ? lastAttr(dec.func) : lastAttr(dec);
    if (name === "dataclass" || name === "define") {
      return true;
    }
  }
  return asNodes(cls.bases).some((base) => lastAttr(base) === "BaseModel");
}

function classFields(cls: PythonNode): string[] {
  const fields: string[] = [];
  for (const stmt of asNodes(cls.body)) {
    if (stmt._type !== "AnnAssign" || !isPythonNode(stmt.target)) {
      continue;
    }
    if (stmt.target._type === "Name" && typeof stmt.target.id === "string") {
      fields.push(stmt.target.id);
    }
  }
  return fields;
}

function walkScope(scope: PythonNode, visit: (node: PythonNode) => void): void {
  const stmts = asNodes(scope.body);
  const roots = stmts.length > 0 ? stmts : [scope];
  for (const stmt of roots) {
    walkSkipDefs(stmt, visit);
  }
}
