import { basename } from "node:path";
import { defineRule } from "qualety";
import { reportsFromIndex } from "./no-duplicate-code.ts";

export const noDuplicatePython = defineRule({
  meta: {
    requires: ["dupehound"],
    docs: {
      description:
        "No duplicate logical functions in included non-test Python sources (whole-function only).",
    },
  },
  create(context) {
    const index = context.getArtifact("dupehound");
    const clusters = [];
    for (const cluster of index.clusters) {
      const members = cluster.members.filter((member) => {
        const relativePath = member.file.replaceAll("\\", "/");
        if (!relativePath.endsWith(".py")) {
          return false;
        }
        const base = basename(relativePath);
        const parts = relativePath.split("/");
        return !(
          base.startsWith("test_") ||
          base.endsWith("_test.py") ||
          base.endsWith(".test.py") ||
          base.endsWith(".spec.py") ||
          parts.includes("tests") ||
          parts.includes("__tests__") ||
          parts.includes("fixtures") ||
          parts.includes("__pycache__")
        );
      });
      if (members.length >= 2) {
        clusters.push({ ...cluster, members });
      }
    }
    for (const item of reportsFromIndex({ clusters })) {
      context.report(item);
    }
  },
});
