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
    const key = resolveCall(call, fileBinds, defs, classes);
    tallyResolvedUse(
      key,
      key === undefined ? undefined : byKey.get(key),
      call.file,
      call.lineno,
      callCounts,
    );
    if (key === undefined) {
      addAmbiguousLoads(call, fileBinds, defs, valueLoads);
      addUnprovenAttributeLoads(call, defs, valueLoads);
    }
  });
  collectLoadKeys(
    unit.tree,
    "",
    unit.file,
    (parent, child) => parent._type === "Call" && child === parent.func,
    (ref) => {
      const call = { kind: "name" as const, ...ref };
      const key = resolveCall(call, fileBinds, defs, classes);
      if (key === undefined) {
        addAmbiguousLoads(call, fileBinds, defs, valueLoads);
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

type RawCall =
  | {
      kind: "name";
      file: string;
      name: string;
      owner: string | undefined;
      className: string;
      lineno: number;
    }
  | {
      kind: "ctor";
      file: string;
      name: string;
      className: string;
      lineno: number;
      ctorName: string;
    }
  | {
      kind: "instance";
      file: string;
      name: string;
      className: string;
      lineno: number;
      instanceAttr: string;
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
    return { kind: "name", file, name: func.id, owner: undefined, className, lineno };
  }
  if (func._type !== "Attribute" || typeof func.attr !== "string" || !isPythonNode(func.value)) {
    return undefined;
  }
  return rawAttrCall(func.value, func.attr, className, file, lineno);
}

function rawAttrCall(
  value: PythonNode,
  attr: string,
  className: string,
  file: string,
  lineno: number,
): RawCall | undefined {
  if (value._type === "Name" && typeof value.id === "string") {
    return { kind: "name", file, name: attr, owner: value.id, className, lineno };
  }
  if (value._type === "Call") {
    const callee = value.func;
    if (isPythonNode(callee) && callee._type === "Name" && typeof callee.id === "string") {
      return { kind: "ctor", file, name: attr, className, lineno, ctorName: callee.id };
    }
    return undefined;
  }
  if (
    value._type !== "Attribute" ||
    typeof value.attr !== "string" ||
    !isPythonNode(value.value) ||
    value.value._type !== "Name" ||
    typeof value.value.id !== "string"
  ) {
    return undefined;
  }
  const base = value.value.id;
  if (base !== "self" && base !== "cls") {
    return undefined;
  }
  return { kind: "instance", file, name: attr, className, lineno, instanceAttr: value.attr };
}

function resolveCall(
  call: RawCall,
  fileBinds: FileBinds | undefined,
  defs: readonly Def[],
  classes: readonly ClassHit[],
): string | undefined {
  if (call.kind === "ctor") {
    const hits = defs.filter((def) => def.className === call.ctorName && def.name === call.name);
    const hit = hits[0];
    return hits.length === 1 && hit !== undefined ? defKey(hit) : undefined;
  }
  if (call.kind === "instance") {
    return resolveAttrCall(call, fileBinds, defs, classes);
  }
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

function resolveAttrCall(
  call: Extract<RawCall, { kind: "instance" }>,
  fileBinds: FileBinds | undefined,
  defs: readonly Def[],
  classes: readonly ClassHit[],
): string | undefined {
  if (call.className === "") {
    return undefined;
  }
  const ownerHits = classes.filter(
    (item) => item.file === call.file && item.name === call.className,
  );
  const ownerClass = ownerHits[0];
  if (ownerHits.length !== 1 || ownerClass === undefined) {
    return undefined;
  }
  const rhsName = attrBindRhs(ownerClass.node, call.instanceAttr);
  if (rhsName === undefined) {
    return undefined;
  }
  const owner = resolveAttrOwner(rhsName, call.file, fileBinds, classes);
  if (owner === undefined) {
    return undefined;
  }
  return findDefKey(defs, owner.file, call.name, owner.name);
}

function attrBindRhs(classNode: PythonNode, attr: string): string | undefined {
  const names = new Set<string>();
  for (const stmt of asNodes(classNode.body)) {
    if (!collectBindName(stmt, attr, true, names)) {
      return undefined;
    }
    if (
      (stmt._type === "FunctionDef" || stmt._type === "AsyncFunctionDef") &&
      stmt.name === "__init__"
    ) {
      for (const inner of asNodes(stmt.body)) {
        if (!collectBindName(inner, attr, false, names)) {
          return undefined;
        }
      }
    }
  }
  if (names.size !== 1) {
    return undefined;
  }
  const [rhsName] = names;
  return rhsName;
}

function collectBindName(
  stmt: PythonNode,
  attr: string,
  allowName: boolean,
  names: Set<string>,
): boolean {
  const value = bindStmtValue(stmt, attr, allowName);
  if (value === undefined) {
    return true;
  }
  const rhsName = rhsClassName(value);
  if (rhsName === undefined) {
    return false;
  }
  names.add(rhsName);
  return true;
}

function bindStmtValue(stmt: PythonNode, attr: string, allowName: boolean): PythonNode | undefined {
  if (stmt._type === "Assign") {
    const matched = asNodes(stmt.targets).some((target) => isAttrTarget(target, attr, allowName));
    if (!matched || !isPythonNode(stmt.value)) {
      return undefined;
    }
    return stmt.value;
  }
  if (stmt._type !== "AnnAssign" || !isPythonNode(stmt.target) || !isPythonNode(stmt.value)) {
    return undefined;
  }
  if (!isAttrTarget(stmt.target, attr, allowName)) {
    return undefined;
  }
  return stmt.value;
}

function isAttrTarget(target: PythonNode, attr: string, allowName: boolean): boolean {
  if (allowName && target._type === "Name" && target.id === attr) {
    return true;
  }
  if (
    target._type !== "Attribute" ||
    target.attr !== attr ||
    !isPythonNode(target.value) ||
    target.value._type !== "Name"
  ) {
    return false;
  }
  return target.value.id === "self" || target.value.id === "cls";
}

function rhsClassName(value: PythonNode): string | undefined {
  if (value._type === "Name" && typeof value.id === "string") {
    return value.id;
  }
  if (
    value._type === "Call" &&
    isPythonNode(value.func) &&
    value.func._type === "Name" &&
    typeof value.func.id === "string"
  ) {
    return value.func.id;
  }
  return undefined;
}

function resolveAttrOwner(
  rhsName: string,
  file: string,
  fileBinds: FileBinds | undefined,
  classes: readonly ClassHit[],
): { file: string; name: string } | undefined {
  const imported = fileBinds?.named.get(rhsName);
  if (imported !== undefined) {
    return imported;
  }
  const sameFile = classes.filter((item) => item.file === file && item.name === rhsName);
  if (sameFile.length === 1) {
    return sameFile[0];
  }
  if (sameFile.length !== 0) {
    return undefined;
  }
  const group = classes.filter((item) => item.name === rhsName);
  return group.length === 1 ? group[0] : undefined;
}

function addUnprovenAttributeLoads(call: RawCall, defs: readonly Def[], valueLoads: Set<string>) {
  if (call.kind !== "instance") {
    return;
  }
  for (const def of defs) {
    if (def.name !== call.name || def.className === "") {
      continue;
    }
    if (call.file === def.file && containsPos(def.node, call.lineno)) {
      continue;
    }
    valueLoads.add(defKey(def));
  }
}

function addAmbiguousLoads(
  call: RawCall,
  fileBinds: FileBinds | undefined,
  defs: readonly Def[],
  valueLoads: Set<string>,
) {
  if (call.kind !== "name") {
    return;
  }
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
