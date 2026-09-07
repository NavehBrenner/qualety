import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import { check } from "../../qualety/src/engine.ts";
import { NO_SUGGESTION } from "../../qualety/src/index.ts";
import plugin from "./index.ts";
import { versionedHashPayload } from "./versioned-hash-payload.ts";

const here = fileURLToPath(new URL(".", import.meta.url));
const fixtures = join(here, "../fixtures");
const RULE = "fingerprint/versioned-hash-payload";

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

test("plugin exports versioned-hash-payload and recommended includes it", () => {
  expect(versionedHashPayload).toBeDefined();
  expect(plugin.rules?.["versioned-hash-payload"]).toBeDefined();
  expect(plugin.configs?.recommended?.rules?.[RULE]).toBe("error");
});

test("bound hash without a version contribution fails closed", async () => {
  const result = await runFixture("versioned-bad");
  expect(result.err).toBe("");
  expect(result.code).toBe(1);
  expect(result.out).toMatch(/fingerprint\/versioned-hash-payload/);
  expect(result.out).toMatch(/version contribution/);
  expect(result.out).toMatch(/schema_version/);
  expect(result.out).not.toMatch(/in this file/);
  expect(result.out).not.toMatch(NO_SUGGESTION);
});

test("SCHEMA_VERSION folded into dumps/update exits 0", async () => {
  const result = await runFixture("versioned-ok");
  expect(result.err).toBe("");
  expect(result.code).toBe(0);
});

test("enabled empty hashFunctions is a setup warning", async () => {
  const result = await runFixture("versioned-unbound");
  expect(result.err).toBe("");
  expect(result.code).toBe(1);
  expect(result.out).toMatch(/fingerprint\/versioned-hash-payload/);
  expect(result.out).toMatch(/hashFunctions is empty/);
  expect(result.out).toMatch(/Name at least one fully-qualified callable/);
  expect(result.out).not.toMatch(/does not fold a version/);
  expect(result.out).not.toMatch(NO_SUGGESTION);
});
