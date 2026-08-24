function isFoo(_x: string): boolean {
  return true;
}

export function bare(x: string) {
  if (isFoo(x)) {
    return x;
  }
  return "";
}

export function nonempty(arr: string[]) {
  if (arr.length > 0) {
    return arr[0];
  }
  return "";
}

export function nullish(x: string | undefined) {
  if (x !== null) {
    return x;
  }
  return "";
}

const schema = {
  safeParse(value: unknown) {
    return { success: true as const, data: { foo: value } };
  },
};

export function rawUse(x: { foo: string }) {
  schema.safeParse(x);
  return x.foo;
}

function isBar(_x: string): boolean {
  return true;
}

export function aliased(x: string) {
  const ok = isBar(x);
  if (ok) {
    return x;
  }
  return "";
}
