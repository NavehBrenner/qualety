import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import { check } from "../../qualety/src/engine.ts";
import { NO_SUGGESTION } from "../../qualety/src/index.ts";
import plugin from "./index.ts";
import { packPaddedSequenceBeforeRnn } from "./pack-padded-sequence-before-rnn.ts";

const here = fileURLToPath(new URL(".", import.meta.url));
const fixtures = join(here, "../fixtures");
const RULE = "ml/pack-padded-sequence-before-rnn";

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

test("plugin exports pack-padded-sequence-before-rnn and recommended includes it", () => {
  expect(packPaddedSequenceBeforeRnn).toBeDefined();
  expect(plugin.rules?.["pack-padded-sequence-before-rnn"]).toBeDefined();
  expect(plugin.configs?.recommended?.rules?.[RULE]).toBe("error");
});

test("h_n consumed without pack exits 1", async () => {
  const result = await runFixture("pack-padded-bad");
  expect(result.err).toBe("");
  expect(result.code).toBe(1);
  expect(result.out).toMatch(/ml\/pack-padded-sequence-before-rnn/);
  expect(result.out).toMatch(/h_n/);
  expect(result.out).not.toMatch(/in this file/);
  expect(result.out).not.toMatch(NO_SUGGESTION);
});

test("pack before RNN or output-only exits 0", async () => {
  const result = await runFixture("pack-padded-ok");
  expect(result.err).toBe("");
  expect(result.code).toBe(0);
});
