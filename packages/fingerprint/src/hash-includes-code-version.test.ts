import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import { check } from "../../qualety/src/engine.ts";
import { NO_SUGGESTION } from "../../qualety/src/index.ts";
import { hashIncludesCodeVersion } from "./hash-includes-code-version.ts";
import plugin from "./index.ts";

const here = fileURLToPath(new URL(".", import.meta.url));
const fixtures = join(here, "../fixtures");
const RULE = "fingerprint/hash-includes-code-version";

async function runFixture(name: string) {
  const lines: string[] = [];
  const errors: string[] = [];
  const code = await check(
    join(fixtures, name),
    (m) => lines.push(String(m)),
    (m) => errors.push(String(m)),
    { plugins: [], excludePlugins: [], rules: [RULE], diff: "off" },
  );
  return { code, out: lines.join("\n"), err: errors.join("\n") };
}

test("plugin exports hash-includes-code-version and recommended is off", () => {
  expect(hashIncludesCodeVersion).toBeDefined();
  expect(plugin.rules?.["hash-includes-code-version"]).toBeDefined();
  expect(plugin.configs?.recommended?.rules?.[RULE]).toBe("off");
});

test("bound hash without a code version exits 1", async () => {
  const result = await runFixture("code-version-bad");
  expect(result.err).toBe("");
  expect(result.code).toBe(1);
  expect(result.out).toMatch(/fingerprint\/hash-includes-code-version/);
  expect(result.out).toMatch(/code version/);
  expect(result.out).toMatch(/GIT_SHA/);
  expect(result.out).toMatch(/same knobs, not same data/);
  expect(result.out).not.toMatch(/in this file/);
  expect(result.out).not.toMatch(NO_SUGGESTION);
});

test("GIT_SHA folded into the hash payload exits 0", async () => {
  const result = await runFixture("code-version-ok");
  expect(result.err).toBe("");
  expect(result.code).toBe(0);
});
