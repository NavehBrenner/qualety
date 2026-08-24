export function loadConfig(raw: unknown) {
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw new Error("bad");
  }
  return parsed.data.foo;
}

const schema = {
  safeParse(value: unknown) {
    return { success: true as const, data: { foo: value } };
  },
};
