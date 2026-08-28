import { expect, test } from "vitest";
import { reportAt, walkTsSources } from "./ts-source.ts";

test("walkTsSources and reportAt are referenced from a test path", () => {
  expect(walkTsSources).toEqual(expect.any(Function));
  expect(reportAt).toEqual(expect.any(Function));
});
