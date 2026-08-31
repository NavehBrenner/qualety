import { defineRule, type RuleContext } from "qualety";
import type { PythonNode, PythonSource } from "./python.ts";
import {
  asNodes,
  childNodes,
  clearReexports,
  collectImports,
  type FileBinds,
  isInitModule,
  isPythonNode,
  isSkippedSource,
  isTestPath,
  nodeRange,
  readDunderAll,
} from "./walk.ts";

export const publicExportsTested = defineRule({
  meta: {
    requires: ["python"],
    docs: {
      description:
        "Every public name on a package __init__ / __all__ surface must be referenced from a test path.",
    },
  },
  create(context) {
    const cwd = context.getCwd();
    const artifact = context.getArtifact("python");
    if (!(artifact.sources instanceof Map)) {
      return;
    }
    const tested = collectTestedNames(artifact.sources, cwd);
    for (const [abs, unit] of artifact.sources) {
      if (!isInitModule(abs) || isSkippedSource(abs, cwd)) {
        continue;
      }
      reportUntested(unit, tested, artifact.sources, context);
    }
  },
});

function reportUntested(
  unit: PythonSource,
  tested: ReadonlySet<string>,
  sources: ReadonlyMap<string, PythonSource>,
  context: Pick<RuleContext, "report">,
) {
  const all = readDunderAll(unit.tree);
  if (all.kind === "silence") {
    return;
  }
  const publics =
    all.kind === "names"
      ? all.names.filter((item) => !item.name.startsWith("_"))
      : clearReexports(unit.tree);
  const binds = collectImports(unit, sources);
  for (const item of publics) {
    if (tested.has(`${unit.file}#${item.name}`)) {
      continue;
    }
    const bind = binds.named.get(item.name) ?? simpleAliasBind(item.name, unit.tree, binds);
    if (bind !== undefined && tested.has(`${bind.file}#${bind.name}`)) {
      continue;
    }
    context.report({
      severity: "error",
      file: unit.file,
      range: nodeRange(item.node),
      message: `Public export "${item.name}" is not referenced from a test.`,
      suggestion: `Add a test import of "${item.name}", or stop exporting it.`,
    });
  }
}

function simpleAliasBind(name: string, tree: PythonNode, binds: FileBinds) {
  for (const stmt of asNodes(tree.body)) {
    if (stmt._type !== "Assign") {
      continue;
    }
    const targets = asNodes(stmt.targets);
    const target = targets[0];
    if (
      targets.length !== 1 ||
      !isPythonNode(target) ||
      target._type !== "Name" ||
      target.id !== name ||
      !isPythonNode(stmt.value) ||
      stmt.value._type !== "Name" ||
      typeof stmt.value.id !== "string"
    ) {
      continue;
    }
    return binds.named.get(stmt.value.id);
  }
  return undefined;
}

function collectTestedNames(sources: ReadonlyMap<string, PythonSource>, cwd: string): Set<string> {
  const tested = new Set<string>();
  for (const [abs, unit] of sources) {
    if (!isTestPath(abs, cwd)) {
      continue;
    }
    const binds = collectImports(unit, sources);
    for (const named of binds.named.values()) {
      tested.add(`${named.file}#${named.name}`);
    }
    walkAttributes(unit.tree, binds, tested);
  }
  return tested;
}

function walkAttributes(node: PythonNode, binds: FileBinds, tested: Set<string>) {
  if (node._type === "Attribute" && typeof node.attr === "string" && isPythonNode(node.value)) {
    if (node.value._type === "Name" && typeof node.value.id === "string") {
      const moduleFile = binds.modules.get(node.value.id);
      if (moduleFile !== undefined) {
        tested.add(`${moduleFile}#${node.attr}`);
      }
    }
  }
  for (const child of childNodes(node)) {
    walkAttributes(child, binds, tested);
  }
}
