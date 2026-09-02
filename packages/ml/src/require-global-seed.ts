import { asNodes, nodeRange, type PythonNode, walkNodes } from "@qualety/python/walk";
import { defineRule } from "qualety";
import {
  attrChain,
  firstTrainingNode,
  forEachMlSource,
  isBefore,
  isDataLoaderCall,
  lastAttr,
  type NodePos,
  nodePos,
} from "./ast.ts";

const SEED_HINT =
  "Call torch.manual_seed (and random.seed / np.random.seed as needed) before loaders/model init.";

type ModuleBind = { local: string; module: string; imported?: string };

export const requireGlobalSeed = defineRule({
  meta: {
    requires: ["python"],
    docs: {
      description:
        "A training module must seed framework RNGs before DataLoader or torch.nn construction.",
    },
  },
  create(context) {
    for (const python of [context.getArtifact("python")]) {
      // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: inlined seed-order scan
      forEachMlSource(python.sources, context.getCwd(), { trainingOnly: true }, (unit) => {
        const binds: ModuleBind[] = [];
        for (const stmt of asNodes(unit.tree.body)) {
          if (stmt._type === "Import") {
            for (const alias of asNodes(stmt.names)) {
              if (typeof alias.name !== "string") {
                continue;
              }
              const local =
                typeof alias.asname === "string" ? alias.asname : alias.name.split(".")[0];
              if (typeof local === "string") {
                binds.push({ local, module: alias.name });
              }
            }
          }
          if (stmt._type === "ImportFrom") {
            const module = typeof stmt.module === "string" ? stmt.module : "";
            const level = typeof stmt.level === "number" ? stmt.level : 0;
            if (level === 0 && module.length > 0) {
              for (const alias of asNodes(stmt.names)) {
                if (typeof alias.name !== "string" || alias.name === "*") {
                  continue;
                }
                const local = typeof alias.asname === "string" ? alias.asname : alias.name;
                binds.push({ local, module, imported: alias.name });
              }
            }
          }
        }
        const required = ["torch.manual_seed"];
        if (binds.some((bind) => isStdlibRandom(bind))) {
          required.push("random.seed");
        }
        if (binds.some((bind) => isNumpyBind(bind))) {
          required.push("np.random.seed");
        }
        const seeds: { kind: string; node: PythonNode; pos: NodePos }[] = [];
        walkNodes(unit.tree, (node) => {
          if (node._type !== "Call") {
            return;
          }
          const kind = seedCallKind(node, binds);
          if (kind !== undefined) {
            seeds.push({ kind, node, pos: nodePos(node) });
          }
        });
        const missing = required.filter((kind) => !seeds.some((seed) => seed.kind === kind));
        const evidence = firstTrainingNode(unit.tree) ?? unit.tree;
        if (missing.length > 0) {
          context.report({
            severity: "error",
            file: unit.file,
            range: nodeRange(evidence),
            message: `Training module is missing ${missing.join(", ")} before DataLoader or model init.`,
            suggestion: SEED_HINT,
          });
          return;
        }
        const loaders: PythonNode[] = [];
        const modules: PythonNode[] = [];
        walkNodes(unit.tree, (node) => {
          if (isDataLoaderCall(node)) {
            loaders.push(node);
          } else if (node._type === "Call") {
            const chain = attrChain(node.func);
            if (chain.length >= 2 && chain[chain.length - 2] === "nn") {
              modules.push(node);
            }
          }
        });
        const pool = loaders[0] !== undefined ? loaders : modules;
        let consumer: PythonNode | undefined;
        for (const node of pool) {
          if (consumer === undefined || isBefore(nodePos(node), nodePos(consumer))) {
            consumer = node;
          }
        }
        if (consumer === undefined) {
          return;
        }
        const firstLate = seeds.filter((seed) => !isBefore(seed.pos, nodePos(consumer)))[0];
        if (firstLate === undefined) {
          return;
        }
        context.report({
          severity: "error",
          file: unit.file,
          range: nodeRange(firstLate.node),
          message: "Seed calls appear after the first DataLoader or torch.nn construction.",
          suggestion: SEED_HINT,
        });
      });
    }
  },
});

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: inlined random/numpy seed detectors; splitting recreates dry twins
function seedCallKind(node: PythonNode, binds: readonly ModuleBind[]): string | undefined {
  if (isTorchManualSeed(node, binds)) {
    return "torch.manual_seed";
  }
  const chain = attrChain(node.func);
  if (chain[chain.length - 1] !== "seed") {
    return undefined;
  }
  const randomImported = binds.some(
    (bind) => bind.module === "random" && bind.imported === "seed" && chain[0] === bind.local,
  );
  if (randomImported && chain.length === 1) {
    return "random.seed";
  }
  const randomRoot = chain[0];
  if (
    chain.length === 2 &&
    randomRoot !== undefined &&
    binds.some(
      (bind) => bind.local === randomRoot && isStdlibRandom(bind) && bind.imported === undefined,
    )
  ) {
    return "random.seed";
  }
  const numpyImported = binds.some(
    (bind) =>
      bind.imported === "seed" &&
      (bind.module === "numpy.random" || bind.module === "numpy") &&
      chain[0] === bind.local,
  );
  if (numpyImported && chain.length === 1) {
    return "np.random.seed";
  }
  const root = chain[0];
  if (root === undefined || chain.length < 2) {
    return undefined;
  }
  const bind = binds.find((item) => item.local === root);
  if (bind === undefined) {
    return undefined;
  }
  if (bind.module === "numpy.random" || (bind.imported === "random" && bind.module === "numpy")) {
    return "np.random.seed";
  }
  if (isNumpyBind(bind) && chain.includes("random")) {
    return "np.random.seed";
  }
  return undefined;
}

function isTorchManualSeed(node: PythonNode, binds: readonly ModuleBind[]): boolean {
  const chain = attrChain(node.func);
  const imported = binds.some(
    (bind) => bind.module === "torch" && bind.imported === "manual_seed" && chain[0] === bind.local,
  );
  if (imported && chain.length === 1) {
    return true;
  }
  if (lastAttr(node.func) !== "manual_seed" || chain[1] === "cuda") {
    return false;
  }
  const root = chain[0];
  if (root === undefined) {
    return false;
  }
  return binds.some(
    (bind) =>
      bind.local === root &&
      (bind.module === "torch" || bind.module.startsWith("torch.")) &&
      bind.imported === undefined,
  );
}

function isStdlibRandom(bind: ModuleBind): boolean {
  return bind.module === "random" || bind.module.startsWith("random.");
}

function isNumpyBind(bind: ModuleBind): boolean {
  return bind.module === "numpy" || bind.module.startsWith("numpy.");
}
