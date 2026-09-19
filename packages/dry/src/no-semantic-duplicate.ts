import { clusterByPredicate, cosineSimilarity, defineRule, type Violation } from "qualety";
import type { CodeEmbeddingsIndex, EmbeddedChunk } from "./code-embeddings.ts";

export const COSINE_THRESHOLD = 0.9;

export const noSemanticDuplicate = defineRule({
  meta: {
    requires: ["code-embeddings", "typescript", "python"],
    docs: {
      description:
        "No semantic near-duplicate functions, methods, or classes in included non-test TypeScript and Python sources.",
    },
    schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        threshold: { type: "number", exclusiveMinimum: 0, maximum: 1 },
      },
    },
  },
  create(context) {
    const options = context.options;
    const threshold =
      typeof options === "object" &&
      options !== null &&
      "threshold" in options &&
      typeof options.threshold === "number"
        ? options.threshold
        : COSINE_THRESHOLD;
    for (const item of reportsFromEmbeddings(context.getArtifact("code-embeddings"), threshold)) {
      if (item.message.length > 0) {
        context.report(item);
      }
    }
  },
});

export function reportsFromEmbeddings(
  index: CodeEmbeddingsIndex,
  threshold = COSINE_THRESHOLD,
): Omit<Violation, "ruleId">[] {
  const clusters = clusterChunks(index.chunks, threshold);
  const reports: Omit<Violation, "ruleId">[] = [];
  for (const cluster of clusters) {
    const report = reportFromCluster(cluster);
    if (report !== undefined) {
      reports.push(report);
    }
  }
  return reports;
}

function clusterChunks(chunks: readonly EmbeddedChunk[], threshold: number): EmbeddedChunk[][] {
  const clusters = clusterByPredicate(
    chunks,
    (left, right) => cosineSimilarity(left.vector, right.vector) >= threshold,
  );
  for (const group of clusters) {
    group.sort(
      (left, right) => left.path.localeCompare(right.path) || left.name.localeCompare(right.name),
    );
  }
  clusters.sort((left, right) => {
    const a = left[0];
    const b = right[0];
    if (a === undefined || b === undefined) {
      return 0;
    }
    return a.path.localeCompare(b.path) || a.name.localeCompare(b.name);
  });
  return clusters;
}

function reportFromCluster(cluster: EmbeddedChunk[]): Omit<Violation, "ruleId"> | undefined {
  const primary = cluster[0];
  const siblings = cluster.slice(1);
  if (primary === undefined || siblings.length === 0) {
    return undefined;
  }
  const siblingList = siblings
    .map((chunk) => `"${chunk.name}" at ${chunk.path}:${chunk.range.start.line}`)
    .join(", ");
  const first = siblings[0];
  if (first === undefined) {
    return undefined;
  }
  return {
    severity: "error",
    file: primary.path,
    range: primary.range,
    message: `"${primary.name}" is a semantic near-duplicate of ${siblingList}.`,
    suggestion: `Extract a shared helper, or reuse "${first.name}" at ${first.path}:${first.range.start.line}.`,
  };
}
