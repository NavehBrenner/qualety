import { defineRule, type RuleContext } from "qualety";
import type { PythonNode } from "./python.ts";
import { asNodes, forEachPythonSource, isPythonNode, nodeRange, walkNodes } from "./walk.ts";

const MUTATORS = new Set(["insert", "append", "extend"]);
const PATH_HINT =
  "Install the package editable or use a proper package layout; do not mutate sys.path at runtime.";

type SysBinds = {
  sys: Set<string>;
  path: Set<string>;
  hooks: Set<string>;
};

export const noSysPathHack = defineRule({
  meta: {
    requires: ["python"],
    docs: {
      description: "Do not mutate sys.path or sys.path_hooks to fix imports.",
    },
  },
  create(context) {
    const python = context.getArtifact("python");
    forEachPythonSource(python.sources, context.getCwd(), (unit) => {
      const binds: SysBinds = { sys: new Set(), path: new Set(), hooks: new Set() };
      walkNodes(unit.tree, (node) => {
        addSysModule(node, binds);
        addSysNames(node, binds);
        considerMutation(node, binds, unit.file, context);
      });
    });
  },
});

function addSysModule(node: PythonNode, binds: SysBinds) {
  if (node._type === "Import") {
    for (const alias of asNodes(node.names)) {
      if (alias.name === "sys") {
        binds.sys.add(typeof alias.asname === "string" ? alias.asname : "sys");
      }
    }
  }
}

function addSysNames(node: PythonNode, binds: SysBinds) {
  if (node._type === "ImportFrom" && node.module === "sys") {
    if (typeof node.level !== "number" || node.level === 0) {
      for (const alias of asNodes(node.names)) {
        bindSysName(alias, binds);
      }
    }
  }
}

function bindSysName(alias: PythonNode, binds: SysBinds) {
  const local = typeof alias.asname === "string" ? alias.asname : alias.name;
  if (typeof local === "string") {
    if (alias.name === "path") {
      binds.path.add(local);
    }
    if (alias.name === "path_hooks") {
      binds.hooks.add(local);
    }
  }
}

function considerMutation(
  node: PythonNode,
  binds: SysBinds,
  file: string,
  context: Pick<RuleContext, "report">,
) {
  if (node._type === "Call") {
    if (!isPythonNode(node.func) || node.func._type !== "Attribute") {
      return;
    }
    if (typeof node.func.attr !== "string" || !MUTATORS.has(node.func.attr)) {
      return;
    }
    reportPathWrite(node.func.value, node, binds, file, context);
    return;
  }
  if (node._type === "AugAssign") {
    reportPathWrite(node.target, node, binds, file, context);
    return;
  }
  if (node._type === "Assign") {
    for (const target of asNodes(node.targets)) {
      reportPathWrite(target, node, binds, file, context);
    }
  }
}

function reportPathWrite(
  target: unknown,
  mutation: PythonNode,
  binds: SysBinds,
  file: string,
  context: Pick<RuleContext, "report">,
) {
  const kind =
    pathKind(target, binds) ??
    (isPythonNode(target) && target._type === "Subscript"
      ? pathKind(target.value, binds)
      : undefined);
  if (kind === "path") {
    context.report({
      severity: "error",
      file,
      range: nodeRange(mutation),
      message: "sys.path is mutated at runtime to fix imports.",
      suggestion: PATH_HINT,
    });
    return;
  }
  if (kind === "hooks") {
    context.report({
      severity: "error",
      file,
      range: nodeRange(mutation),
      message: "sys.path_hooks is mutated at runtime to fix imports.",
      suggestion: PATH_HINT,
    });
  }
}

function pathKind(node: unknown, binds: SysBinds): "path" | "hooks" | undefined {
  if (!isPythonNode(node)) {
    return undefined;
  }
  if (node._type === "Name" && typeof node.id === "string") {
    if (binds.path.has(node.id)) {
      return "path";
    }
    if (binds.hooks.has(node.id)) {
      return "hooks";
    }
    return undefined;
  }
  if (node._type !== "Attribute" || typeof node.attr !== "string" || !isPythonNode(node.value)) {
    return undefined;
  }
  if (node.value._type !== "Name" || typeof node.value.id !== "string") {
    return undefined;
  }
  if (!binds.sys.has(node.value.id)) {
    return undefined;
  }
  if (node.attr === "path") {
    return "path";
  }
  if (node.attr === "path_hooks") {
    return "hooks";
  }
  return undefined;
}
