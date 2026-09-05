import { expect, test } from "vitest";
import { reportAt, walkTsArtifact, walkTsSources } from "./ts-source.ts";

test("walkTsSources, walkTsArtifact, and reportAt are referenced from a test path", () => {
  expect(walkTsSources).toEqual(expect.any(Function));
  expect(walkTsArtifact).toEqual(expect.any(Function));
  expect(reportAt).toEqual(expect.any(Function));
});
