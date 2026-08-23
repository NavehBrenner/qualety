export function fromJson(text: string) {
  return schema.safeParse(JSON.parse(text));
}

const schema = {
  safeParse(value: unknown) {
    return value;
  },
};
