export function fromJson(text: string) {
  return JSON.parse(text).foo;
}
