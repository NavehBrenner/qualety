import { defineRule, type RuleContext } from "qualety";
import type { PythonNode } from "./python.ts";
import {
  asNodes,
  isPublicCallable,
  isPythonNode,
  isSkippedSource,
  nameRange,
  publicInitNames,
  walkCallables,
} from "./walk.ts";

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
