import { defineRule, type RuleContext } from "qualety";
import type { PythonNode, PythonSource } from "./python.ts";
import {
  asNodes,
  childNodes,
  hasDecorator,
  isDunder,
  isInitModule,
  isPythonNode,
  isSkippedSource,
  nameRange,
  readDunderAll,
} from "./walk.ts";

const OVERLOAD = new Set(["overload"]);
const TYPED_HINT =
  "Add type annotations to every parameter (including *args/**kwargs) and the return type.";

export const requireTypedPublic = defineRule({
  meta: {
    requires: ["python"],
    docs: {
      description: "Public callables must have parameter and return annotations.",
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
      const initNames = publicInitNames(unit);
      walkCallables(unit.tree, "", false, (fn, className, nested) => {
        considerTyped(fn, className, nested, initNames, unit.file, context);
      });
    }
  },
});

function publicInitNames(unit: PythonSource): Set<string> | undefined {
  if (!isInitModule(unit.file)) {
    return undefined;
  }
  const all = readDunderAll(unit.tree);
  if (all.kind !== "names") {
    return new Set();
  }
  const names = new Set<string>();
  for (const item of all.names) {
    if (!item.name.startsWith("_")) {
      names.add(item.name);
    }
  }
  return names;
}

function walkCallables(
  node: PythonNode,
  className: string,
  inFn: boolean,
  visit: (fn: PythonNode, className: string, nested: boolean) => void,
) {
  if (node._type === "FunctionDef" || node._type === "AsyncFunctionDef") {
    visit(node, className, inFn);
    for (const child of childNodes(node)) {
      walkCallables(child, "", true, visit);
    }
    return;
  }
  if (node._type === "ClassDef") {
    const next = typeof node.name === "string" ? node.name : className;
    for (const child of childNodes(node)) {
      walkCallables(child, next, inFn, visit);
    }
    return;
  }
  for (const child of childNodes(node)) {
    walkCallables(child, className, inFn, visit);
  }
}

function considerTyped(
  fn: PythonNode,
  className: string,
  nested: boolean,
  initNames: Set<string> | undefined,
  file: string,
  context: Pick<RuleContext, "report">,
) {
  if (!isPublicCallable(fn, className, nested, initNames)) {
    return;
  }
  if (!isPythonNode(fn.args) || fn.args._type !== "arguments") {
    return;
  }
  if (!missingTypes(fn)) {
    return;
  }
  const name = typeof fn.name === "string" ? fn.name : "";
  context.report({
    severity: "error",
    file,
    range: nameRange(fn),
    message: `"${name}" is public and is missing parameter or return annotations.`,
    suggestion: TYPED_HINT,
  });
}

function isPublicCallable(
  fn: PythonNode,
  className: string,
  nested: boolean,
  initNames: Set<string> | undefined,
): boolean {
  if (nested || typeof fn.name !== "string") {
    return false;
  }
  if (fn.name.startsWith("_") || isDunder(fn.name) || className.startsWith("_")) {
    return false;
  }
  if (hasDecorator(fn, OVERLOAD)) {
    return false;
  }
  if (initNames !== undefined && !initNames.has(fn.name)) {
    return false;
  }
  return true;
}

function missingTypes(fn: PythonNode): boolean {
  if (!isPythonNode(fn.args)) {
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
    if (arg.arg === "self" || arg.arg === "cls") {
      continue;
    }
    if (arg.annotation === null || arg.annotation === undefined) {
      return true;
    }
  }
  return fn.returns === null || fn.returns === undefined;
}
