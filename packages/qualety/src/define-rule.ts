import type { RuleContext, RuleListener, RuleMeta } from "./index.ts";

/** Identity helper. The engine validates `ruleSchema` at load; this does not parse. */
export function defineRule<const Requires extends readonly string[] = []>(rule: {
  meta: RuleMeta & { requires?: Requires };
  create(context: RuleContext<Requires>): void | RuleListener;
}): typeof rule {
  return rule;
}
