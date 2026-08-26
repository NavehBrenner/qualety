import { defineRule, type RuleContext } from "qualety";
import { Node, type SourceFile } from "ts-morph";
import {
  bindFunctionScan,
  type CheckCandidate,
  conditionLeaves,
  conditionNodes,
  diagnoseConstant,
  type FunctionLike,
  hasPriorParse,
  isStrictRefinement,
  shouldReportUnchanged,
  subjectIdentIn,
  truePathRoot,
} from "./narrowing.ts";
import { firstArgIdentifier, isPropertyUse, isSchemaParseCall } from "./parse-flow.ts";

const SUGGESTION =
  "Delete the check, or use a type predicate / asserts / non-empty predicate / schema .data / a narrowed binding.";

export const typeNarrowingChecks = defineRule({
  meta: {
    requires: ["typescript"],
    docs: {
      description:
        "A runtime check on a value is legitimate only if TypeScript sees a strict refinement on the true path.",
    },
  },
  create: bindFunctionScan(scanFunction),
});

function scanFunction(
  fn: FunctionLike,
  file: string,
  sourceFile: SourceFile,
  context: Pick<RuleContext, "report">,
  reported: Set<string>,
) {
  for (const cond of conditionNodes(fn)) {
    if (diagnoseConstant(fn, cond, sourceFile) !== undefined) {
      continue;
    }
    const pathRoot = truePathRoot(cond);
    if (pathRoot === undefined) {
      continue;
    }
    for (const cand of conditionLeaves(fn, cond)) {
      considerLeaf(cand, cond, pathRoot, file, context, reported);
    }
  }
  fn.forEachDescendant((node) => {
    considerRawAfterParse(fn, node, file, sourceFile, context, reported);
  });
}

function considerLeaf(
  cand: CheckCandidate,
  cond: Node,
  pathRoot: Node,
  file: string,
  context: Pick<RuleContext, "report">,
  reported: Set<string>,
) {
  if (cand.kind === "schema-parse") {
    return;
  }
  const beforeNode = subjectIdentIn(cand.node, cand.subject);
  const afterNode = subjectIdentIn(pathRoot, cand.subject);
  if (beforeNode === undefined || afterNode === undefined) {
    return;
  }
  const before = beforeNode.getType();
  const after = afterNode.getType();
  if (isStrictRefinement(before, after) || !shouldReportUnchanged(cand, before, after)) {
    return;
  }
  emitA(context, file, cond, cand.subject, reported);
}

function considerRawAfterParse(
  fn: FunctionLike,
  node: Node,
  file: string,
  sourceFile: SourceFile,
  context: Pick<RuleContext, "report">,
  reported: Set<string>,
) {
  if (!isSchemaParseCall(node)) {
    return;
  }
  const subject = firstArgIdentifier(node);
  if (subject === undefined || hasPriorParse(fn, subject, node.getStart())) {
    return;
  }
  if (diagnoseConstant(fn, node, sourceFile) !== undefined) {
    return;
  }
  let rawUse: Node | undefined;
  fn.forEachDescendant((child) => {
    if (child.getStart() > node.getStart() && isPropertyUse(child, new Set([subject]))) {
      rawUse = rawUse ?? child;
    }
  });
  if (rawUse === undefined || refinedAfterParse(node, rawUse, subject)) {
    return;
  }
  emitA(context, file, node, subject, reported);
}

function refinedAfterParse(parseNode: Node, rawUse: Node, subject: string): boolean {
  const beforeNode = subjectIdentIn(parseNode, subject);
  const afterNode =
    Node.isPropertyAccessExpression(rawUse) || Node.isElementAccessExpression(rawUse)
      ? rawUse.getExpression()
      : subjectIdentIn(rawUse, subject);
  if (beforeNode === undefined || afterNode === undefined) {
    return true;
  }
  return isStrictRefinement(beforeNode.getType(), afterNode.getType());
}

function emitA(
  context: Pick<RuleContext, "report">,
  file: string,
  node: Node,
  subject: string,
  reported: Set<string>,
) {
  const sourceFile = node.getSourceFile();
  const range = {
    start: sourceFile.getLineAndColumnAtPos(node.getStart()),
    end: sourceFile.getLineAndColumnAtPos(node.getEnd()),
  };
  const key = `${file}:${range.start.line}:${range.start.column}`;
  if (reported.has(key)) {
    return;
  }
  reported.add(key);
  context.report({
    severity: "error",
    file,
    range,
    message: `Check on "${subject}" does not narrow its type.`,
    suggestion: SUGGESTION,
  });
}
