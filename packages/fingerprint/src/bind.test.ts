import { expect, test } from "vitest";
import {
  bindHashFunctions,
  boundPayloadRule,
  missingConfigFields,
  parseExcludeFields,
  parseHashFunctions,
  reportUnbound,
} from "./bind.ts";

test("fingerprint bind helpers", () => {
  expect(parseHashFunctions).toBeTypeOf("function");
  expect(parseExcludeFields).toBeTypeOf("function");
  expect(reportUnbound).toBeTypeOf("function");
  expect(bindHashFunctions).toBeTypeOf("function");
  expect(missingConfigFields).toBeTypeOf("function");
  expect(boundPayloadRule).toBeTypeOf("function");
});
