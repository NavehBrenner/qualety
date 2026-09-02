import { basename } from "node:path";

export type PythonNode = {
  readonly _type: string;
  readonly [key: string]: unknown;
};

export type PythonSource = {
  file: string;
  text: string;
  tree: PythonNode;
};

export type NodePos = { line: number; column: number };

export function isPythonNode(value: unknown): value is PythonNode {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  return "_type" in value && typeof value._type === "string";
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

export function walkNodes(node: PythonNode, visit: (node: PythonNode) => void): void {
  visit(node);
  for (const child of childNodes(node)) {
    walkNodes(child, visit);
  }
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

export function nodePos(node: PythonNode): NodePos {
  return {
    line: typeof node.lineno === "number" ? node.lineno : 1,
    column: typeof node.col_offset === "number" ? node.col_offset : 0,
  };
}

export function isBefore(left: NodePos, right: NodePos): boolean {
  return left.line < right.line || (left.line === right.line && left.column < right.column);
}

export function pythonSources(artifact: unknown): PythonSource[] {
  if (!isRecord(artifact) || !(artifact.sources instanceof Map)) {
    return [];
  }
  const out: PythonSource[] = [];
  for (const unit of artifact.sources.values()) {
    if (!isRecord(unit) || typeof unit.file !== "string" || !isPythonNode(unit.tree)) {
      continue;
    }
    out.push({
      file: unit.file,
      text: typeof unit.text === "string" ? unit.text : "",
      tree: unit.tree,
    });
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
  if (base.endsWith(".pyi") || isTestPath(file, cwd)) {
    return true;
  }
  return /(?:^|\/)(?:fixtures|__pycache__)(?:\/|$)/.test(rel);
}

export function attrChain(node: unknown): string[] {
  if (!isPythonNode(node)) {
    return [];
  }
  if (node._type === "Name" && typeof node.id === "string") {
    return [node.id];
  }
  if (node._type === "Attribute" && typeof node.attr === "string") {
    return [...attrChain(node.value), node.attr];
  }
  return [];
}

export function lastAttr(node: unknown): string | undefined {
  const chain = attrChain(node);
  return chain[chain.length - 1];
}

export function isDataLoaderCall(node: PythonNode): boolean {
  return node._type === "Call" && lastAttr(node.func) === "DataLoader";
}

export function isBackwardCall(node: PythonNode): boolean {
  if (node._type !== "Call" || !isPythonNode(node.func)) {
    return false;
  }
  return node.func._type === "Attribute" && node.func.attr === "backward";
}

export function isNnConstructCall(node: PythonNode): boolean {
  if (node._type !== "Call") {
    return false;
  }
  const chain = attrChain(node.func);
  return chain.length >= 2 && chain[chain.length - 2] === "nn";
}

export function isTrainingModule(tree: PythonNode): boolean {
  let found = false;
  walkNodes(tree, (node) => {
    if (isBackwardCall(node) || isDataLoaderCall(node)) {
      found = true;
    }
  });
  return found;
}

export function firstTrainingNode(tree: PythonNode): PythonNode | undefined {
  let best: PythonNode | undefined;
  walkNodes(tree, (node) => {
    if (!isBackwardCall(node) && !isDataLoaderCall(node)) {
      return;
    }
    if (best === undefined || isBefore(nodePos(node), nodePos(best))) {
      best = node;
    }
  });
  return best;
}

export function callKeyword(node: PythonNode, name: string): PythonNode | undefined {
  for (const keyword of asNodes(node.keywords)) {
    if (keyword.arg === name && isPythonNode(keyword.value)) {
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
  if (node === undefined) {
    return undefined;
  }
  if (node._type === "Constant" && typeof node.value === "string") {
    return node.value;
  }
  if (node._type === "Str" && typeof node.s === "string") {
    return node.s;
  }
  return undefined;
}

export type ModuleBind = { local: string; module: string; imported?: string };

export function collectModuleBinds(tree: PythonNode): ModuleBind[] {
  const binds: ModuleBind[] = [];
  for (const stmt of asNodes(tree.body)) {
    if (stmt._type === "Import") {
      pushImportBinds(stmt, binds);
    }
    if (stmt._type === "ImportFrom") {
      pushImportFromBinds(stmt, binds);
    }
  }
  return binds;
}

export function functionArgNames(fn: PythonNode): string[] {
  if (!isPythonNode(fn.args)) {
    return [];
  }
  const names: string[] = [];
  const args = [
    ...asNodes(fn.args.posonlyargs),
    ...asNodes(fn.args.args),
    ...asNodes(fn.args.kwonlyargs),
  ];
  for (const arg of args) {
    if (typeof arg.arg === "string") {
      names.push(arg.arg);
    }
  }
  return names;
}

function pushImportBinds(stmt: PythonNode, binds: ModuleBind[]) {
  for (const alias of asNodes(stmt.names)) {
    if (typeof alias.name !== "string") {
      continue;
    }
    const local = typeof alias.asname === "string" ? alias.asname : alias.name.split(".")[0];
    if (typeof local === "string") {
      binds.push({ local, module: alias.name });
    }
  }
}

function pushImportFromBinds(stmt: PythonNode, binds: ModuleBind[]) {
  const module = typeof stmt.module === "string" ? stmt.module : "";
  const level = typeof stmt.level === "number" ? stmt.level : 0;
  if (level !== 0 || module.length === 0) {
    return;
  }
  for (const alias of asNodes(stmt.names)) {
    if (typeof alias.name !== "string" || alias.name === "*") {
      continue;
    }
    const local = typeof alias.asname === "string" ? alias.asname : alias.name;
    binds.push({ local, module, imported: alias.name });
  }
}

function relativePosix(file: string, cwd: string): string {
  const slash = file.split("\\").join("/");
  const root = cwd.split("\\").join("/");
  return slash.startsWith(`${root}/`) ? slash.slice(root.length + 1) : slash;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
