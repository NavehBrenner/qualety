import { expect, test } from "vitest";
import {
  bodyWrites,
  collectArtifactSaves,
  collectGateSites,
  collectPayload,
  enclosingDef,
  hasCodeVersion,
  isArtifactSave,
  parseWriterName,
  reachableNames,
  requiredMetadataNames,
  resolveWriter,
} from "./provenance.ts";

test("ml provenance helpers", () => {
  expect(parseWriterName).toBeTypeOf("function");
  expect(collectGateSites).toBeTypeOf("function");
  expect(collectArtifactSaves).toBeTypeOf("function");
  expect(isArtifactSave).toBeTypeOf("function");
  expect(enclosingDef).toBeTypeOf("function");
  expect(resolveWriter).toBeTypeOf("function");
  expect(bodyWrites).toBeTypeOf("function");
  expect(collectPayload).toBeTypeOf("function");
  expect(hasCodeVersion).toBeTypeOf("function");
  expect(requiredMetadataNames).toBeTypeOf("function");
  expect(reachableNames).toBeTypeOf("function");
});
