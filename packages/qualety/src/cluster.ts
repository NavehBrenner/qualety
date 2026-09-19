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

export function clusterByPredicate<T>(
  items: readonly T[],
  same: (left: T, right: T) => boolean,
): T[][] {
  const parent = items.map((_, index) => index);
  for (let i = 0; i < items.length; i += 1) {
    const left = items[i];
    if (left === undefined) {
      continue;
    }
    for (let j = i + 1; j < items.length; j += 1) {
      const right = items[j];
      if (right !== undefined && same(left, right)) {
        parent[findRoot(parent, i)] = findRoot(parent, j);
      }
    }
  }
  const buckets = new Map<number, T[]>();
  for (let i = 0; i < items.length; i += 1) {
    const item = items[i];
    if (item === undefined) {
      continue;
    }
    const root = findRoot(parent, i);
    const list = buckets.get(root) ?? [];
    if (list.length === 0) {
      buckets.set(root, list);
    }
    list.push(item);
  }
  return [...buckets.values()].filter((list) => list.length >= 2);
}

function findRoot(parent: number[], index: number): number {
  const current = parent[index] ?? index;
  if (current !== index) {
    parent[index] = findRoot(parent, current);
  }
  return parent[index] ?? index;
}
