type Node = { kind: string };
type FunctionLike = Node & { name: string };

function isFunctionLike(n: Node): n is FunctionLike {
  return "name" in n;
}

export function needed(n: Node) {
  if (isFunctionLike(n)) {
    return n.name;
  }
  return "";
}

function inner(x: Node) {
  if (isFunctionLike(x)) {
    return x.name;
  }
  return "";
}

export function mixedA(n: Node) {
  if (isFunctionLike(n)) {
    const label = n.name;
    return inner(n) + label;
  }
  return "";
}

export function mixedB(n: Node) {
  return inner(n);
}

const schema = {
  parse(value: unknown) {
    return { foo: value };
  },
};

export function firstParse(raw: unknown) {
  const parsed = schema.parse(raw);
  return parsed.foo;
}
