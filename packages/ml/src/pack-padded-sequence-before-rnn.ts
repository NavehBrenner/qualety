import {
  asNodes,
  childNodes,
  intConstant,
  isPythonNode,
  nodeRange,
  type PythonNode,
  walkCallables,
} from "@qualety/python/walk";
import { defineRule, type RuleContext } from "qualety";
import {
  assignTarget,
  attrChain,
  forEachMlSource,
  isBefore,
  lastAttr,
  type NodePos,
  nodePos,
  walkSkipDefs,
} from "./ast.ts";

const RNN_NAMES = new Set(["rnn", "lstm", "gru"]);
const PACK_HINT = "Call pack_padded_sequence (or pack_sequence) before the RNN when consuming h_n.";

export const packPaddedSequenceBeforeRnn = defineRule({
  meta: {
    requires: ["python"],
    docs: {
      description:
        "Pack padded sequences before an RNN/LSTM/GRU when the final hidden state is consumed.",
    },
  },
  create(context) {
    for (const python of [context.getArtifact("python")]) {
      forEachMlSource(python.sources, context.getCwd(), { trainingOnly: false }, (unit) => {
        walkCallables(unit.tree, "", false, (fn) => {
          checkFn(fn, unit.file, context);
        });
      });
    }
  },
});

function checkFn(fn: PythonNode, file: string, context: Pick<RuleContext, "report">): void {
  const packs: NodePos[] = [];
  const rnns: PythonNode[] = [];
  walkFn(fn, (node) => {
    if (isPackCall(node)) {
      packs.push(nodePos(node));
    }
    if (isRnnCall(node)) {
      rnns.push(node);
    }
  });
  for (const rnn of rnns) {
    const pos = nodePos(rnn);
    if (packs.some((pack) => isBefore(pack, pos))) {
      continue;
    }
    if (!consumesHidden(fn, rnn)) {
      continue;
    }
    context.report({
      severity: "error",
      file,
      range: nodeRange(rnn),
      message: "RNN/LSTM/GRU consumes h_n from a padded sequence without pack_padded_sequence.",
      suggestion: PACK_HINT,
    });
  }
}

function walkFn(fn: PythonNode, visit: (node: PythonNode) => void): void {
  for (const child of childNodes(fn)) {
    walkSkipDefs(child, visit);
  }
}

function isRnnCall(node: PythonNode): boolean {
  if (node._type !== "Call") {
    return false;
  }
  const chain = attrChain(node.func).map((part) => part.toLowerCase());
  const last = chain[chain.length - 1];
  if (last !== undefined && RNN_NAMES.has(last)) {
    return true;
  }
  return last === "forward" && chain.some((part) => RNN_NAMES.has(part));
}

function isPackCall(node: PythonNode): boolean {
  if (node._type !== "Call") {
    return false;
  }
  const name = lastAttr(node.func);
  return name === "pack_padded_sequence" || name === "pack_sequence";
}

function consumesHidden(fn: PythonNode, rnn: PythonNode): boolean {
  let consumed = false;
  walkFn(fn, (node) => {
    if (consumed) {
      return;
    }
    if (isIndexOne(node) && node.value === rnn) {
      consumed = true;
      return;
    }
    if (assignConsumesHidden(node, rnn, fn)) {
      consumed = true;
    }
  });
  return consumed;
}

function assignConsumesHidden(node: PythonNode, rnn: PythonNode, fn: PythonNode): boolean {
  if (node.value !== rnn) {
    return false;
  }
  const target = assignTarget(node);
  if (target === undefined) {
    return false;
  }
  if (target._type === "Name" && typeof target.id === "string") {
    return resultIndexUsed(fn, target.id, node);
  }
  const names = hiddenUnpackNames(target);
  if (names === undefined || names.length === 0) {
    return false;
  }
  const pos = nodePos(node);
  return names.some((name) => nameLoadedAfter(fn, name, pos));
}

function hiddenUnpackNames(target: PythonNode): string[] | undefined {
  if (target._type !== "Tuple") {
    return undefined;
  }
  const second = asNodes(target.elts)[1];
  if (!isPythonNode(second)) {
    return undefined;
  }
  if (second._type === "Name" && typeof second.id === "string") {
    return second.id === "_" ? [] : [second.id];
  }
  if (second._type !== "Tuple") {
    return undefined;
  }
  const names: string[] = [];
  for (const elt of asNodes(second.elts)) {
    if (elt._type === "Name" && typeof elt.id === "string" && elt.id !== "_") {
      names.push(elt.id);
    }
  }
  return names;
}

function resultIndexUsed(fn: PythonNode, name: string, assign: PythonNode): boolean {
  const pos = nodePos(assign);
  let used = false;
  walkFn(fn, (node) => {
    if (used || !isIndexOne(node) || !isPythonNode(node.value)) {
      return;
    }
    if (node.value._type !== "Name" || node.value.id !== name) {
      return;
    }
    if (isBefore(pos, nodePos(node))) {
      used = true;
    }
  });
  return used;
}

function isIndexOne(node: PythonNode): boolean {
  if (node._type !== "Subscript" || !isPythonNode(node.slice)) {
    return false;
  }
  let slice = node.slice;
  if (slice._type === "Index" && isPythonNode(slice.value)) {
    slice = slice.value;
  }
  return intConstant(slice) === 1;
}

function nameLoadedAfter(fn: PythonNode, name: string, pos: NodePos): boolean {
  let found = false;
  walkFn(fn, (node) => {
    if (found || node._type !== "Name" || node.id !== name) {
      return;
    }
    if (!isPythonNode(node.ctx) || node.ctx._type !== "Load") {
      return;
    }
    if (isBefore(pos, nodePos(node))) {
      found = true;
    }
  });
  return found;
}
