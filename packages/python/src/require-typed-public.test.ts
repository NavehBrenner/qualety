import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import { check } from "../../qualety/src/engine.ts";
import { NO_SUGGESTION } from "../../qualety/src/index.ts";
import plugin from "./index.ts";
import { requireTypedPublic } from "./require-typed-public.ts";

const here = fileURLToPath(new URL(".", import.meta.url));
const fixtures = join(here, "../fixtures");

async function runFixture(name: string) {
  const lines: string[] = [];
  const errors: string[] = [];
  const code = await check(
    join(fixtures, name),
    (m) => lines.push(String(m)),
    (m) => errors.push(String(m)),
  );
  return { code, out: lines.join("\n"), err: errors.join("\n") };
}

test("plugin exports require-typed-public and recommended includes it", () => {
  expect(requireTypedPublic).toBeDefined();
  expect(plugin.rules?.["require-typed-public"]).toBeDefined();
  expect(plugin.configs?.recommended?.rules?.["python/require-typed-public"]).toBe("error");
});

test("untyped public def, method, and *args exit 1", async () => {
  const result = await runFixture("typed-bad");
  expect(result.err).toBe("");
  expect(result.code).toBe(1);
  expect(result.out).toMatch(/python\/require-typed-public/);
  expect(result.out).toMatch(
    /"public_fn" is public and is missing parameter or return annotations/,
  );
  expect(result.out).toMatch(/"public_args"/);
  expect(result.out).toMatch(/"run"/);
  expect(result.out).toMatch(/Add type annotations to every parameter/);
  expect(result.out).not.toMatch(/in this file/);
  expect(result.out).not.toMatch(NO_SUGGESTION);
});

test("annotated, private, nested, dunder, overload, and init-not-exported exit 0", async () => {
  const result = await runFixture("typed-ok");
  expect(result.err).toBe("");
  expect(result.code).toBe(0);
});
