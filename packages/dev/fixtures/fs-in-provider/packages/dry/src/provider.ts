import { readFileSync } from "node:fs";

export function buildIndex(context: unknown) {
  return readFileSync("x", "utf8") + String(context);
}
