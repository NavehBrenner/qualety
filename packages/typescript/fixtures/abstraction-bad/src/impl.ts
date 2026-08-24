export function wrap(n: number): number {
  return add(n);
}

function add(n: number): number {
  return n + 1;
}

export const afterWrap = wrap(1);

function useFoo(n: number): number {
  return n;
}

export const afterHook = useFoo(2);

type Id = string;

export function label(id: Id): string {
  return id;
}

function smallFlat(n: number): number {
  const next = n + 1;
  return next;
}

export const afterSmall = smallFlat(3);
