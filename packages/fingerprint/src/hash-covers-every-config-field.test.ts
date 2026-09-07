import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import { check } from "../../qualety/src/engine.ts";
import { NO_SUGGESTION } from "../../qualety/src/index.ts";
import { hashCoversEveryConfigField } from "./hash-covers-every-config-field.ts";
import plugin from "./index.ts";

const here = fileURLToPath(new URL(".", import.meta.url));
const fixtures = join(here, "../fixtures");
const RULE = "fingerprint/hash-covers-every-config-field";

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

test("plugin exports hash-covers-every-config-field and recommended includes it", () => {
  expect(hashCoversEveryConfigField).toBeDefined();
  expect(plugin.rules?.["hash-covers-every-config-field"]).toBeDefined();
  expect(plugin.configs?.recommended?.rules?.[RULE]).toBe("error");
});

test("hash omitting a config field exits 1 and lists the missing field", async () => {
  const result = await runFixture("covers-bad");
  expect(result.err).toBe("");
  expect(result.code).toBe(1);
  expect(result.out).toMatch(/fingerprint\/hash-covers-every-config-field/);
  expect(result.out).toMatch(/terminate_at/);
  expect(result.out).toMatch(/Read each missing field/);
  expect(result.out).not.toMatch(/n_episodes/);
  expect(result.out).not.toMatch(/in this file/);
  expect(result.out).not.toMatch(NO_SUGGESTION);
});

test("all fields read with named excludeFields exits 0", async () => {
  const result = await runFixture("covers-ok");
  expect(result.err).toBe("");
  expect(result.code).toBe(0);
});

test("enabled empty hashFunctions is a setup warning", async () => {
  const result = await runFixture("covers-unbound");
  expect(result.err).toBe("");
  expect(result.code).toBe(1);
  expect(result.out).toMatch(/fingerprint\/hash-covers-every-config-field/);
  expect(result.out).toMatch(/hashFunctions is empty/);
  expect(result.out).toMatch(/Name at least one fully-qualified callable/);
  expect(result.out).not.toMatch(/does not read config fields/);
  expect(result.out).not.toMatch(NO_SUGGESTION);
});

test("unresolvable hashFunctions FQ is silent", async () => {
  const result = await runFixture("covers-silence");
  expect(result.err).toBe("");
  expect(result.code).toBe(0);
});

test("annotated attrs.define config with all fields read exits 0", async () => {
  const result = await runFixture("covers-attrs-ok");
  expect(result.err).toBe("");
  expect(result.code).toBe(0);
});
