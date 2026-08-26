export function processAlpha(record: { id: string }): string {
  const stamp = "alpha";
  function sharedInner(value: string): string {
    const trimmed = value.trim();
    const upper = trimmed.toUpperCase();
    const compact = upper.replaceAll("-", "");
    const prefixed = `ID:${compact}`;
    const stable = prefixed.padStart(20, "0");
    const tagged = `${stable}:${compact.length}`;
    const hashed = tagged.slice(0, 12);
    const scored = hashed.length + compact.length;
    const labeled = `${hashed}:${scored}`;
    const clamped = labeled.length > 4 ? labeled : "none";
    return clamped;
  }
  return stamp + sharedInner(record.id);
}

export function processBeta(record: { id: string }): number {
  const stamp = 42;
  function sharedInner(value: string): string {
    const trimmed = value.trim();
    const upper = trimmed.toUpperCase();
    const compact = upper.replaceAll("-", "");
    const prefixed = `ID:${compact}`;
    const stable = prefixed.padStart(20, "0");
    const tagged = `${stable}:${compact.length}`;
    const hashed = tagged.slice(0, 12);
    const scored = hashed.length + compact.length;
    const labeled = `${hashed}:${scored}`;
    const clamped = labeled.length > 4 ? labeled : "none";
    return clamped;
  }
  return stamp + sharedInner(record.id).length;
}
