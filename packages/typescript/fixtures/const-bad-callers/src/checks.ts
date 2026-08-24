type Node = { kind: string };
type FunctionLike = Node & { name: string };

function isFunctionLike(n: Node): n is FunctionLike {
  return "name" in n;
}

function inner(x: Node) {
  if (isFunctionLike(x)) {
    return x.name;
  }
  return "";
}

export function outer(n: Node) {
  if (isFunctionLike(n)) {
    return inner(n);
  }
  return "";
}
