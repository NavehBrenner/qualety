import { defineRule, type RuleContext } from "qualety";
import { Node, type ObjectLiteralExpression, SourceFile } from "ts-morph";
import { entryValue, objectInit, pluginLiterals, resolveBinding } from "./ast.ts";

const SUGGESTION = "Wrap this rule with defineRule and list artifact ids in meta.requires.";

export const preferDefineRule = defineRule({
  meta: {
    requires: ["typescript"],
    docs: {
      description: "Prefer defineRule over a bare Rule object on a plugin rules map.",
    },
  },
  create: (context) => {
    const sources = context.getArtifact("typescript").sources;
    for (const [abs, unit] of sources) {
      if (unit instanceof SourceFile && !abs.endsWith(".d.ts")) {
        scanFile(unit, abs, sources, context);
      }
    }
  },
});

function scanFile(
  sourceFile: SourceFile,
  file: string,
  sources: ReadonlyMap<string, unknown>,
  context: Pick<RuleContext, "report">,
) {
  for (const plugin of pluginLiterals(sourceFile)) {
    const rules = objectInit(plugin, "rules");
    if (!Node.isObjectLiteralExpression(rules)) {
      continue;
    }
    for (const prop of rules.getProperties()) {
      checkEntry(prop, sourceFile, file, sources, context);
    }
  }
}

function checkEntry(
  prop: Node,
  sourceFile: SourceFile,
  file: string,
  sources: ReadonlyMap<string, unknown>,
  context: Pick<RuleContext, "report">,
) {
  const value = entryValue(prop);
  if (value === undefined || isDefineRuleCall(value)) {
    return;
  }
  if (Node.isIdentifier(value)) {
    const bound = resolveBinding(value.getText(), sourceFile, sources);
    if (bound === undefined || isDefineRuleCall(bound) || !isBareRule(bound)) {
      return;
    }
    reportBare(context, file, value);
    return;
  }
  if (isBareRule(value)) {
    reportBare(context, file, value);
  }
}

function isDefineRuleCall(node: Node): boolean {
  if (!Node.isCallExpression(node)) {
    return false;
  }
  const expr = node.getExpression();
  return Node.isIdentifier(expr) && expr.getText() === "defineRule";
}

function isBareRule(node: Node): node is ObjectLiteralExpression {
  if (!Node.isObjectLiteralExpression(node)) {
    return false;
  }
  return node.getProperty("meta") !== undefined && node.getProperty("create") !== undefined;
}

function reportBare(context: Pick<RuleContext, "report">, file: string, node: Node) {
  context.report({
    severity: "error",
    file,
    range: {
      start: node.getSourceFile().getLineAndColumnAtPos(node.getStart()),
      end: node.getSourceFile().getLineAndColumnAtPos(node.getEnd()),
    },
    message: "Prefer defineRule over a bare Rule object on a plugin rules map.",
    suggestion: SUGGESTION,
  });
}
