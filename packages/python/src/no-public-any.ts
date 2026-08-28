import { defineRule } from "qualety";
import type { PythonNode, PythonSource } from "./python.ts";
import {
  asNodes,
  isPublicCallable,
  isPythonNode,
  isSkippedSource,
  nameRange,
  publicInitNames,
  walkCallables,
} from "./walk.ts";

const ANY_HINT = "Replace Any with a real type, object, or a Protocol/TypedDict as appropriate.";

export const noPublicAny = defineRule({
  meta: {
    requires: ["python"],
    docs: {
      description: "Public callables must not annotate parameters or return type as Any.",
    },
  },
  create(context) {
    const python = context.getArtifact("python");
    if (!(python.sources instanceof Map)) {
      return;
    }
    const cwd = context.getCwd();
    for (const [abs, unit] of python.sources) {
      if (isSkippedSource(abs, cwd)) {
        continue;
      }
      const aliases = readAnyAliases(unit);
      const initNames = publicInitNames(unit);
      walkCallables(unit.tree, "", false, (fn, className, nested) => {
        if (!isPublicCallable(fn, className, nested, initNames)) {
          return;
        }
        if (!hasBareAny(fn, aliases)) {
          return;
        }
        const name = typeof fn.name === "string" ? fn.name : "";
        context.report({
          severity: "error",
          file: unit.file,
          range: nameRange(fn),
          message: `"${name}" is public and annotates a parameter or return type as Any.`,
          suggestion: ANY_HINT,
        });
      });
    }
  },
});

function hasBareAny(fn: PythonNode, aliases: ReadonlySet<string>): boolean {
  if (!isPythonNode(fn.args) || fn.args._type !== "arguments") {
    return false;
  }
  const args = fn.args;
  const params = [...asNodes(args.posonlyargs), ...asNodes(args.args), ...asNodes(args.kwonlyargs)];
  if (isPythonNode(args.vararg)) {
    params.push(args.vararg);
  }
  if (isPythonNode(args.kwarg)) {
    params.push(args.kwarg);
  }
  for (const arg of params) {
    if (isBareAny(arg.annotation, aliases)) {
      return true;
    }
  }
  return isBareAny(fn.returns, aliases);
}

function isBareAny(node: unknown, aliases: ReadonlySet<string>): boolean {
  if (!isPythonNode(node)) {
    return false;
  }
  if (node._type === "Name" && typeof node.id === "string") {
    return node.id === "Any" || aliases.has(node.id);
  }
  if (node._type !== "Attribute" || node.attr !== "Any" || !isPythonNode(node.value)) {
    return false;
  }
  return node.value._type === "Name" && node.value.id === "typing";
}

function readAnyAliases(unit: PythonSource): Set<string> {
  const aliases = new Set<string>();
  for (const stmt of asNodes(unit.tree.body)) {
    if (stmt._type === "ImportFrom" || stmt._type === "Assign") {
      addImportedAny(stmt, aliases);
      addAssignedAny(stmt, aliases);
    }
  }
  return aliases;
}

function addImportedAny(stmt: PythonNode, aliases: Set<string>) {
  if (stmt._type === "ImportFrom" && stmt.module === "typing") {
    for (const alias of asNodes(stmt.names)) {
      if (alias.name === "Any" && typeof alias.asname === "string") {
        aliases.add(alias.asname);
      }
    }
  }
}

function addAssignedAny(stmt: PythonNode, aliases: Set<string>) {
  if (stmt._type === "Assign") {
    const targets = asNodes(stmt.targets);
    const target = targets[0];
    if (targets.length === 1 && isPythonNode(target) && target._type === "Name") {
      if (typeof target.id === "string" && isBareAny(stmt.value, new Set())) {
        aliases.add(target.id);
      }
    }
  }
}
