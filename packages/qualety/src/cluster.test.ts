import { expect, test } from "vitest";
import { clusterByPredicate, cosineSimilarity } from "./cluster.ts";

test("cosineSimilarity is 1 for identical unit vectors", () => {
  const vector = new Float32Array([0, 1, 0]);
  expect(cosineSimilarity(vector, vector)).toBe(1);
});

test("cosineSimilarity is 0 for a zero vector", () => {
  expect(cosineSimilarity(new Float32Array([0, 0]), new Float32Array([1, 0]))).toBe(0);
});

test("clusterByPredicate merges a matching pair and leaves an unrelated item out", () => {
  const items = [{ id: 1 }, { id: 1 }, { id: 2 }];
  const clusters = clusterByPredicate(items, (left, right) => left.id === right.id);
  expect(clusters).toEqual([[items[0], items[1]]]);
});
