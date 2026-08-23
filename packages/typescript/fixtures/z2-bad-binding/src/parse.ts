export function fromJson(text: string) {
  const value = JSON.parse(text);
  return value.foo;
}
