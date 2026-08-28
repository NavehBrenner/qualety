import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import { check } from "../../qualety/src/engine.ts";
import { NO_SUGGESTION } from "../../qualety/src/index.ts";
import {
  bindFileScan,
  collectHttpClientBindings,
  collectQueryHookBindings,
  collectReactEffectBindings,
  enclosingFunction,
  fileDeclaresLocalFetch,
  forbiddenHttpApi,
  inlineCallback,
  isEffectCall,
  isFunctionLike,
  isIifeCallee,
  queryHookName,
} from "./ast.ts";
import plugin, { plugin as namedPlugin } from "./index.ts";
import { noFetchInUseEffect } from "./no-fetch-in-useeffect.ts";
import { queryErrorHandled } from "./query-error-handled.ts";

const silent = () => {};
const here = fileURLToPath(new URL(".", import.meta.url));
const fixtures = join(here, "../fixtures");
const reactDist = join(here, "../dist/index.js");
const tsDist = join(here, "../../typescript/dist/index.js");

async function runFixture(name: string) {
  const lines: string[] = [];
  const errors: string[] = [];
  const code = await check(
    join(fixtures, name),
    (m) => lines.push(String(m)),
    (m) => errors.push(String(m)),
    {
      plugins: [],
      excludePlugins: [],
      rules: [
        "ts/public-exports-tested",
        "react/no-fetch-in-useeffect",
        "react/query-error-handled",
      ],
      diff: "off",
    },
  );
  return { code, out: lines.join("\n"), err: errors.join("\n") };
}

async function writeTree(files: Record<string, string>): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "ci-react-"));
  for (const [rel, body] of Object.entries(files)) {
    const path = join(dir, rel);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, body);
  }
  return dir;
}

test("plugin exports name, rules, and recommended", () => {
  expect(namedPlugin).toBe(plugin);
  expect(plugin.name).toBe("react");
  expect(noFetchInUseEffect).toBeDefined();
  expect(queryErrorHandled).toBeDefined();
  expect(plugin.rules?.["no-fetch-in-useeffect"]).toBeDefined();
  expect(plugin.rules?.["query-error-handled"]).toBeDefined();
  expect(plugin.configs?.recommended?.rules?.["react/no-fetch-in-useeffect"]).toBe("error");
  expect(plugin.configs?.recommended?.rules?.["react/query-error-handled"]).toBe("error");
  expect(bindFileScan).toEqual(expect.any(Function));
  expect(collectHttpClientBindings).toEqual(expect.any(Function));
  expect(collectQueryHookBindings).toEqual(expect.any(Function));
  expect(collectReactEffectBindings).toEqual(expect.any(Function));
  expect(enclosingFunction).toEqual(expect.any(Function));
  expect(fileDeclaresLocalFetch).toEqual(expect.any(Function));
  expect(forbiddenHttpApi).toEqual(expect.any(Function));
  expect(inlineCallback).toEqual(expect.any(Function));
  expect(isEffectCall).toEqual(expect.any(Function));
  expect(isFunctionLike).toEqual(expect.any(Function));
  expect(isIifeCallee).toEqual(expect.any(Function));
  expect(queryHookName).toEqual(expect.any(Function));
});

test("multi-plugin run attributes ts/ and react/ violations with suggestions", async () => {
  const result = await runFixture("multi-plugin");
  expect(result.err).toBe("");
  expect(result.code).toBe(1);
  expect(result.out).toMatch(
    /src\/widget\.ts:\d+:\d+\s+error\s+react\/no-fetch-in-useeffect\s+Do not call fetch inside useEffect or useLayoutEffect/,
  );
  expect(result.out).toMatch(/suggestion: Load this data with TanStack Query/);
  expect(result.out).toMatch(
    /src\/widget\.ts:\d+:\d+\s+error\s+react\/query-error-handled\s+useQuery error is unhandled/,
  );
  expect(result.out).toMatch(/suggestion: Branch on isError/);
  expect(result.out).toMatch(
    /src\/widget\.ts:\d+:\d+\s+error\s+ts\/public-exports-tested\s+Public export "Widget"/,
  );
  expect(result.out).not.toMatch(NO_SUGGESTION);
});

test("unknown rule id with react plugin loaded exits 2 naming the id", async () => {
  const dir = await writeTree({
    "qualety.config.json": JSON.stringify({
      plugins: [reactDist],
      rules: { "react/no-such-rule": "error" },
      biome: false,
    }),
    "src/a.ts": "export const a = 1;\n",
  });
  const errors: string[] = [];
  expect(await check(dir, silent, (m) => errors.push(String(m)))).toBe(2);
  expect(errors.join("\n")).toMatch(/Unknown rule id: react\/no-such-rule/);
});

test("loading both plugins applies recommended without listing rules", async () => {
  const dir = await writeTree({
    "qualety.config.json": JSON.stringify({
      plugins: [tsDist, reactDist],
      biome: false,
    }),
    "src/a.ts": "export const a = 1;\n",
  });
  const lines: string[] = [];
  expect(await check(dir, (m) => lines.push(String(m)), silent)).toBe(1);
  expect(lines.join("\n")).toMatch(/ts\/public-exports-tested/);
});
