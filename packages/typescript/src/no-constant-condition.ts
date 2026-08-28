import { defineRule, type RuleContext } from "qualety";
import type { SourceFile } from "ts-morph";
import {
  bindFunctionScan,
  type ConstantHit,
  conditionNodes,
  diagnoseConstant,
  type FunctionLike,
  mixedHitsForCondition,
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
  const hits: ConstantHit[] = [];
  for (const cond of conditionNodes(fn)) {
    const hit = diagnoseConstant(fn, cond, sourceFile);
    if (hit !== undefined) {
      hits.push(hit);
    }
  }
  for (const node of secondParseNodes(fn)) {
    hits.push({
      polarity: "true",
      reason: "prior-parse",
      suggestion: "Remove the second parse; reuse the first parse result (.data).",
      reportAt: node,
    });
  }
  for (const cond of conditionNodes(fn)) {
    hits.push(...mixedHitsForCondition(fn, cond, sourceFile));
  }
  for (const hit of hits) {
    const at = hit.reportAt.getSourceFile();
    const range = {
      start: at.getLineAndColumnAtPos(hit.reportAt.getStart()),
      end: at.getLineAndColumnAtPos(hit.reportAt.getEnd()),
    };
    const key = `${file}:${range.start.line}:${range.start.column}:${range.end.line}:${range.end.column}`;
    if (reported.has(key)) {
      continue;
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
}
