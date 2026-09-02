import { basename } from "node:path";
import { defineRule, type RuleContext } from "qualety";
import type { PythonNode, PythonSource } from "./python.ts";
import {
  asNodes,
  childNodes,
  collectLoadKeys,
  containsPos,
  type FileBinds,
  groupByPackage,
  isDunder,
  isPassThrough,
  isPythonNode,
  isSmallAndFlat,
  nameRange,
  scanPathLoadUses,
  tallyResolvedUse,
} from "./walk.ts";

const FUNCTION_SUGGESTION =
  "Inline at its only use, or keep only if the name still hides real complexity; wait for a second real use before keeping a pass-through.";
const UNUSED_FN_HINT =
  "Remove this helper, or wait for a second real use before keeping the indirection.";

type Def = {
  file: string;
  name: string;
  className: string;
  node: PythonNode;
  text: string;
  quiet: boolean;
};

type ClassHit = {
  file: string;
  name: string;
  node: PythonNode;
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
    const cwd = context.getCwd();
    const scannedByPackage = groupByPackage(artifact.sources, cwd);
    for (const group of scannedByPackage.values()) {
      if (group.length > 0) {
        scanPackageGroup(group, artifact.sources, cwd, context);
      }
    }
  },
});

function scanPackageGroup(
  group: readonly PythonSource[],
  allSources: ReadonlyMap<string, PythonSource>,
  cwd: string,
  context: Pick<RuleContext, "report">,
) {
  const defs: Def[] = [];
  const classes: ClassHit[] = [];
  for (const unit of group) {
    const quiet = basename(unit.file) === "__init__.py";
    collectDefs(unit.tree, "", unit, quiet, defs, classes);
  }
  const callCounts = new Map<string, number>();
  const valueLoads = new Set<string>();
  const byKey = new Map(defs.map((def) => [defKey(def), def]));
  const externalOnlyClasses = new Set<string>();
  const silenced = scanPathLoadUses(group, allSources, cwd, (unit, fileBinds) => {
    tallyFileUses(
      unit,
      fileBinds,
      defs,
      byKey,
      callCounts,
      valueLoads,
      classes,
      externalOnlyClasses,
    );
  });
  for (const def of defs) {
    if (!valueLoads.has(defKey(def))) {
      considerDef(def, context, callCounts, silenced, externalOnlyClasses);
    }
  }
}

function tallyFileUses(
  unit: PythonSource,
  fileBinds: FileBinds | undefined,
  defs: readonly Def[],
  byKey: ReadonlyMap<string, Def>,
  callCounts: Map<string, number>,
  valueLoads: Set<string>,
  classes: readonly ClassHit[],
  externalOnlyClasses: Set<string>,
) {
  markExternalOnly(unit.file, fileBinds, classes, externalOnlyClasses);
  walkCalls(unit.tree, "", unit.file, (call) => {
    const key = resolveCall(call, fileBinds, defs);
    tallyResolvedUse(
      key,
      key === undefined ? undefined : byKey.get(key),
      call.file,
      call.lineno,
      callCounts,
    );
    if (key === undefined) {
      addAmbiguousLoads(call, fileBinds, defs, valueLoads);
    }
  });
  collectLoadKeys(
    unit.tree,
    "",
    unit.file,
    (parent, child) => parent._type === "Call" && child === parent.func,
    (ref) => {
      const key = resolveCall(ref, fileBinds, defs);
      if (key === undefined) {
        addAmbiguousLoads(ref, fileBinds, defs, valueLoads);
      }
      return key;
    },
    (key) => byKey.get(key)?.node,
    valueLoads,
  );
}

function considerDef(
  def: Def,
  context: Pick<RuleContext, "report">,
  callCounts: ReadonlyMap<string, number>,
  silenced: ReadonlySet<string>,
  externalOnlyClasses: ReadonlySet<string>,
) {
  if (def.quiet || isDunder(def.name) || silenced.has(def.file)) {
    return;
  }
  if (def.className !== "" && externalOnlyClasses.has(`${def.file}:${def.className}`)) {
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
        ? `"${def.name}" is not used and does not pay for the indirection.`
        : `"${def.name}" is only used once and does not pay for the indirection.`,
    suggestion: uses === 0 ? UNUSED_FN_HINT : FUNCTION_SUGGESTION,
  });
}

function collectDefs(
  node: PythonNode,
  className: string,
  unit: PythonSource,
  quiet: boolean,
  defs: Def[],
  classes: ClassHit[],
) {
  if (node._type === "FunctionDef" || node._type === "AsyncFunctionDef") {
    if (typeof node.name === "string") {
      defs.push({ file: unit.file, name: node.name, className, node, text: unit.text, quiet });
    }
    for (const child of childNodes(node)) {
      collectDefs(child, "", unit, quiet, defs, classes);
    }
    return;
  }
  if (node._type === "ClassDef") {
    const next = typeof node.name === "string" ? node.name : className;
    if (typeof node.name === "string") {
      classes.push({ file: unit.file, name: node.name, node });
    }
    for (const child of childNodes(node)) {
      collectDefs(child, next, unit, quiet, defs, classes);
    }
    return;
  }
  for (const child of childNodes(node)) {
    collectDefs(child, className, unit, quiet, defs, classes);
  }
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
    if (moduleFile !== undefined) {
      return findDefKey(defs, moduleFile, call.name, "");
    }
    const hits = defs.filter((def) => def.name === call.name && def.className !== "");
    const hit = hits[0];
    return hits.length === 1 && hit !== undefined ? defKey(hit) : undefined;
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

function addAmbiguousLoads(
  call: RawCall,
  fileBinds: FileBinds | undefined,
  defs: readonly Def[],
  valueLoads: Set<string>,
) {
  const owner = call.owner;
  if (typeof owner !== "string" || owner === "self" || owner === "cls") {
    return;
  }
  if (fileBinds?.modules.get(owner) !== undefined) {
    return;
  }
  const hits = defs.filter((def) => def.name === call.name && def.className !== "");
  if (hits.length < 2) {
    return;
  }
  for (const def of hits) {
    if (call.file === def.file && containsPos(def.node, call.lineno)) {
      continue;
    }
    valueLoads.add(defKey(def));
  }
}

function markExternalOnly(
  file: string,
  fileBinds: FileBinds | undefined,
  classes: readonly ClassHit[],
  externalOnlyClasses: Set<string>,
) {
  for (const item of classes) {
    if (item.file !== file) {
      continue;
    }
    const bases = asNodes(item.node.bases);
    if (bases.length > 0 && bases.every((base) => !baseInGroup(base, file, fileBinds, classes))) {
      externalOnlyClasses.add(`${file}:${item.name}`);
    }
  }
}

function baseInGroup(
  base: PythonNode,
  file: string,
  fileBinds: FileBinds | undefined,
  classes: readonly ClassHit[],
): boolean {
  if (base._type === "Name" && typeof base.id === "string") {
    const imported = fileBinds?.named.get(base.id);
    if (imported !== undefined) {
      return classes.some((item) => item.file === imported.file && item.name === imported.name);
    }
    return classes.some((item) => item.file === file && item.name === base.id);
  }
  if (
    base._type !== "Attribute" ||
    typeof base.attr !== "string" ||
    !isPythonNode(base.value) ||
    base.value._type !== "Name" ||
    typeof base.value.id !== "string"
  ) {
    return false;
  }
  const moduleFile = fileBinds?.modules.get(base.value.id);
  if (moduleFile === undefined) {
    return false;
  }
  return classes.some((item) => item.file === moduleFile && item.name === base.attr);
}

function defKey(def: Pick<Def, "file" | "name" | "className" | "node">): string {
  return `${def.file}:${def.node.lineno}:${def.name}:${def.className}`;
}
