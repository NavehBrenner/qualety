import { intConstant, nodeRange, walkNodes } from "@qualety/python/walk";
import { defineRule } from "qualety";
import { callKeyword, forEachMlSource, isDataLoaderCall } from "./ast.ts";

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
    for (const python of [context.getArtifact("python")]) {
      forEachMlSource(python.sources, context.getCwd(), { trainingOnly: false }, (unit) => {
        walkNodes(unit.tree, (node) => {
          if (!isDataLoaderCall(node)) {
            return;
          }
          const workers = intConstant(callKeyword(node, "num_workers"));
          if (workers === undefined || workers <= 0) {
            return;
          }
          if (
            callKeyword(node, "worker_init_fn") !== undefined ||
            callKeyword(node, "generator") !== undefined
          ) {
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
      });
    }
  },
});
