import { defineRule, type RuleContext } from "qualety";
import { type Node, SourceFile } from "ts-morph";
import {
  aliasesOf,
  firstArgIdentifier,
  isFunctionLike,
  isHandGuardCall,
  isSchemaParseCall,
  isTypeofObjectGuard,
  rangeOf,
} from "./parse-flow.ts";

const SECOND_PARSE =
  "Reuse the first schema.parse/safeParse result (.data) instead of parsing the same value again.";
const HAND_GUARD =
  "Use the parsed .data (or parse return) instead of isRecord/typeof guards on the original value.";

export const noDoubleValidation = defineRule({
  meta: {
    requires: ["typescript"],
    docs: {
      description:
        "Do not re-parse or hand-guard the same value after a successful schema parse in that flow.",
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
      scanFunction(node, file, context);
    }
  });
}

function scanFunction(fn: Node, file: string, context: Pick<RuleContext, "report">) {
  if (!isFunctionLike(fn)) {
    return;
  }
  const parseCalls: { name: string; start: number; node: Node }[] = [];
  fn.forEachDescendant((node) => {
    if (!isSchemaParseCall(node)) {
      return;
    }
    const name = firstArgIdentifier(node);
    if (name !== undefined) {
      parseCalls.push({ name, start: node.getStart(), node });
    }
  });
  const seen = new Map<string, number>();
  for (const call of parseCalls) {
    const first = seen.get(call.name);
    if (first === undefined) {
      seen.set(call.name, call.start);
      continue;
    }
    context.report({
      severity: "error",
      file,
      range: rangeOf(call.node),
      message: `Value "${call.name}" is parsed more than once in this function.`,
      suggestion: SECOND_PARSE,
    });
  }
  for (const [name, start] of seen) {
    const names = aliasesOf(fn, name);
    fn.forEachDescendant((node) => {
      if (node.getStart() <= start) {
        return;
      }
      if (isHandGuardCall(node, names) || isTypeofObjectGuard(node, names)) {
        context.report({
          severity: "error",
          file,
          range: rangeOf(node),
          message: `Value "${name}" is re-checked with a hand type-guard after schema.parse/safeParse.`,
          suggestion: HAND_GUARD,
        });
      }
    });
  }
}
