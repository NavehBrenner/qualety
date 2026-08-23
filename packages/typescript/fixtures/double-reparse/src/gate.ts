export function accept(raw: unknown) {
  schema.safeParse(raw);
  return schema.parse(raw);
}

const schema = {
  safeParse(value: unknown) {
    return { success: true, data: value };
  },
  parse(value: unknown) {
    return value;
  },
};
