import { defineRule } from "./define-rule.ts";
import type { ParsedProject, Rule } from "./index.ts";

defineRule({
  meta: { requires: ["typescript"], docs: { description: "typed" } },
  create: (context) => {
    const project: ParsedProject = context.getArtifact("typescript");
    void project;
    // @ts-expect-error workspace-docs is not in requires
    context.getArtifact("workspace-docs");
  },
});

defineRule({
  meta: {
    requires: ["typescript", "workspace-docs"],
    docs: { description: "both" },
  },
  create: (context) => {
    context.getArtifact("typescript");
    context.getArtifact("workspace-docs");
  },
});

defineRule({
  meta: { docs: { description: "omitted" } },
  create: (context) => {
    // @ts-expect-error omitted requires ⇒ no getArtifact
    context.getArtifact("typescript");
  },
});

const assignable: Rule = defineRule({
  meta: { requires: ["typescript"], docs: { description: "assignable" } },
  create: () => {},
});
void assignable;
