import { expect, test } from "vitest";
import { runTimedCommand } from "./run-command.ts";

test("runTimedCommand sets error when the binary is missing", async () => {
  const result = await runTimedCommand("/no-such-qualety-bin", ["--version"], process.cwd(), 5_000);
  expect(result.error).toBeDefined();
  expect(result.timedOut).toBe(false);
  expect(result.code).toBeNull();
});
