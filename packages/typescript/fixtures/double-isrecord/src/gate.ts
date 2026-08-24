export function accept(raw: unknown) {
  const parsed = schema.parse(raw);
  if (isRecord(raw)) {
    return raw.foo;
  }
  return parsed;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}

const schema = {
  parse(value: unknown) {
    return value;
  },
};
