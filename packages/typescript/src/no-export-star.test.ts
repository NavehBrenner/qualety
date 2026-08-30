import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import { check } from "../../qualety/src/engine.ts";
import { NO_SUGGESTION } from "../../qualety/src/index.ts";
import plugin from "./index.ts";
import { noExportStar } from "./no-export-star.ts";

const here = fileURLToPath(new URL(".", import.meta.url));
const fixtures = join(here, "../fixtures");

async function runFixture(name: string) {
  const lines: string[] = [];
  const errors: string[] = [];
  const code = await check(
    join(fixtures, name),
    (m) => lines.push(String(m)),
    (m) => errors.push(String(m)),
    { plugins: [], excludePlugins: [], rules: ["ts/no-export-star"], diff: "off" },
  );
  return { code, out: lines.join("\n"), err: errors.join("\n") };
}

test("plugin exports no-export-star and recommended includes it", () => {
  expect(noExportStar).toBeDefined();
  expect(plugin.rules?.["no-export-star"]).toBeDefined();
  expect(plugin.configs?.recommended?.rules?.["ts/no-export-star"]).toBe("error");
});

test("export * and export * as ns exit 1", async () => {
  const result = await runFixture("star-bad");
  expect(result.err).toBe("");
  expect(result.code).toBe(1);
  expect(result.out).toMatch(/ts\/no-export-star/);
  expect(result.out).toMatch(/Star export hides the public surface/);
  expect(result.out).toMatch(/explicit named re-exports/);
  expect(result.out).not.toMatch(NO_SUGGESTION);
});

test("named re-export and test-path skip exit 0", async () => {
  const result = await runFixture("star-ok");
  expect(result.err).toBe("");
  expect(result.code).toBe(0);
});
