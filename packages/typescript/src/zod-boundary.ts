import { defineRule, type RuleContext } from "qualety";
import { Node, SourceFile } from "ts-morph";
import { enclosingFunction } from "./narrowing.ts";
import {
  aliasesOf,
  BOUNDARY_NAMES,
  BOUNDARY_PREFIX,
  type FunctionLike,
  firstArgIdentifier,
  functionLikeName,
  isFunctionLike,
  isJsonParseCall,
  isPropertyUse,
  isSchemaParseCall,
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
      if (!(unit instanceof SourceFile)) {
        continue;
      }
      unit.forEachDescendant((node) => {
        if (isFunctionLike(node)) {
          scanBoundary(node, abs, context);
        }
        if (isJsonParseCall(node)) {
          scanJsonParse(node, abs, context);
        }
      });
    }
  },
});

function scanBoundary(fn: FunctionLike, file: string, context: Pick<RuleContext, "report">) {
  const name = functionLikeName(fn);
  if (name === undefined || !(BOUNDARY_NAMES.has(name) || BOUNDARY_PREFIX.test(name))) {
    return;
  }
  for (const param of unknownParamNames(fn)) {
    reportUsesBeforeParse(
      fn,
      aliasesOf(fn, param),
      file,
      context,
      `Load/parse function "${name}" uses untrusted parameter "${param}" before schema.parse/safeParse.`,
    );
  }
}

function scanJsonParse(node: Node, file: string, context: Pick<RuleContext, "report">) {
  const parseParent = node.getParent();
  if (
    parseParent !== undefined &&
    isSchemaParseCall(parseParent) &&
    parseParent.getArguments().includes(node)
  ) {
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
      range: {
        start: parent.getSourceFile().getLineAndColumnAtPos(parent.getStart()),
        end: parent.getSourceFile().getLineAndColumnAtPos(parent.getEnd()),
      },
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
  reportUsesBeforeParse(
    fn,
    aliasesOf(fn, binding),
    file,
    context,
    "JSON.parse result is used before schema.parse/safeParse.",
  );
}

function reportUsesBeforeParse(
  fn: FunctionLike,
  names: ReadonlySet<string>,
  file: string,
  context: Pick<RuleContext, "report">,
  message: string,
) {
  const parseAt = firstParsePos(fn, names);
  for (const node of fn.getDescendants()) {
    if (!isPropertyUse(node, names)) {
      continue;
    }
    if (parseAt !== undefined && node.getStart() > parseAt) {
      continue;
    }
    context.report({
      severity: "error",
      file,
      range: {
        start: node.getSourceFile().getLineAndColumnAtPos(node.getStart()),
        end: node.getSourceFile().getLineAndColumnAtPos(node.getEnd()),
      },
      message,
      suggestion: PARSE_SUGGESTION,
    });
  }
}

function firstParsePos(fn: Node, names: ReadonlySet<string>): number | undefined {
  let pos: number | undefined;
  for (const node of fn.getDescendants()) {
    if (!isSchemaParseCall(node)) {
      continue;
    }
    const arg = firstArgIdentifier(node);
    if (arg === undefined || !names.has(arg)) {
      continue;
    }
    const start = node.getStart();
    if (pos === undefined || start < pos) {
      pos = start;
    }
  }
  return pos;
}
