import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import { check } from "../../qualety/src/engine.ts";
import { NO_SUGGESTION } from "../../qualety/src/index.ts";
import { noSpawnInCreate } from "./no-spawn-in-create.ts";

const here = fileURLToPath(new URL(".", import.meta.url));
const fixtures = join(here, "../fixtures");

async function runFixture(name: string) {
  const lines: string[] = [];
  const errors: string[] = [];
  const code = await check(
    join(fixtures, name),
    (m) => lines.push(String(m)),
    (m) => errors.push(String(m)),
    { plugins: [], excludePlugins: [], rules: ["plugin-kit/no-spawn-in-create"], diff: "off" },
  );
  return { code, out: lines.join("\n"), err: errors.join("\n") };
}

test("noSpawnInCreate is exported", () => {
  expect(noSpawnInCreate).toBeDefined();
});

test("spawn in create exits 1 naming spawn/exec/execFile/fork", async () => {
  const result = await runFixture("spawn-in-create");
  expect(result.err).toBe("");
  expect(result.code).toBe(1);
  expect(result.out).toMatch(/plugin-kit\/no-spawn-in-create/);
  expect(result.out).toMatch(/Do not call spawn inside a rule create function/);
  expect(result.out).toMatch(/Do not call exec inside a rule create function/);
  expect(result.out).toMatch(/Do not call execFile inside a rule create function/);
  expect(result.out).toMatch(/Do not call fork inside a rule create function/);
  expect(result.out).toMatch(/provides\.build/);
  expect(result.out).not.toMatch(NO_SUGGESTION);
});

test("spawn in a same-file helper called from create exits 1", async () => {
  const result = await runFixture("spawn-same-file-helper");
  expect(result.err).toBe("");
  expect(result.code).toBe(1);
  expect(result.out).toMatch(/plugin-kit\/no-spawn-in-create/);
  expect(result.out).toMatch(/Do not call spawn inside a rule create function/);
  expect(result.out).toMatch(/provides\.build/);
  expect(result.out).not.toMatch(NO_SUGGESTION);
});

test("spawn in provides.build exits 0", async () => {
  const result = await runFixture("spawn-in-provider");
  expect(result.err).toBe("");
  expect(result.code).toBe(0);
  expect(result.out).not.toMatch(/plugin-kit\/no-spawn-in-create/);
});
