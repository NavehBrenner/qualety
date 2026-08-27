import { defineRule, type Violation } from "qualety";
import type { CodeEmbeddingsIndex, EmbeddedChunk } from "./code-embeddings.ts";

export const COSINE_THRESHOLD = 0.95;

export const noSemanticDuplicate = defineRule({
  meta: {
    requires: ["code-embeddings", "typescript", "python"],
    docs: {
      description:
        "No semantic near-duplicate functions, methods, or classes in included non-test TypeScript and Python sources.",
    },
  },
  create(context) {
    for (const item of reportsFromEmbeddings(context.getArtifact("code-embeddings"))) {
      if (item.message.length > 0) {
        context.report(item);
      }
    }
  },
});

export function reportsFromEmbeddings(index: CodeEmbeddingsIndex): Omit<Violation, "ruleId">[] {
  const clusters = clusterChunks(index.chunks, COSINE_THRESHOLD);
  const reports: Omit<Violation, "ruleId">[] = [];
  for (const cluster of clusters) {
    const report = reportFromCluster(cluster);
    if (report !== undefined) {
      reports.push(report);
    }
  }
  return reports;
}

export function cosineSimilarity(left: Float32Array, right: Float32Array): number {
  const length = Math.min(left.length, right.length);
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (let i = 0; i < length; i += 1) {
    const a = left[i] ?? 0;
    const b = right[i] ?? 0;
    dot += a * b;
    leftNorm += a * a;
    rightNorm += b * b;
  }
  const denom = Math.sqrt(leftNorm) * Math.sqrt(rightNorm);
  return denom === 0 ? 0 : dot / denom;
}

function clusterChunks(chunks: readonly EmbeddedChunk[], threshold: number): EmbeddedChunk[][] {
  const parent = chunks.map((_, index) => index);
  for (let i = 0; i < chunks.length; i += 1) {
    const left = chunks[i];
    if (left === undefined) {
      continue;
    }
    for (let j = i + 1; j < chunks.length; j += 1) {
      const right = chunks[j];
      if (right !== undefined && cosineSimilarity(left.vector, right.vector) >= threshold) {
        parent[findRoot(parent, i)] = findRoot(parent, j);
      }
    }
  }
  return groupsFromParent(chunks, parent);
}

function findRoot(parent: number[], index: number): number {
  const current = parent[index] ?? index;
  if (current !== index) {
    parent[index] = findRoot(parent, current);
  }
  return parent[index] ?? index;
}

function groupsFromParent(chunks: readonly EmbeddedChunk[], parent: number[]): EmbeddedChunk[][] {
  const groups = new Map<number, EmbeddedChunk[]>();
  for (let i = 0; i < chunks.length; i += 1) {
    const chunk = chunks[i];
    if (chunk === undefined) {
      continue;
    }
    const root = findRoot(parent, i);
    const group = groups.get(root) ?? [];
    if (group.length === 0) {
      groups.set(root, group);
    }
    group.push(chunk);
  }
  const clusters: EmbeddedChunk[][] = [];
  for (const group of groups.values()) {
    if (group.length >= 2) {
      group.sort(
        (left, right) => left.path.localeCompare(right.path) || left.name.localeCompare(right.name),
      );
      clusters.push(group);
    }
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
