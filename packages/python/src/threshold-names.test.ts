import { expect, test } from "vitest";
import {
  collectNameCards,
  displayRel,
  jaccard,
  lexiconHit,
  NAME_COSINE,
  NAME_SUFFIXES,
  nameIsGated,
  namePatternHit,
  normalizeName,
  TOKEN_JACCARD,
  tokenSet,
} from "./threshold-names.ts";

test("normalize strips prefixes and longest suffixes first", () => {
  expect(normalizeName("DEFAULT_FORCE_CAP")).toBe("FORCE_CAP");
  expect(normalizeName("FORCE_CAP_N")).toBe("FORCE_CAP");
  expect(normalizeName("MAX_STEPS")).toBe("MAX");
  expect(NAME_SUFFIXES[0]).toBe("_SECONDS");
  expect(normalizeName("WAIT_SECONDS")).toBe("WAIT");
  expect(normalizeName("WAIT_S")).toBe("WAIT");
});

test("FORCE_CAP_N and DEFAULT_FORCE_CAP match", () => {
  expect(normalizeName("FORCE_CAP_N")).toBe(normalizeName("DEFAULT_FORCE_CAP"));
  expect(lexiconHit("FORCE_CAP_N")).toBe(true);
  expect(lexiconHit("DEFAULT_FORCE_CAP")).toBe(true);
  expect(nameIsGated("FORCE_CAP_N", [])).toBe(true);
});

test("MAX_RETRIES vs MAX_WORKERS is below Jaccard and ungated", () => {
  expect(jaccard(tokenSet("MAX_RETRIES"), tokenSet("MAX_WORKERS"))).toBeCloseTo(1 / 3);
  expect(jaccard(tokenSet("MAX_RETRIES"), tokenSet("MAX_WORKERS")) < TOKEN_JACCARD).toBe(true);
  expect(lexiconHit("MAX_RETRIES")).toBe(false);
  expect(lexiconHit("MAX_WORKERS")).toBe(false);
  expect(nameIsGated("MAX_RETRIES", [])).toBe(false);
});

test("force is token-only, not a raw substring", () => {
  expect(lexiconHit("FORCE_CAP")).toBe(true);
  expect(lexiconHit("enforcement")).toBe(false);
});

test("glob patterns match the raw identifier", () => {
  expect(namePatternHit("FORCE_CAP_N", ["FORCE_CAP*"])).toBe(true);
  expect(namePatternHit("STEP_BUDGET", ["*_BUDGET"])).toBe(true);
  expect(namePatternHit("MAX_RETRIES", ["FORCE_CAP*"])).toBe(false);
  expect(namePatternHit("FORCE_CAP", [])).toBe(false);
});

test("embed text splits snake and camel", () => {
  expect(NAME_COSINE).toBe(0.92);
  expect(displayRel("/repo", "/repo/src/a.py")).toBe("src/a.py");
  expect(collectNameCards).toBeTypeOf("function");
});
