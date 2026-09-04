import { expect, test } from "vitest";
import {
  bodyWrites,
  collectGateSites,
  collectPayload,
  hasCodeVersion,
  parseWriterName,
  reachableNames,
  requiredMetadataNames,
  resolveWriter,
} from "./provenance.ts";

test("ml provenance helpers", () => {
  expect(parseWriterName).toBeTypeOf("function");
  expect(collectGateSites).toBeTypeOf("function");
  expect(resolveWriter).toBeTypeOf("function");
  expect(bodyWrites).toBeTypeOf("function");
  expect(collectPayload).toBeTypeOf("function");
  expect(hasCodeVersion).toBeTypeOf("function");
  expect(requiredMetadataNames).toBeTypeOf("function");
  expect(reachableNames).toBeTypeOf("function");
});
