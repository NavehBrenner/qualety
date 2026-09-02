import {
  asNodes,
  forEachPythonSource,
  isPythonNode,
  type PythonNode,
  type PythonSource,
  stringConstant,
  walkNodes,
} from "@qualety/python/walk";

const TRAIN_LIKE = new Set(["train", "main"]);

export type NodePos = { line: number; column: number };

export function nodePos(node: PythonNode): NodePos {
  return {
    line: typeof node.lineno === "number" ? node.lineno : 1,
    column: typeof node.col_offset === "number" ? node.col_offset : 0,
  };
}

export function isBefore(left: NodePos, right: NodePos): boolean {
  return left.line < right.line || (left.line === right.line && left.column < right.column);
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

export function isDataLoaderCall(
  node: PythonNode,
): node is PythonNode & { readonly _type: "Call" } {
  return node._type === "Call" && lastAttr(node.func) === "DataLoader";
}

export function isBackwardCall(node: PythonNode): node is PythonNode & { readonly _type: "Call" } {
  if (node._type !== "Call" || !isPythonNode(node.func)) {
    return false;
  }
  return node.func._type === "Attribute" && node.func.attr === "backward";
}

export function treeHas(tree: PythonNode, pred: (node: PythonNode) => boolean): boolean {
  let found = false;
  walkNodes(tree, (node) => {
    if (pred(node)) {
      found = true;
    }
  });
  return found;
}

export function forEachMlSource(
  sources: unknown,
  cwd: string,
  options: { trainingOnly?: boolean },
  visit: (unit: PythonSource) => void,
): void {
  forEachPythonSource(sources, cwd, (unit) => {
    if (
      options.trainingOnly === true &&
      !treeHas(unit.tree, (node) => isBackwardCall(node) || isDataLoaderCall(node))
    ) {
      return;
    }
    visit(unit);
  });
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

export function assignTarget(node: PythonNode): PythonNode | undefined {
  if (node._type === "AnnAssign" && isPythonNode(node.target)) {
    return node.target;
  }
  if (node._type !== "Assign") {
    return undefined;
  }
  return asNodes(node.targets)[0];
}

export function parseEntryPoints(options: unknown): string[] {
  if (typeof options !== "object" || options === null || !("entryPoints" in options)) {
    return [];
  }
  const raw = options.entryPoints;
  if (!Array.isArray(raw)) {
    return [];
  }
  const names: string[] = [];
  for (const item of raw) {
    if (typeof item === "string" && item.length > 0) {
      const trimmed = item.replaceAll("\\", "/").replace(/\.py$/, "");
      const parts = trimmed.split(/[./]/);
      names.push(parts[parts.length - 1] ?? trimmed);
    }
  }
  return names;
}

export function collectTrainingEntries(
  unit: PythonSource,
  extra: readonly string[],
): { name: string; node: PythonNode }[] {
  const wanted = new Set<string>([...TRAIN_LIKE, ...extra]);
  const defs: { name: string; node: PythonNode }[] = [];
  for (const stmt of asNodes(unit.tree.body)) {
    if (stmt._type !== "FunctionDef" && stmt._type !== "AsyncFunctionDef") {
      continue;
    }
    if (typeof stmt.name === "string" && wanted.has(stmt.name)) {
      defs.push({ name: stmt.name, node: stmt });
    }
  }
  const first = defs[0];
  if (first !== undefined) {
    return defs;
  }
  const guard = mainGuard(unit.tree, wanted);
  return guard === undefined ? [] : [guard];
}

function mainGuard(
  tree: PythonNode,
  wanted: ReadonlySet<string>,
): { name: string; node: PythonNode } | undefined {
  for (const stmt of asNodes(tree.body)) {
    if (stmt._type !== "If" || !isPythonNode(stmt.test) || stmt.test._type !== "Compare") {
      continue;
    }
    const left = stmt.test.left;
    if (!isPythonNode(left) || left._type !== "Name" || left.id !== "__name__") {
      continue;
    }
    if (!asNodes(stmt.test.comparators).some((item) => stringConstant(item) === "__main__")) {
      continue;
    }
    let found: string | undefined;
    walkNodes(stmt, (node) => {
      if (node._type !== "Call") {
        return;
      }
      const name = lastAttr(node.func);
      if (name !== undefined && wanted.has(name)) {
        found ??= name;
      }
    });
    if (found !== undefined) {
      return { name: found, node: stmt };
    }
  }
  return undefined;
}
