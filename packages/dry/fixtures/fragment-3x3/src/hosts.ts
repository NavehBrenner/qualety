type Trace = { traceId: string; spanId: string };

export function alpha(record: Trace): string {
  const prefix = "alpha";
  const joined = `${record.traceId}:${record.spanId}`;
  const tagged = joined.toUpperCase();
  const stable = tagged.replaceAll("-", "");
  return prefix + stable;
}

export function beta(record: Trace): string {
  const prefix = "beta";
  const joined = `${record.traceId}:${record.spanId}`;
  const tagged = joined.toUpperCase();
  const stable = tagged.replaceAll("-", "");
  return `${prefix}${stable}`;
}

export function gamma(record: Trace): string {
  const prefix = "gamma";
  const joined = `${record.traceId}:${record.spanId}`;
  const tagged = joined.toUpperCase();
  const stable = tagged.replaceAll("-", "");
  return [prefix, stable].join("");
}
