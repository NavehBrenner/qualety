function wrap(n: number): number {
  return add(n);
}

function add(n: number): number {
  return n + 1;
}

export const value = wrap(1);
