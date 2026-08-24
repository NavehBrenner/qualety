import { defineRule, type RuleContext } from "qualety";
import { Node, SourceFile } from "ts-morph";
import {
  aliasesOf,
  type FunctionLike,
  firstArgIdentifier,
  functionLikeName,
  isArgToSchemaParse,
  isBoundaryName,
  isFunctionLike,
  isJsonParseCall,
  isPropertyUse,
  isSchemaParseCall,
  rangeOf,
  unknownParamNames,
} from "./parse-flow.ts";

const PARSE_SUGGESTION =
  "Call schema.safeParse(...) or schema.parse(...) on this value before reading its properties.";

export const zodBoundary = defineRule({
  meta: {
    requires: ["typescript"],
    docs: {
      description:
        "Load/parse boundaries typed unknown and JSON.parse results must be schema-parsed before property access.",
    },
  },
  create(context) {
    const sources = context.getArtifact("typescript").sources;
    for (const [abs, unit] of sources) {
      if (unit instanceof SourceFile) {
        scanFile(unit, abs, context);
      }
    }
  },
});

function scanFile(sourceFile: SourceFile, file: string, context: Pick<RuleContext, "report">) {
  sourceFile.forEachDescendant((node) => {
    if (isFunctionLike(node)) {
      scanBoundary(node, file, context);
    }
    if (isJsonParseCall(node)) {
      scanJsonParse(node, file, context);
    }
  });
}

function scanBoundary(fn: FunctionLike, file: string, context: Pick<RuleContext, "report">) {
  const name = functionLikeName(fn);
  if (name === undefined || !isBoundaryName(name)) {
    return;
  }
  for (const param of unknownParamNames(fn)) {
    const names = aliasesOf(fn, param);
    const parseAt = firstParsePos(fn, names);
    fn.forEachDescendant((node) => {
      if (!isPropertyUse(node, names)) {
        return;
      }
      if (parseAt !== undefined && node.getStart() > parseAt) {
        return;
      }
      context.report({
        severity: "error",
        file,
        range: rangeOf(node),
        message: `Load/parse function "${name}" uses untrusted parameter "${param}" before schema.parse/safeParse.`,
        suggestion: PARSE_SUGGESTION,
      });
    });
  }
}

function scanJsonParse(node: Node, file: string, context: Pick<RuleContext, "report">) {
  if (isArgToSchemaParse(node)) {
    return;
  }
  const parent = node.getParent();
  if (
    parent !== undefined &&
    (Node.isPropertyAccessExpression(parent) || Node.isElementAccessExpression(parent))
  ) {
    context.report({
      severity: "error",
      file,
      range: rangeOf(parent),
      message: "JSON.parse result is used before schema.parse/safeParse.",
      suggestion: PARSE_SUGGESTION,
    });
    return;
  }
  if (!Node.isVariableDeclaration(parent) || !Node.isCallExpression(node)) {
    return;
  }
  const binding = parent.getName();
  const fn = enclosingFunction(node);
  if (fn === undefined) {
    return;
  }
  const names = aliasesOf(fn, binding);
  const parseAt = firstParsePos(fn, names);
  fn.forEachDescendant((child) => {
    if (!isPropertyUse(child, names)) {
      return;
    }
    if (parseAt !== undefined && child.getStart() > parseAt) {
      return;
    }
    context.report({
      severity: "error",
      file,
      range: rangeOf(child),
      message: "JSON.parse result is used before schema.parse/safeParse.",
      suggestion: PARSE_SUGGESTION,
    });
  });
}

function firstParsePos(fn: Node, names: ReadonlySet<string>): number | undefined {
  let pos: number | undefined;
  fn.forEachDescendant((node) => {
    if (!isSchemaParseCall(node)) {
      return;
    }
    const arg = firstArgIdentifier(node);
    if (arg === undefined || !names.has(arg)) {
      return;
    }
    const start = node.getStart();
    if (pos === undefined || start < pos) {
      pos = start;
    }
  });
  return pos;
}

function enclosingFunction(node: Node) {
  let current: Node | undefined = node.getParent();
  while (current !== undefined) {
    if (isFunctionLike(current)) {
      return current;
    }
    current = current.getParent();
  }
  return undefined;
}
