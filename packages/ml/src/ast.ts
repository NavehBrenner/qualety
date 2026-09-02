import {
  asNodes,
  forEachPythonSource,
  isPythonNode,
  type PythonNode,
  type PythonSource,
  walkNodes,
} from "@qualety/python/walk";

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
