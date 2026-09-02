import { defineRule, type RuleContext } from "qualety";
import {
  attrChain,
  collectModuleBinds,
  firstTrainingNode,
  isBefore,
  isDataLoaderCall,
  isNnConstructCall,
  isSkippedSource,
  isTrainingModule,
  lastAttr,
  type ModuleBind,
  type NodePos,
  nodePos,
  nodeRange,
  type PythonNode,
  type PythonSource,
  pythonSources,
  walkNodes,
} from "./ast.ts";

const SEED_HINT =
  "Call torch.manual_seed (and random.seed / np.random.seed as needed) before loaders/model init.";

export const requireGlobalSeed = defineRule({
  meta: {
    requires: ["python"],
    docs: {
      description:
        "A training module must seed framework RNGs before DataLoader or torch.nn construction.",
    },
  },
  create(context) {
    const cwd = context.getCwd();
    for (const unit of pythonSources(context.getArtifact("python"))) {
      if (isSkippedSource(unit.file, cwd) || !isTrainingModule(unit.tree)) {
        continue;
      }
      checkUnit(unit, context);
    }
  },
});

function checkUnit(unit: PythonSource, context: Pick<RuleContext, "report">) {
  const binds = collectModuleBinds(unit.tree);
  const required = requiredSeedKinds(binds);
  const seeds = collectSeedCalls(unit.tree, binds);
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
  const consumer = earliestConsumer(unit.tree);
  if (consumer === undefined) {
    return;
  }
  const late = seeds.filter((seed) => !isBefore(seed.pos, nodePos(consumer)));
  if (late.length === 0) {
    return;
  }
  const target = late[0]?.node ?? consumer;
  context.report({
    severity: "error",
    file: unit.file,
    range: nodeRange(target),
    message: "Seed calls appear after the first DataLoader or torch.nn construction.",
    suggestion: SEED_HINT,
  });
}

function requiredSeedKinds(binds: readonly ModuleBind[]): string[] {
  const kinds = ["torch.manual_seed"];
  if (binds.some((bind) => isStdlibRandom(bind))) {
    kinds.push("random.seed");
  }
  if (binds.some((bind) => isNumpyBind(bind))) {
    kinds.push("np.random.seed");
  }
  return kinds;
}

function collectSeedCalls(
  tree: PythonNode,
  binds: readonly ModuleBind[],
): { kind: string; node: PythonNode; pos: NodePos }[] {
  const found: { kind: string; node: PythonNode; pos: NodePos }[] = [];
  walkNodes(tree, (node) => {
    if (node._type !== "Call") {
      return;
    }
    const kind = seedCallKind(node, binds);
    if (kind !== undefined) {
      found.push({ kind, node, pos: nodePos(node) });
    }
  });
  return found;
}

function seedCallKind(node: PythonNode, binds: readonly ModuleBind[]): string | undefined {
  if (isTorchManualSeed(node, binds)) {
    return "torch.manual_seed";
  }
  if (isRandomSeedCall(node, binds)) {
    return "random.seed";
  }
  if (isNumpySeedCall(node, binds)) {
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
  return isTorchModule(chain[0], binds);
}

function isRandomSeedCall(node: PythonNode, binds: readonly ModuleBind[]): boolean {
  const chain = attrChain(node.func);
  if (chain[chain.length - 1] !== "seed") {
    return false;
  }
  const imported = binds.some(
    (bind) => bind.module === "random" && bind.imported === "seed" && chain[0] === bind.local,
  );
  if (imported && chain.length === 1) {
    return true;
  }
  return chain.length === 2 && isStdlibRandomName(chain[0], binds);
}

function isNumpySeedCall(node: PythonNode, binds: readonly ModuleBind[]): boolean {
  const chain = attrChain(node.func);
  if (chain[chain.length - 1] !== "seed") {
    return false;
  }
  const imported = binds.some(
    (bind) =>
      bind.imported === "seed" &&
      (bind.module === "numpy.random" || bind.module === "numpy") &&
      chain[0] === bind.local,
  );
  if (imported && chain.length === 1) {
    return true;
  }
  return isNumpyRandomReceiver(chain, binds);
}

function earliestConsumer(tree: PythonNode): PythonNode | undefined {
  const loaders: PythonNode[] = [];
  const modules: PythonNode[] = [];
  walkNodes(tree, (node) => {
    if (isDataLoaderCall(node)) {
      loaders.push(node);
    } else if (isNnConstructCall(node)) {
      modules.push(node);
    }
  });
  const pool = loaders.length > 0 ? loaders : modules;
  let best: PythonNode | undefined;
  for (const node of pool) {
    if (best === undefined || isBefore(nodePos(node), nodePos(best))) {
      best = node;
    }
  }
  return best;
}

function isStdlibRandom(bind: ModuleBind): boolean {
  return bind.module === "random" || bind.module.startsWith("random.");
}

function isNumpyBind(bind: ModuleBind): boolean {
  return bind.module === "numpy" || bind.module.startsWith("numpy.");
}

function isTorchModule(root: string | undefined, binds: readonly ModuleBind[]): boolean {
  if (root === undefined) {
    return false;
  }
  return binds.some(
    (bind) => bind.local === root && torchRoot(bind.module) && bind.imported === undefined,
  );
}

function torchRoot(module: string): boolean {
  return module === "torch" || module.startsWith("torch.");
}

function isStdlibRandomName(root: string | undefined, binds: readonly ModuleBind[]): boolean {
  if (root === undefined) {
    return false;
  }
  return binds.some(
    (bind) => bind.local === root && isStdlibRandom(bind) && bind.imported === undefined,
  );
}

function isNumpyRandomReceiver(chain: readonly string[], binds: readonly ModuleBind[]): boolean {
  const root = chain[0];
  if (root === undefined || chain.length < 2) {
    return false;
  }
  const bind = binds.find((item) => item.local === root);
  if (bind === undefined) {
    return false;
  }
  if (bind.module === "numpy.random" || (bind.imported === "random" && bind.module === "numpy")) {
    return true;
  }
  return isNumpyBind(bind) && chain.includes("random");
}
