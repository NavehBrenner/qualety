import { defineRule, type RuleContext } from "qualety";
import {
  callKeyword,
  intConstant,
  isDataLoaderCall,
  isSkippedSource,
  nodeRange,
  type PythonSource,
  pythonSources,
  walkNodes,
} from "./ast.ts";

const WORKER_HINT = "Add worker_init_fn and/or generator= seeded from the run seed.";

export const dataloaderWorkerSeeding = defineRule({
  meta: {
    requires: ["python"],
    docs: {
      description:
        "DataLoader with num_workers > 0 must set worker_init_fn or generator for worker RNG.",
    },
  },
  create(context) {
    const cwd = context.getCwd();
    for (const unit of pythonSources(context.getArtifact("python"))) {
      if (isSkippedSource(unit.file, cwd)) {
        continue;
      }
      checkUnit(unit, context);
    }
  },
});

function checkUnit(unit: PythonSource, context: Pick<RuleContext, "report">) {
  walkNodes(unit.tree, (node) => {
    if (!isDataLoaderCall(node)) {
      return;
    }
    const workers = intConstant(callKeyword(node, "num_workers"));
    if (workers === undefined || workers <= 0) {
      return;
    }
    const hasWorkerInit = callKeyword(node, "worker_init_fn") !== undefined;
    const hasGenerator = callKeyword(node, "generator") !== undefined;
    if (hasWorkerInit || hasGenerator) {
      return;
    }
    context.report({
      severity: "error",
      file: unit.file,
      range: nodeRange(node),
      message: "DataLoader(num_workers>0) is missing worker_init_fn and generator.",
      suggestion: WORKER_HINT,
    });
  });
}
