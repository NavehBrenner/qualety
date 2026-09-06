import {
  asNodes,
  intConstant,
  isPythonNode,
  nodeRange,
  type PythonNode,
  walkCallables,
} from "@qualety/python/walk";
import { defineRule } from "qualety";
import {
  assignTarget,
  attrChain,
  forEachMlSource,
  isBefore,
  lastAttr,
  type NodePos,
  nodePos,
  walkFunctionBody,
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
        // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: inlined pack/rnn + hidden scan
        walkCallables(unit.tree, "", false, (fn) => {
          const body: PythonNode[] = [];
          walkFunctionBody(fn, (node) => {
            body.push(node);
          });
          const packs: NodePos[] = [];
          const rnns: PythonNode[] = [];
          for (const node of body) {
            if (node._type === "Call") {
              const name = lastAttr(node.func);
              if (name === "pack_padded_sequence" || name === "pack_sequence") {
                packs.push(nodePos(node));
              }
            }
            if (isRnnCall(node)) {
              rnns.push(node);
            }
          }
          for (const rnn of rnns) {
            const pos = nodePos(rnn);
            if (packs.some((pack) => isBefore(pack, pos))) {
              continue;
            }
            if (
              !body.some(
                (node) =>
                  (isIndexOne(node) && node.value === rnn) || assignConsumesHidden(node, rnn, body),
              )
            ) {
              continue;
            }
            context.report({
              severity: "error",
              file: unit.file,
              range: nodeRange(rnn),
              message:
                "RNN/LSTM/GRU consumes h_n from a padded sequence without pack_padded_sequence.",
              suggestion: PACK_HINT,
            });
          }
        });
      });
    }
  },
});

function isRnnCall(node: PythonNode): node is PythonNode & { readonly _type: "Call" } {
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

function assignConsumesHidden(
  node: PythonNode,
  rnn: PythonNode,
  body: readonly PythonNode[],
): boolean {
  if (node.value !== rnn) {
    return false;
  }
  const target = assignTarget(node);
  if (target === undefined) {
    return false;
  }
  if (target._type === "Name" && typeof target.id === "string") {
    const name = target.id;
    const pos = nodePos(node);
    return body.some((item) => {
      if (!isIndexOne(item) || !isPythonNode(item.value)) {
        return false;
      }
      if (item.value._type !== "Name" || item.value.id !== name) {
        return false;
      }
      return isBefore(pos, nodePos(item));
    });
  }
  const names = hiddenUnpackNames(target);
  if (names === undefined || names.length === 0) {
    return false;
  }
  const pos = nodePos(node);
  return names.some((name) =>
    body.some((item) => {
      if (item._type !== "Name" || item.id !== name) {
        return false;
      }
      if (!isPythonNode(item.ctx) || item.ctx._type !== "Load") {
        return false;
      }
      return isBefore(pos, nodePos(item));
    }),
  );
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

function isIndexOne(node: PythonNode): node is PythonNode & { readonly _type: "Subscript" } {
  if (node._type !== "Subscript" || !isPythonNode(node.slice)) {
    return false;
  }
  let slice = node.slice;
  if (slice._type === "Index" && isPythonNode(slice.value)) {
    slice = slice.value;
  }
  return intConstant(slice) === 1;
}
