import { defineRule, type RuleContext } from "qualety";
import { SourceFile } from "ts-morph";
import {
  type ConstantHit,
  conditionNodes,
  diagnoseConstant,
  type FunctionLike,
  isFunctionLike,
  mixedCallerHits,
  secondParseNodes,
} from "./narrowing.ts";
import { rangeOf } from "./parse-flow.ts";

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
  create(context) {
    const sources = context.getArtifact("typescript").sources;
    for (const [abs, unit] of sources) {
      if (!(unit instanceof SourceFile)) {
        continue;
      }
      const reported = new Set<string>();
      unit.forEachDescendant((node) => {
        if (isFunctionLike(node)) {
          scanFunction(node, abs, unit, context, reported);
        }
      });
    }
  },
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
  const range = rangeOf(hit.reportAt);
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
