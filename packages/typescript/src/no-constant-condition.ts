import { defineRule, type RuleContext } from "qualety";
import type { SourceFile } from "ts-morph";
import {
  bindFunctionScan,
  type ConstantHit,
  conditionNodes,
  diagnoseConstant,
  type FunctionLike,
  mixedCallerHits,
  secondParseNodes,
} from "./narrowing.ts";

const REASON: Record<string, string> = {
  "param-type": "param type",
  "prior-guard": "prior guard",
  "call-site": "call-site narrowing",
  literal: "literal constant",
  "prior-parse": "prior parse",
};

export const noConstantCondition = defineRule({
  meta: {
    requires: ["typescript"],
    docs: {
      description:
        "Do not branch on a condition the analyzer can prove always true or always false.",
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
    const hit = diagnoseConstant(fn, cond, sourceFile);
    if (hit !== undefined) {
      emit(context, file, hit, reported);
    }
  }
  for (const node of secondParseNodes(fn)) {
    emit(
      context,
      file,
      {
        polarity: "true",
        reason: "prior-parse",
        suggestion: "Remove the second parse; reuse the first parse result (.data).",
        reportAt: node,
      },
      reported,
    );
  }
  for (const hit of mixedCallerHits(fn, sourceFile)) {
    emit(context, file, hit, reported);
  }
}

function emit(
  context: Pick<RuleContext, "report">,
  file: string,
  hit: ConstantHit,
  reported: Set<string>,
) {
  const sourceFile = hit.reportAt.getSourceFile();
  const range = {
    start: sourceFile.getLineAndColumnAtPos(hit.reportAt.getStart()),
    end: sourceFile.getLineAndColumnAtPos(hit.reportAt.getEnd()),
  };
  const key = `${file}:${range.start.line}:${range.start.column}:${range.end.line}:${range.end.column}`;
  if (reported.has(key)) {
    return;
  }
  reported.add(key);
  const reasonText = REASON[hit.reason] ?? hit.reason;
  context.report({
    severity: "error",
    file,
    range,
    message: hit.message ?? `Condition is always ${hit.polarity} here given ${reasonText}.`,
    suggestion: hit.suggestion,
  });
}
