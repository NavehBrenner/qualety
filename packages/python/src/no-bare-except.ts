import { defineRule } from "qualety";
import { asNodes, forEachPythonSource, isPythonNode, nodeRange, walkNodes } from "./walk.ts";

const BARE_HINT =
  "Catch a specific exception type (or Exception if that is intended) and re-raise BaseException subclasses that must not be swallowed.";

export const noBareExcept = defineRule({
  meta: {
    requires: ["python"],
    docs: {
      description: "Do not use a bare except or except BaseException.",
    },
  },
  create(context) {
    const python = context.getArtifact("python");
    forEachPythonSource(python.sources, context.getCwd(), (unit) => {
      walkNodes(unit.tree, (node) => {
        if (node._type !== "ExceptHandler") {
          return;
        }
        const kind = bareKind(node.type);
        if (kind === undefined) {
          return;
        }
        context.report({
          severity: "error",
          file: unit.file,
          range: nodeRange(node),
          message:
            kind === "bare"
              ? "Bare except: catches BaseException, including KeyboardInterrupt and SystemExit."
              : "except BaseException catches KeyboardInterrupt and SystemExit.",
          suggestion: BARE_HINT,
        });
      });
    });
  },
});

function bareKind(type: unknown): "bare" | "base" | undefined {
  if (type === null || type === undefined) {
    return "bare";
  }
  if (isBaseName(type)) {
    return "base";
  }
  if (!isPythonNode(type) || (type._type !== "Tuple" && type._type !== "List")) {
    return undefined;
  }
  for (const elt of asNodes(type.elts)) {
    if (isBaseName(elt)) {
      return "base";
    }
  }
  return undefined;
}

function isBaseName(node: unknown): boolean {
  return isPythonNode(node) && node._type === "Name" && node.id === "BaseException";
}
