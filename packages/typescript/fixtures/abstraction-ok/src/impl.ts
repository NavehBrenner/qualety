function twice(n: number): number {
  return n + 1;
}

export const first = twice(1);
export const second = twice(2);

function unused(n: number): number {
  return n + 1;
}

void unused;

function nested(n: number): number {
  if (n > 0) {
    if (n > 1) {
      return n;
    }
  }
  return 0;
}

export const afterNested = nested(3);

type Branded = string & { readonly __brand: unique symbol };

export function take(value: Branded): Branded {
  return value;
}
