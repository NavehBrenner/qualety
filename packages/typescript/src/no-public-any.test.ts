import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import { check } from "../../qualety/src/engine.ts";
import { NO_SUGGESTION } from "../../qualety/src/index.ts";
import plugin from "./index.ts";
import { noPublicAny } from "./no-public-any.ts";

const here = fileURLToPath(new URL(".", import.meta.url));
const fixtures = join(here, "../fixtures");

async function runFixture(name: string) {
  const lines: string[] = [];
  const errors: string[] = [];
  const code = await check(
    join(fixtures, name),
    (m) => lines.push(String(m)),
    (m) => errors.push(String(m)),
    { plugins: [], excludePlugins: [], rules: ["ts/no-public-any"], diff: "off" },
  );
  return { code, out: lines.join("\n"), err: errors.join("\n") };
}

test("plugin exports no-public-any and recommended includes it", () => {
  expect(noPublicAny).toBeDefined();
  expect(plugin.rules?.["no-public-any"]).toBeDefined();
  expect(plugin.configs?.recommended?.rules?.["ts/no-public-any"]).toBe("error");
});

test("exported any, any[], Function, Object, and as any exit 1", async () => {
  const result = await runFixture("public-any-bad");
  expect(result.err).toBe("");
  expect(result.code).toBe(1);
  expect(result.out).toMatch(/ts\/no-public-any/);
  expect(result.out).toMatch(/Public export "takesAny" is typed as any/);
  expect(result.out).toMatch(/Public export "takesFunction" is typed as any/);
  expect(result.out).toMatch(/Public export "boxed" is typed as any/);
  expect(result.out).toMatch(/Replace any with a real type or unknown/);
  expect(result.out).not.toMatch(NO_SUGGESTION);
});

test("unknown, object, unexported Function, re-export, and test-path skip exit 0", async () => {
  const result = await runFixture("public-any-ok");
  expect(result.err).toBe("");
  expect(result.code).toBe(0);
});
