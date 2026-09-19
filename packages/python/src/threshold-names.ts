import { relative } from "node:path";
import type { Range } from "qualety";
import type { PythonNode, PythonSource } from "./python.ts";
import { asNodes, isPythonNode, isSkippedSource, nodeRange } from "./walk.ts";

const NAME_PREFIXES = ["DEFAULT_", "LEGACY_", "CFG_", "CONFIG_"] as const;
export const NAME_SUFFIXES = ["_SECONDS", "_STEPS", "_COUNT", "_SEC", "_MS", "_S", "_N"] as const;
const THRESHOLD_LEXICON = [
  "cap",
  "budget",
  "threshold",
  "timeout",
  "tolerance",
  "deadline",
  "limit",
  "max_steps",
  "min_steps",
] as const;
const FORCE_TOKEN = "FORCE";
export const TOKEN_JACCARD = 0.85;
export const NAME_COSINE = 0.92;

export type ThresholdNameCard = {
  file: string;
  name: string;
  value: number;
  packageDir: string;
  embedText: string;
  range: Range;
};

export function collectNameCards(
  sources: ReadonlyMap<string, PythonSource>,
  cwd: string,
): ThresholdNameCard[] {
  const cards: ThresholdNameCard[] = [];
  for (const [abs, unit] of sources) {
    if (isSkippedSource(abs, cwd)) {
      continue;
    }
    for (const card of cardsInUnit(unit)) {
      cards.push(card);
    }
  }
  cards.sort(
    (left, right) => left.file.localeCompare(right.file) || left.name.localeCompare(right.name),
  );
  return cards;
}

export function normalizeName(name: string): string {
  let out = name.replaceAll(/([a-z0-9])([A-Z])/g, "$1_$2").toUpperCase();
  for (const prefix of NAME_PREFIXES) {
    if (out.startsWith(prefix) && out.length > prefix.length) {
      out = out.slice(prefix.length);
      break;
    }
  }
  for (const suffix of NAME_SUFFIXES) {
    if (out.endsWith(suffix) && out.length > suffix.length) {
      out = out.slice(0, -suffix.length);
      break;
    }
  }
  return out;
}

export function tokenSet(name: string): Set<string> {
  const tokens = new Set<string>();
  for (const part of normalizeName(name).split("_")) {
    if (part.length > 0) {
      tokens.add(part);
    }
  }
  return tokens;
}

export function jaccard(left: Set<string>, right: Set<string>): number {
  if (left.size === 0 || right.size === 0) {
    return 0;
  }
  let inter = 0;
  for (const token of left) {
    if (right.has(token)) {
      inter += 1;
    }
  }
  return inter / (left.size + right.size - inter);
}

export function lexiconHit(name: string): boolean {
  const raw = name.toLowerCase();
  const normalized = normalizeName(name).toLowerCase();
  for (const term of THRESHOLD_LEXICON) {
    if (raw.includes(term) || normalized.includes(term)) {
      return true;
    }
  }
  return tokenSet(name).has(FORCE_TOKEN);
}

export function namePatternHit(name: string, patterns: readonly string[]): boolean {
  for (const pattern of patterns) {
    if (pattern.length === 0) {
      continue;
    }
    const escaped = pattern.replaceAll(/[.+?^${}()|[\]\\]/g, "\\$&").replaceAll("*", ".*");
    if (new RegExp(`^${escaped}$`).test(name)) {
      return true;
    }
  }
  return false;
}

export function nameIsGated(name: string, patterns: readonly string[]): boolean {
  return namePatternHit(name, patterns) || lexiconHit(name);
}

export function displayRel(cwd: string, file: string): string {
  return relative(cwd, file).split("\\").join("/");
}

function cardsInUnit(unit: PythonSource): ThresholdNameCard[] {
  const counts = new Map<string, number>();
  const first = new Map<string, { value: number; range: Range }>();
  for (const stmt of asNodes(unit.tree.body)) {
    const target = storeTarget(stmt);
    if (target === undefined || typeof target.id !== "string") {
      continue;
    }
    const name = target.id;
    counts.set(name, (counts.get(name) ?? 0) + 1);
    if (first.has(name)) {
      continue;
    }
    const value = numericConstant(isPythonNode(stmt.value) ? stmt.value : undefined);
    if (value !== undefined) {
      first.set(name, { value, range: nodeRange(target) });
    }
  }
  const cards: ThresholdNameCard[] = [];
  for (const [name, hit] of first) {
    if ((counts.get(name) ?? 0) !== 1) {
      continue;
    }
    cards.push({
      file: unit.file,
      name,
      value: hit.value,
      packageDir: unit.packageDir,
      embedText: name
        .replaceAll(/([a-z0-9])([A-Z])/g, "$1 $2")
        .replaceAll("_", " ")
        .toLowerCase()
        .trim()
        .replaceAll(/\s+/g, " "),
      range: hit.range,
    });
  }
  return cards;
}

function storeTarget(stmt: PythonNode): PythonNode | undefined {
  if (stmt._type === "Assign") {
    const targets = asNodes(stmt.targets);
    const target = targets[0];
    if (targets.length === 1 && target?._type === "Name") {
      return target;
    }
  }
  if (stmt._type === "AnnAssign" && isPythonNode(stmt.target) && stmt.target._type === "Name") {
    return stmt.target;
  }
  return undefined;
}

function numericConstant(node: PythonNode | undefined): number | undefined {
  if (node === undefined) {
    return undefined;
  }
  if (node._type === "UnaryOp" && isPythonNode(node.op) && isPythonNode(node.operand)) {
    const inner = numericConstant(node.operand);
    if (inner === undefined) {
      return undefined;
    }
    if (node.op._type === "USub") {
      return -inner;
    }
    if (node.op._type === "UAdd") {
      return inner;
    }
    return undefined;
  }
  if (node._type === "Constant" && typeof node.value === "number" && Number.isFinite(node.value)) {
    return node.value;
  }
  if (node._type === "Num" && typeof node.n === "number" && Number.isFinite(node.n)) {
    return node.n;
  }
  return undefined;
}
