export function accept(raw: unknown) {
  const parsed = schema.parse(raw);
  return parsed.foo;
}

const schema = {
  parse(value: unknown) {
    return { foo: value };
  },
};
