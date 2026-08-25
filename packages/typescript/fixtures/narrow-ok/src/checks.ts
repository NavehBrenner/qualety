type Node = { kind: string };
type FunctionLike = Node & { name: string };

function isFunctionLike(n: Node): n is FunctionLike {
  return "name" in n;
}

export function pred(n: Node) {
  if (isFunctionLike(n)) {
    return n.name;
  }
  return "";
}

export function compoundPred(n: Node | undefined) {
  if (n !== undefined && isFunctionLike(n)) {
    return n.name;
  }
  return "";
}

export function typeofUnknown(x: unknown) {
  if (typeof x === "string") {
    return x;
  }
  return "";
}

export function nullish(x: string | null) {
  if (x != null) {
    return x;
  }
  return "";
}

type NonEmpty<T> = [T, ...T[]];

function isNonEmpty<T>(arr: T[]): arr is NonEmpty<T> {
  return true;
}

export function nonempty(arr: string[]) {
  if (isNonEmpty(arr)) {
    return arr[0];
  }
  return "";
}

const schema = {
  safeParse(value: unknown) {
    return { success: true as const, data: { foo: value } };
  },
};

export function parsed(raw: unknown) {
  const result = schema.safeParse(raw);
  if (!result.success) {
    return "";
  }
  return result.data.foo;
}

export function disc(v: { t: "a"; n: number } | { t: "b"; s: string }) {
  if (v.t === "a") {
    return v.n;
  }
  return 0;
}
