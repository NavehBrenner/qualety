import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import { check } from "../../qualety/src/engine.ts";
import { NO_SUGGESTION } from "../../qualety/src/index.ts";
import { dataloaderWorkerSeeding } from "./dataloader-worker-seeding.ts";
import plugin from "./index.ts";

const here = fileURLToPath(new URL(".", import.meta.url));
const fixtures = join(here, "../fixtures");
const RULE = "ml/dataloader-worker-seeding";

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

test("plugin exports dataloader-worker-seeding and recommended includes it", () => {
  expect(dataloaderWorkerSeeding).toBeDefined();
  expect(plugin.rules?.["dataloader-worker-seeding"]).toBeDefined();
  expect(plugin.configs?.recommended?.rules?.[RULE]).toBe("error");
});

test("DataLoader num_workers>0 without worker seeding exits 1", async () => {
  const result = await runFixture("worker-bad");
  expect(result.err).toBe("");
  expect(result.code).toBe(1);
  expect(result.out).toMatch(/ml\/dataloader-worker-seeding/);
  expect(result.out).toMatch(/worker_init_fn/);
  expect(result.out).toMatch(/generator/);
  expect(result.out).not.toMatch(/in this file/);
  expect(result.out).not.toMatch(NO_SUGGESTION);
});

test("generator, worker_init_fn, or num_workers=0 exits 0", async () => {
  const result = await runFixture("worker-ok");
  expect(result.err).toBe("");
  expect(result.code).toBe(0);
});
