import {
  asNodes,
  isPythonNode,
  nodeRange,
  type PythonNode,
  type PythonSource,
  stringConstant,
  walkNodes,
} from "@qualety/python/walk";
import { defineRule } from "qualety";
import { assignTarget, attrChain, callKeyword, lastAttr, walkSkipDefs } from "./ast.ts";
import {
  collectArtifactSaves,
  type GateSite,
  parseWriterName,
  resolveWriter,
} from "./provenance.ts";

const HASH_ALGS = new Set(["sha256", "sha1", "md5"]);
const HASH_TAILS = new Set(["hexdigest", "digest"]);

type PathId = { text: string; name?: string };
type DigestSet = { names: Set<string>; nodes: Set<PythonNode> };

export const artifactHashRecorded = defineRule({
  meta: {
    requires: ["python"],
    docs: {
      description:
        "Every model-artifact write must record a content hash of what was written in the metadata writer payload.",
    },
    schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        writerName: { type: "string" },
        entryPoints: { type: "array", items: { type: "string" } },
      },
    },
  },
  create(context) {
    const writerName = parseWriterName(context.options);
    const python = context.getArtifact("python");
    const hint = `Hash the saved artifact (e.g. hashlib.sha256(Path(path).read_bytes()).hexdigest()) and record it in ${writerName} under an allowlisted key such as artifact_hash.`;
    for (const site of collectArtifactSaves(python.sources, context.getCwd())) {
      const dest = recoverDest(site.node, site.unit, site.scope);
      if (dest === undefined) {
        continue;
      }
      const writer = resolveWriter(site.unit, writerName, python.sources);
      if (writer === undefined) {
        continue;
      }
      const digests = collectDigests(site, dest, python.sources);
      if (payloadLink(writer.def, site.scope, writerName, digests) !== "absent") {
        continue;
      }
      context.report({
        severity: "error",
        file: site.unit.file,
        range: nodeRange(site.node),
        message: `Artifact save does not record a content hash in "${writerName}" payload.`,
        suggestion: hint,
      });
    }
  },
});

function recoverDest(save: PythonNode, unit: PythonSource, scope: PythonNode): PathId | undefined {
  const tail = lastAttr(save.func);
  const arg =
    tail === "save"
      ? (asNodes(save.args)[1] ?? callKeyword(save, "f"))
      : tail === "dump"
        ? (asNodes(save.args)[1] ?? callKeyword(save, "filename"))
        : undefined;
  if (arg === undefined) {
    return undefined;
  }
  const folded = foldPathExpr(arg, unit, scope);
  if (folded === undefined) {
    return undefined;
  }
  if (arg._type === "Name" && typeof arg.id === "string") {
    return { text: folded.text, name: arg.id };
  }
  return folded;
}

function foldPathExpr(
  node: PythonNode,
  unit: PythonSource,
  scope: PythonNode,
  seen: Set<string> = new Set(),
): PathId | undefined {
  const text = stringConstant(node);
  if (text !== undefined) {
    return { text };
  }
  if (node._type === "Name" && typeof node.id === "string") {
    return foldPathName(node.id, unit, scope, seen);
  }
  if (node._type === "BinOp") {
    return foldPathDiv(node, unit, scope, seen);
  }
  if (node._type === "Call") {
    return foldPathCall(node, unit, scope, seen);
  }
  return undefined;
}

function foldPathName(
  id: string,
  unit: PythonSource,
  scope: PythonNode,
  seen: Set<string>,
): PathId | undefined {
  if (seen.has(id)) {
    return undefined;
  }
  seen.add(id);
  const bound = boundValue(scope, id) ?? boundValue(unit.tree, id);
  if (bound === undefined) {
    return undefined;
  }
  const inner = foldPathExpr(bound, unit, scope, seen);
  return inner === undefined ? undefined : { text: inner.text, name: id };
}

function foldPathDiv(
  node: PythonNode,
  unit: PythonSource,
  scope: PythonNode,
  seen: Set<string>,
): PathId | undefined {
  if (!isPythonNode(node.op) || node.op._type !== "Div") {
    return undefined;
  }
  if (!isPythonNode(node.left) || !isPythonNode(node.right)) {
    return undefined;
  }
  const left = foldPathExpr(node.left, unit, scope, seen);
  const right = foldPathExpr(node.right, unit, scope, seen);
  return left === undefined || right === undefined
    ? undefined
    : { text: `${left.text}/${right.text}` };
}

function foldPathCall(
  node: PythonNode,
  unit: PythonSource,
  scope: PythonNode,
  seen: Set<string>,
): PathId | undefined {
  const name = lastAttr(node.func);
  if (name !== "Path" && name !== "join" && name !== "joinpath") {
    return undefined;
  }
  const parts: string[] = [];
  if (name === "joinpath") {
    const recv = callReceiver(node);
    if (recv === undefined) {
      return undefined;
    }
    const base = foldPathExpr(recv, unit, scope, seen);
    if (base === undefined) {
      return undefined;
    }
    parts.push(base.text);
  }
  for (const arg of asNodes(node.args)) {
    const part = foldPathExpr(arg, unit, scope, seen);
    if (part === undefined) {
      return undefined;
    }
    parts.push(part.text);
  }
  return parts.length === 0 ? undefined : { text: parts.join("/") };
}

function boundValue(scope: PythonNode, name: string): PythonNode | undefined {
  let found: PythonNode | undefined;
  for (const stmt of asNodes(scope.body)) {
    const target = assignTarget(stmt);
    if (target?._type === "Name" && target.id === name && isPythonNode(stmt.value)) {
      found = stmt.value;
    }
  }
  return found;
}

function samePath(expr: PythonNode, dest: PathId, unit: PythonSource, scope: PythonNode): boolean {
  if (expr._type === "Name" && dest.name !== undefined && expr.id === dest.name) {
    return true;
  }
  const folded = foldPathExpr(expr, unit, scope);
  return folded !== undefined && folded.text === dest.text;
}

function callReceiver(node: PythonNode): PythonNode | undefined {
  if (!isPythonNode(node.func) || node.func._type !== "Attribute") {
    return undefined;
  }
  return isPythonNode(node.func.value) ? node.func.value : undefined;
}

function pathReadOf(node: PythonNode): PythonNode | undefined {
  if (node._type !== "Call") {
    return undefined;
  }
  const name = lastAttr(node.func);
  if (name === "open") {
    return asNodes(node.args)[0];
  }
  if (name !== "read_bytes" && name !== "read_text" && name !== "read") {
    return undefined;
  }
  const recv = callReceiver(node);
  if (recv === undefined) {
    return undefined;
  }
  if (recv._type === "Call" && (lastAttr(recv.func) === "open" || lastAttr(recv.func) === "Path")) {
    return asNodes(recv.args)[0];
  }
  return recv;
}

function hashlibCall(node: PythonNode): PythonNode | undefined {
  let current: PythonNode | undefined = node;
  while (current?._type === "Call" && HASH_TAILS.has(lastAttr(current.func) ?? "")) {
    current = callReceiver(current);
  }
  if (current?._type !== "Call") {
    return undefined;
  }
  const chain = attrChain(current.func);
  const alg = chain[chain.length - 1];
  if (alg === undefined || !HASH_ALGS.has(alg)) {
    return undefined;
  }
  return chain.length === 1 || chain[0] === "hashlib" ? current : undefined;
}

function hashlibCovers(
  node: PythonNode,
  dest: PathId,
  objectName: string | undefined,
  unit: PythonSource,
  scope: PythonNode,
): boolean {
  const hash = hashlibCall(node);
  if (hash === undefined) {
    return false;
  }
  const arg = asNodes(hash.args)[0];
  if (arg === undefined) {
    return false;
  }
  if (objectName !== undefined && arg._type === "Name" && arg.id === objectName) {
    return true;
  }
  return coversPath(arg, dest, unit, scope);
}

function coversPath(
  node: PythonNode,
  dest: PathId,
  unit: PythonSource,
  scope: PythonNode,
): boolean {
  const readOf = pathReadOf(node);
  if (readOf !== undefined) {
    return samePath(readOf, dest, unit, scope);
  }
  if (node._type === "Name" && typeof node.id === "string") {
    const bound = boundValue(scope, node.id) ?? boundValue(unit.tree, node.id);
    return bound !== undefined && coversPath(bound, dest, unit, scope);
  }
  return false;
}

function collectDigests(
  site: GateSite,
  dest: PathId,
  sources: ReadonlyMap<string, PythonSource>,
): DigestSet {
  const names = new Set<string>();
  const nodes = new Set<PythonNode>();
  const obj = asNodes(site.node.args)[0];
  const objectName = obj?._type === "Name" && typeof obj.id === "string" ? obj.id : undefined;
  walkNodes(site.unit.tree, (node) => {
    if (node._type !== "Call") {
      return;
    }
    if (hashlibCovers(node, dest, objectName, site.unit, site.scope)) {
      nodes.add(node);
      const hash = hashlibCall(node);
      if (hash !== undefined) {
        nodes.add(hash);
      }
      return;
    }
    noteHelperDigest(node, dest, objectName, site, sources, nodes);
  });
  walkNodes(site.unit.tree, (node) => {
    const target = assignTarget(node);
    if (target?._type !== "Name" || typeof target.id !== "string" || !isPythonNode(node.value)) {
      return;
    }
    if (nodes.has(node.value)) {
      names.add(target.id);
    }
  });
  return { names, nodes };
}

function noteHelperDigest(
  node: PythonNode,
  dest: PathId,
  objectName: string | undefined,
  site: GateSite,
  sources: ReadonlyMap<string, PythonSource>,
  nodes: Set<PythonNode>,
): void {
  const name = lastAttr(node.func);
  if (name === undefined || HASH_ALGS.has(name) || HASH_TAILS.has(name)) {
    return;
  }
  const resolved = resolveWriter(site.unit, name, sources);
  if (resolved === undefined || !helperCovers(node, resolved.def, dest, objectName, site)) {
    return;
  }
  nodes.add(node);
}

function helperCovers(
  call: PythonNode,
  def: PythonNode,
  dest: PathId,
  objectName: string | undefined,
  site: GateSite,
): boolean {
  const params = functionParams(def);
  const args = asNodes(call.args);
  let covers = false;
  walkNodes(def, (node) => {
    if (hashlibCall(node) === undefined) {
      return;
    }
    if (coversMapped(node, dest, objectName, def, params, args, site)) {
      covers = true;
    }
  });
  return covers;
}

function coversMapped(
  node: PythonNode,
  dest: PathId,
  objectName: string | undefined,
  def: PythonNode,
  params: readonly string[],
  args: readonly PythonNode[],
  site: GateSite,
): boolean {
  const hash = hashlibCall(node);
  if (hash === undefined) {
    return false;
  }
  const arg = asNodes(hash.args)[0];
  if (arg === undefined) {
    return false;
  }
  const resolved = resolveHelperArg(arg, def, params, args);
  if (objectName !== undefined && resolved._type === "Name" && resolved.id === objectName) {
    return true;
  }
  const readOf = pathReadOf(resolved) ?? pathReadOf(arg);
  const expr = readOf === undefined ? resolved : resolveHelperArg(readOf, def, params, args);
  return samePath(expr, dest, site.unit, site.scope);
}

function resolveHelperArg(
  node: PythonNode,
  def: PythonNode,
  params: readonly string[],
  args: readonly PythonNode[],
): PythonNode {
  if (node._type !== "Name" || typeof node.id !== "string") {
    return node;
  }
  const idx = params.indexOf(node.id);
  if (idx >= 0) {
    return args[idx] ?? node;
  }
  return boundValue(def, node.id) ?? node;
}

function functionParams(fn: PythonNode): string[] {
  if (!isPythonNode(fn.args)) {
    return [];
  }
  const names: string[] = [];
  for (const arg of asNodes(fn.args.args)) {
    if (typeof arg.arg === "string") {
      names.push(arg.arg);
    }
  }
  return names;
}

function payloadLink(
  writerDef: PythonNode,
  scope: PythonNode,
  writerName: string,
  digests: DigestSet,
): "hit" | "absent" | "quiet" {
  const entries: PythonNode[] = [];
  walkNodes(writerDef, (node) => {
    takeDictValues(node, entries);
  });
  const stmts = asNodes(scope.body);
  const roots = stmts.length > 0 ? stmts : [scope];
  for (const stmt of roots) {
    walkSkipDefs(stmt, (node) => {
      if (node._type !== "Call" || lastAttr(node.func) !== writerName) {
        return;
      }
      takeCallValues(node, scope, entries, digests);
    });
  }
  if (entries.some((value) => valueStatus(value, digests) === "hit")) {
    return "hit";
  }
  if (entries.length === 0) {
    return "quiet";
  }
  if (entries.some((value) => valueStatus(value, digests) === "ambiguous")) {
    return "quiet";
  }
  return "absent";
}

function takeDictValues(node: PythonNode, entries: PythonNode[]): void {
  if (node._type !== "Dict") {
    return;
  }
  for (const value of asNodes(node.values)) {
    entries.push(value);
  }
}

function takeCallValues(
  node: PythonNode,
  scope: PythonNode,
  entries: PythonNode[],
  digests: DigestSet,
): void {
  for (const keyword of asNodes(node.keywords)) {
    if (isPythonNode(keyword.value)) {
      entries.push(keyword.value);
    }
  }
  for (const arg of asNodes(node.args)) {
    takeArgValue(arg, scope, entries, digests);
  }
}

function takeArgValue(
  arg: PythonNode,
  scope: PythonNode,
  entries: PythonNode[],
  digests: DigestSet,
): void {
  takeDictValues(arg, entries);
  if (arg._type === "Name" && typeof arg.id === "string") {
    const bound = boundValue(scope, arg.id);
    if (bound?._type === "Dict") {
      takeDictValues(bound, entries);
    } else if (digests.names.has(arg.id) || digests.nodes.has(arg)) {
      entries.push(arg);
    }
    return;
  }
  if (digests.nodes.has(arg)) {
    entries.push(arg);
  }
}

function valueStatus(value: PythonNode, digests: DigestSet): "hit" | "ambiguous" | "miss" {
  if (value._type === "Name" && typeof value.id === "string") {
    return digests.names.has(value.id) ? "hit" : "miss";
  }
  if (digests.nodes.has(value)) {
    return "hit";
  }
  const hash = hashlibCall(value);
  if (hash !== undefined && digests.nodes.has(hash)) {
    return "hit";
  }
  if (value._type === "Call") {
    return "ambiguous";
  }
  return "miss";
}
