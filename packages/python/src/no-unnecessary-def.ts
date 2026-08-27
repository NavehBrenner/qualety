import { basename } from "node:path";
import { defineRule, type RuleContext } from "qualety";
import type { PythonNode, PythonSource } from "./python.ts";
import {
  childNodes,
  collectImports,
  containsPos,
  type FileBinds,
  groupByPackage,
  isDunder,
  isPassThrough,
  isPythonNode,
  isSmallAndFlat,
  nameRange,
} from "./walk.ts";

const FUNCTION_SUGGESTION =
  "Inline at its only call site, or keep only if the name still hides real complexity; wait for a second real call site before keeping a pass-through.";
const UNUSED_FN_HINT =
  "Remove this helper, or wait for a second real call site before keeping the indirection.";

type Def = {
  file: string;
  name: string;
  className: string;
  node: PythonNode;
  text: string;
  quiet: boolean;
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
    const scannedByPackage = groupByPackage(artifact.sources, context.getCwd());
    for (const group of scannedByPackage.values()) {
      if (group.length > 0) {
        scanPackageGroup(group, context);
      }
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
  if (def.quiet || isDunder(def.name)) {
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
