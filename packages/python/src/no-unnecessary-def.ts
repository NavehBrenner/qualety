import { basename, dirname, join, resolve } from "node:path";
import { defineRule, type RuleContext } from "qualety";
import type { PythonNode, PythonSource } from "./python.ts";

const FUNCTION_SUGGESTION =
  "Inline at its only call site, or keep only if the name still hides real complexity; wait for a second real call site before keeping a pass-through.";
const UNUSED_FN_HINT =
  "Remove this helper, or wait for a second real call site before keeping the indirection.";
const MAX_NONBLANK_LINES = 10;
const DUNDER = /^__\w+__$/;
const CONTROL = new Set(["If", "For", "AsyncFor", "While", "Try", "Match"]);
const NESTED_STOP = new Set(["FunctionDef", "AsyncFunctionDef", "ClassDef", "Lambda"]);

type Def = {
  file: string;
  name: string;
  className: string;
  node: PythonNode;
  text: string;
  quiet: boolean;
};

type NamedImport = { file: string; name: string };

type FileBinds = {
  named: Map<string, NamedImport>;
  modules: Map<string, string>;
};

export const noUnnecessaryDef = defineRule({
  meta: {
    requires: ["python"],
    docs: {
      description:
        "Do not keep a local def that does not pay for its indirection (single-use helpers).",
    },
  },
  create(context) {
    const artifact = context.getArtifact("python");
    if (!(artifact.sources instanceof Map)) {
      return;
    }
    const scannedByPackage = new Map<string, PythonSource[]>();
    for (const [abs, unit] of artifact.sources) {
      if (isSkippedSource(abs, context.getCwd())) {
        continue;
      }
      const group = scannedByPackage.get(unit.packageDir) ?? [];
      if (group.length === 0) {
        scannedByPackage.set(unit.packageDir, group);
      }
      group.push(unit);
    }
    for (const group of scannedByPackage.values()) {
      scanPackageGroup(group, context);
    }
  },
});

function scanPackageGroup(group: readonly PythonSource[], context: Pick<RuleContext, "report">) {
  const defs: Def[] = [];
  const binds = new Map<string, FileBinds>();
  const sources = new Map(group.map((unit) => [unit.file, unit]));
  for (const unit of group) {
    const quiet = basename(unit.file) === "__init__.py";
    binds.set(unit.file, collectImports(unit, sources));
    collectDefs(unit.tree, "", unit, quiet, defs);
  }
  const callCounts = new Map<string, number>();
  const byKey = new Map(defs.map((def) => [defKey(def), def]));
  for (const unit of group) {
    walkCalls(unit.tree, "", unit.file, (call) => {
      tallyCall(call, binds.get(unit.file), defs, byKey, callCounts);
    });
  }
  for (const def of defs) {
    considerDef(def, context, callCounts);
  }
}

function considerDef(
  def: Def,
  context: Pick<RuleContext, "report">,
  callCounts: ReadonlyMap<string, number>,
) {
  if (def.quiet || DUNDER.test(def.name)) {
    return;
  }
  const uses = callCounts.get(defKey(def)) ?? 0;
  if (uses > 1 || (!isPassThrough(def.node) && !isSmallAndFlat(def.node, def.text))) {
    return;
  }
  context.report({
    severity: "error",
    file: def.file,
    range: nameRange(def.node),
    message:
      uses === 0
        ? `"${def.name}" is not called and does not pay for the indirection.`
        : `"${def.name}" is only called once and does not pay for the indirection.`,
    suggestion: uses === 0 ? UNUSED_FN_HINT : FUNCTION_SUGGESTION,
  });
}

function collectImports(unit: PythonSource, sources: ReadonlyMap<string, PythonSource>): FileBinds {
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
    const local = typeof alias.asname === "string" ? alias.asname : alias.name;
    const target = resolveModuleFile(unit.file, alias.name, 0, unit.packageDir, sources);
    if (target !== undefined) {
      modules.set(local, target);
    }
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

function collectDefs(
  node: PythonNode,
  className: string,
  unit: PythonSource,
  quiet: boolean,
  defs: Def[],
) {
  if (node._type === "FunctionDef" || node._type === "AsyncFunctionDef") {
    if (typeof node.name === "string") {
      defs.push({ file: unit.file, name: node.name, className, node, text: unit.text, quiet });
    }
    for (const child of childNodes(node)) {
      collectDefs(child, "", unit, quiet, defs);
    }
    return;
  }
  if (node._type === "ClassDef") {
    const next = typeof node.name === "string" ? node.name : className;
    for (const child of childNodes(node)) {
      collectDefs(child, next, unit, quiet, defs);
    }
    return;
  }
  for (const child of childNodes(node)) {
    collectDefs(child, className, unit, quiet, defs);
  }
}

function tallyCall(
  call: RawCall,
  fileBinds: FileBinds | undefined,
  defs: readonly Def[],
  byKey: ReadonlyMap<string, Def>,
  counts: Map<string, number>,
) {
  const key = resolveCall(call, fileBinds, defs);
  if (key === undefined) {
    return;
  }
  const def = byKey.get(key);
  if (def !== undefined) {
    if (containsPos(def.node, call.lineno)) {
      return;
    }
  }
  counts.set(key, (counts.get(key) ?? 0) + 1);
}

function containsPos(node: PythonNode, lineno: number): boolean {
  if (typeof node.lineno === "number") {
    const end = typeof node.end_lineno === "number" ? node.end_lineno : node.lineno;
    if (lineno >= node.lineno) {
      if (lineno <= end) {
        return true;
      }
    }
  }
  return false;
}

type RawCall = {
  file: string;
  name: string;
  owner: string | undefined;
  className: string;
  lineno: number;
};

function walkCalls(
  node: PythonNode,
  className: string,
  file: string,
  visit: (call: RawCall) => void,
) {
  if (node._type === "ClassDef") {
    const next = typeof node.name === "string" ? node.name : className;
    for (const child of childNodes(node)) {
      walkCalls(child, next, file, visit);
    }
    return;
  }
  if (node._type === "Call") {
    const raw = rawCall(node, className, file);
    if (raw !== undefined) {
      visit(raw);
    }
  }
  for (const child of childNodes(node)) {
    walkCalls(child, className, file, visit);
  }
}

function rawCall(node: PythonNode, className: string, file: string): RawCall | undefined {
  const lineno = typeof node.lineno === "number" ? node.lineno : 1;
  const func = node.func;
  if (!isPythonNode(func)) {
    return undefined;
  }
  if (func._type === "Name" && typeof func.id === "string") {
    return { file, name: func.id, owner: undefined, className, lineno };
  }
  if (func._type !== "Attribute" || typeof func.attr !== "string" || !isPythonNode(func.value)) {
    return undefined;
  }
  if (func.value._type !== "Name" || typeof func.value.id !== "string") {
    return undefined;
  }
  return { file, name: func.attr, owner: func.value.id, className, lineno };
}

function resolveCall(
  call: RawCall,
  fileBinds: FileBinds | undefined,
  defs: readonly Def[],
): string | undefined {
  const owner = call.owner;
  if (owner === "self" || owner === "cls") {
    return findDefKey(defs, call.file, call.name, call.className);
  }
  if (typeof owner === "string") {
    const moduleFile = fileBinds?.modules.get(owner);
    if (moduleFile === undefined) {
      return undefined;
    }
    return findDefKey(defs, moduleFile, call.name, "");
  }
  const imported = fileBinds?.named.get(call.name);
  if (imported !== undefined) {
    return findDefKey(defs, imported.file, imported.name, "");
  }
  return findDefKey(defs, call.file, call.name, "");
}

function findDefKey(
  defs: readonly Def[],
  file: string,
  name: string,
  className: string,
): string | undefined {
  const hits = defs.filter(
    (def) => def.file === file && def.name === name && def.className === className,
  );
  const hit = hits[0];
  return hits.length === 1 && hit !== undefined ? defKey(hit) : undefined;
}

function defKey(def: Pick<Def, "file" | "name" | "className" | "node">): string {
  return `${def.file}:${def.node.lineno}:${def.name}:${def.className}`;
}

function isPassThrough(fn: PythonNode): boolean {
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

function isUnwrappedCall(value: unknown): boolean {
  let current = value;
  while (isPythonNode(current) && current._type === "Await") {
    current = current.value;
  }
  return isPythonNode(current) && current._type === "Call";
}

function isSmallAndFlat(fn: PythonNode, text: string): boolean {
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

function nameRange(node: PythonNode): {
  start: { line: number; column: number };
  end: { line: number; column: number };
} {
  const line = typeof node.lineno === "number" ? node.lineno : 1;
  const col = (typeof node.col_offset === "number" ? node.col_offset : 0) + 1;
  const prefix = node._type === "AsyncFunctionDef" ? "async def " : "def ";
  const name = typeof node.name === "string" ? node.name : "";
  const startCol = col + prefix.length;
  return {
    start: { line, column: startCol },
    end: { line, column: startCol + name.length },
  };
}

function isSkippedSource(file: string, cwd: string): boolean {
  const slash = file.split("\\").join("/");
  const root = cwd.split("\\").join("/");
  const rel = slash.startsWith(`${root}/`) ? slash.slice(root.length + 1) : slash;
  const base = basename(rel);
  if (base === "conftest.py" || base.endsWith(".pyi") || base.endsWith("_test.py")) {
    return true;
  }
  if (base.startsWith("test_") && base.endsWith(".py")) {
    return true;
  }
  return /(?:^|\/)(?:tests|__tests__|fixtures|__pycache__)(?:\/|$)/.test(rel);
}

function isPythonNode(value: unknown): value is PythonNode {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  return "_type" in value && typeof value._type === "string";
}

function asNodes(value: unknown): PythonNode[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item) => isPythonNode(item));
}

function childNodes(node: PythonNode): PythonNode[] {
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
