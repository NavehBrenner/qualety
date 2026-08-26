function twice(n: number): number {
  return n + 1;
}

export const first = twice(1);
export const second = twice(2);

function nested(n: number): number {
  if (n > 0) {
    if (n > 1) {
      return n;
    }
  }
  return 0;
}

export const afterNested = nested(3);

export type Branded = string & { readonly __brand: unique symbol };
