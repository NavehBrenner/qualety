import { execFile } from "node:child_process";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { expect, test } from "vitest";
import { expandCompanions } from "./companion-closure.ts";
import { check } from "./engine.ts";
import { listGitSeed } from "./git-seed.ts";
import { expandTypeScriptClosure } from "./typescript-frontend.ts";

const silent = () => {};

const fixturePlugin = `let seen;
let creates = 0;
export default {
  name: "fixture",
  rules: {
    ping: {
      meta: { requires: ["typescript"], docs: { description: "always reports" } },
      create(context) {
        const parsed = context.getArtifact("typescript");
        for (const [abs, source] of parsed.sources) {
          if (source == null || typeof source.getFullText !== "function") {
            throw new Error("getArtifact(typescript) did not return parsed sources");
          }
          context.report({
            severity: "error",
            file: abs,
            range: { start: { line: 1, column: 1 }, end: { line: 1, column: 1 } },
            message: "ping",
          });
        }
      },
    },
    quiet: {
      meta: { requires: ["typescript"], docs: { description: "never reports" } },
      create() {},
    },
    first: {
      meta: { requires: ["typescript"], docs: { description: "records parsed project" } },
      create(context) {
        seen = context.getArtifact("typescript");
      },
    },
    second: {
      meta: { requires: ["typescript"], docs: { description: "checks same parsed project" } },
      create(context) {
        const parsed = context.getArtifact("typescript");
        if (parsed !== seen) {
          context.report({
            severity: "error",
            file: context.getFiles()[0],
            range: { start: { line: 1, column: 1 }, end: { line: 1, column: 1 } },
            message: "parsed more than once",
          });
        }
        if (parsed.project !== seen.project) {
          context.report({
            severity: "error",
            file: context.getFiles()[0],
            range: { start: { line: 1, column: 1 }, end: { line: 1, column: 1 } },
            message: "project not shared",
          });
        }
        if (parsed.sources !== seen.sources) {
          context.report({
            severity: "error",
            file: context.getFiles()[0],
            range: { start: { line: 1, column: 1 }, end: { line: 1, column: 1 } },
            message: "sources map not shared",
          });
        }
      },
    },
    unusedExport: {
      meta: { requires: ["typescript"], docs: { description: "export x unused across files" } },
      create(context) {
        creates += 1;
        const files = context.getFiles();
        const parsed = context.getArtifact("typescript");
        if (creates !== 1) {
          context.report({
            severity: "error",
            file: files[0],
            range: { start: { line: 1, column: 1 }, end: { line: 1, column: 1 } },
            message: \`create invoked \${creates} times\`,
          });
        }
        if (parsed.sources.size !== 2) {
          context.report({
            severity: "error",
            file: files[0],
            range: { start: { line: 1, column: 1 }, end: { line: 1, column: 1 } },
            message: \`expected 2 sources, got \${parsed.sources.size}\`,
          });
        }
        const texts = [];
        for (const [abs, source] of parsed.sources) {
          if (source == null || typeof source.getFullText !== "function") {
            throw new Error("getArtifact(typescript) did not return parsed sources");
          }
          texts.push({ filename: abs, text: source.getFullText() });
        }
        const exporter = texts.find((item) => /export const x\\b/.test(item.text));
        const importer = texts.find((item) => /import\\s+\\{\\s*x\\s*\\}/.test(item.text));
        if (exporter !== undefined && importer === undefined) {
          context.report({
            severity: "error",
            file: exporter.filename,
            range: { start: { line: 1, column: 1 }, end: { line: 1, column: 1 } },
            message: "export x is unused across files",
          });
        }
      },
    },
    workspacePing: {
      meta: { docs: { description: "always reports from workspace" } },
      create(context) {
        const files = context.getFiles();
        context.report({
          severity: "error",
          file: files[0] ?? ".",
          range: { start: { line: 1, column: 1 }, end: { line: 1, column: 1 } },
          message: "workspace ping",
        });
      },
    },
    listed: {
      meta: { docs: { description: "checks listed files" } },
      create(context) {
        if (typeof context.getCwd() !== "string" || context.getCwd().length === 0) {
          context.report({
            severity: "error",
            file: "src/hello.ts",
            range: { start: { line: 1, column: 1 }, end: { line: 1, column: 1 } },
            message: "getCwd missing",
          });
        }
        if (!context.getFiles().includes("src/hello.ts")) {
          context.report({
            severity: "error",
            file: "src/hello.ts",
            range: { start: { line: 1, column: 1 }, end: { line: 1, column: 1 } },
            message: "src/hello.ts not listed",
          });
        }
      },
    },
    hasNotes: {
      meta: { docs: { description: "notes.txt must be listed" } },
      create(context) {
        if (!context.getFiles().includes("notes.txt")) {
          context.report({
            severity: "error",
            file: "notes.txt",
            range: { start: { line: 1, column: 1 }, end: { line: 1, column: 1 } },
            message: \`notes.txt not listed: \${context.getFiles().join(",")}\`,
          });
        }
      },
    },
    tsOnly: {
      meta: { requires: ["typescript"], docs: { description: "language provider skips non-TS" } },
      create(context) {
        const parsed = context.getArtifact("typescript");
        const files = context.getFiles();
        if (!files.includes("notes.txt") || !files.includes("src/hello.ts")) {
          context.report({
            severity: "error",
            file: "src/hello.ts",
            range: { start: { line: 1, column: 1 }, end: { line: 1, column: 1 } },
            message: \`expected notes.txt and src/hello.ts in getFiles: \${files.join(",")}\`,
          });
        }
        if (parsed.sources.size !== 1) {
          context.report({
            severity: "error",
            file: "src/hello.ts",
            range: { start: { line: 1, column: 1 }, end: { line: 1, column: 1 } },
            message: \`expected 1 TS source, got \${parsed.sources.size}\`,
          });
        }
      },
    },
  },
};
`;

function pluginWith(meta: string): string {
  return `export default {
  name: "fixture",
  rules: {
    ping: {
      meta: ${meta},
      create() {},
    },
  },
};
`;
}

async function writeTree(files: Record<string, string>): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "ci-engine-"));
  for (const [rel, body] of Object.entries(files)) {
    const path = join(dir, rel);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, body);
  }
  return dir;
}

function config(rules: Record<string, string>, extra: Record<string, unknown> = {}) {
  return JSON.stringify({
    plugins: ["./plugin.mjs"],
    rules,
    ...extra,
  });
}

test("unknown rule id exits 2", async () => {
  const dir = await writeTree({
    "qualety.config.json": JSON.stringify({
      plugins: [],
      rules: { "react/data-region-exhaustive": "error" },
    }),
  });
  const errors: string[] = [];
  expect(await check(dir, silent, (m) => errors.push(String(m)))).toBe(2);
  expect(errors.join("\n")).toMatch(/Unknown rule id: react\/data-region-exhaustive/);
});

test("all rules off is an honest empty path", async () => {
  const dir = await writeTree({
    "plugin.mjs": fixturePlugin,
    "qualety.config.json": config({ "fixture/ping": "off" }),
    "src/hello.ts": "export const n = 1;\n",
  });
  const lines: string[] = [];
  expect(await check(dir, (m) => lines.push(String(m)), silent)).toBe(0);
  expect(lines.join("\n")).toMatch(/No rules configured — nothing to check/);
});

test("enabled rule collects a violation and exits 1", async () => {
  const dir = await writeTree({
    "plugin.mjs": fixturePlugin,
    "qualety.config.json": config({ "fixture/ping": "error" }),
    "src/hello.ts": "export const n = 1;\n",
  });
  const lines: string[] = [];
  expect(await check(dir, (m) => lines.push(String(m)), silent)).toBe(1);
  expect(lines.join("\n")).toMatch(/src\/hello\.ts:1:1\s+error\s+fixture\/ping\s+ping/);
  expect(lines.join("\n")).not.toMatch(/suggestion:/);
});

test("prints suggestion line only when it is not the sentinel", async () => {
  const dir = await writeTree({
    "plugin.mjs": `export default {
  name: "fixture",
  rules: {
    hint: {
      meta: { requires: ["typescript"], docs: { description: "hint" } },
      create(context) {
        context.report({
          severity: "error",
          file: context.getFiles()[0],
          range: { start: { line: 1, column: 1 }, end: { line: 1, column: 1 } },
          message: "hint",
          suggestion: "Do the thing.",
        });
      },
    },
  },
};
`,
    "qualety.config.json": config({ "fixture/hint": "error" }),
    "src/hello.ts": "export const n = 1;\n",
  });
  const lines: string[] = [];
  expect(await check(dir, (m) => lines.push(String(m)), silent)).toBe(1);
  expect(lines.join("\n")).toMatch(/suggestion: Do the thing\./);
});

test("enabled rule with no violations exits 0 without the empty-path message", async () => {
  const dir = await writeTree({
    "plugin.mjs": fixturePlugin,
    "qualety.config.json": config({ "fixture/quiet": "error" }),
    "src/hello.ts": "export const n = 1;\n",
  });
  const lines: string[] = [];
  expect(await check(dir, (m) => lines.push(String(m)), silent)).toBe(0);
  expect(lines.join("\n")).not.toMatch(/nothing to check/);
});

test("no matching files is an honest empty path", async () => {
  const dir = await writeTree({
    "plugin.mjs": fixturePlugin,
    "qualety.config.json": config({ "fixture/ping": "error" }),
  });
  const lines: string[] = [];
  expect(await check(dir, (m) => lines.push(String(m)), silent)).toBe(0);
  expect(lines.join("\n")).toMatch(/No files to check/);
});

test("TypeScript frontend parses each file once for all rules", async () => {
  const dir = await writeTree({
    "plugin.mjs": fixturePlugin,
    "qualety.config.json": config({ "fixture/first": "error", "fixture/second": "error" }),
    "src/hello.ts": "export const n = 1;\n",
  });
  const lines: string[] = [];
  expect(await check(dir, (m) => lines.push(String(m)), silent)).toBe(0);
  expect(lines.join("\n")).not.toMatch(/parsed more than once/);
  expect(lines.join("\n")).not.toMatch(/sources map not shared/);
  expect(lines.join("\n")).not.toMatch(/project not shared/);
});

test("create runs once and can report a cross-file violation", async () => {
  const dir = await writeTree({
    "plugin.mjs": fixturePlugin,
    "qualety.config.json": config({ "fixture/unusedExport": "error" }),
    "src/a.ts": "export const x = 1;\n",
    "src/b.ts": "export const y = 2;\n",
  });
  const lines: string[] = [];
  expect(await check(dir, (m) => lines.push(String(m)), silent)).toBe(1);
  const out = lines.join("\n");
  expect(out).toMatch(
    /src\/a\.ts:1:1\s+error\s+fixture\/unusedExport\s+export x is unused across files/,
  );
  expect(out).not.toMatch(/create invoked/);
  expect(out).not.toMatch(/expected 2 sources/);
});

test("getFiles lists workspace files", async () => {
  const dir = await writeTree({
    "plugin.mjs": fixturePlugin,
    "qualety.config.json": config({ "fixture/listed": "error" }),
    "src/hello.ts": "export const n = 1;\n",
  });
  const lines: string[] = [];
  expect(await check(dir, (m) => lines.push(String(m)), silent)).toBe(0);
  expect(lines.join("\n")).not.toMatch(/not listed/);
  expect(lines.join("\n")).not.toMatch(/getCwd missing/);
});

test("getFiles includes non-TS paths", async () => {
  const dir = await writeTree({
    "plugin.mjs": fixturePlugin,
    "qualety.config.json": config({ "fixture/hasNotes": "error" }, { include: ["**/*.txt"] }),
    "notes.txt": "hello\n",
  });
  const lines: string[] = [];
  expect(await check(dir, (m) => lines.push(String(m)), silent)).toBe(0);
  expect(lines.join("\n")).not.toMatch(/notes\.txt not listed/);
});

test("language provider skips non-TS paths", async () => {
  const dir = await writeTree({
    "plugin.mjs": fixturePlugin,
    "qualety.config.json": config(
      { "fixture/tsOnly": "error" },
      { include: ["**/*.ts", "**/*.txt"] },
    ),
    "src/hello.ts": "export const n = 1;\n",
    "notes.txt": "hello\n",
  });
  const lines: string[] = [];
  expect(await check(dir, (m) => lines.push(String(m)), silent)).toBe(0);
  expect(lines.join("\n")).not.toMatch(/expected notes\.txt/);
  expect(lines.join("\n")).not.toMatch(/expected 1 TS source/);
});

test("requires python with no provider exits 2", async () => {
  const dir = await writeTree({
    "plugin.mjs": pluginWith(`{ requires: ["python"], docs: { description: "needs python" } }`),
    "qualety.config.json": config({ "fixture/ping": "error" }),
    "src/hello.ts": "export const n = 1;\n",
  });
  const errors: string[] = [];
  expect(await check(dir, silent, (m) => errors.push(String(m)))).toBe(2);
  expect(errors.join("\n")).toMatch(/No provider for artifact "python"/);
  expect(errors.join("\n")).toMatch(/fixture\/ping/);
  expect(errors.join("\n")).not.toMatch(/No frontend/);
  expect(errors.join("\n")).not.toMatch(/reserved/);
});

test("invalid requires exits 2", async () => {
  const dir = await writeTree({
    "plugin.mjs": pluginWith(`{ requires: [""], docs: { description: "bad requires" } }`),
    "qualety.config.json": config({ "fixture/ping": "error" }),
    "src/hello.ts": "export const n = 1;\n",
  });
  const errors: string[] = [];
  expect(await check(dir, silent, (m) => errors.push(String(m)))).toBe(2);
  expect(errors.join("\n")).toMatch(/invalid requires/);
});

const fakeProviderPlugin = `let builds = 0;
export default {
  name: "fixture",
  provides: {
    fake: {
      async build(context) {
        builds += 1;
        return { builds, files: context.files, requiredBy: context.requiredBy };
      },
    },
  },
  rules: {
    alpha: {
      meta: { requires: ["fake"], docs: { description: "reads fake" } },
      create(context) {
        const artifact = context.getArtifact("fake");
        context.report({
          severity: "error",
          file: context.getFiles()[0],
          range: { start: { line: 1, column: 1 }, end: { line: 1, column: 1 } },
          message: \`alpha builds=\${artifact.builds} by=\${artifact.requiredBy.join(",")}\`,
          suggestion: "n/a",
        });
      },
    },
    beta: {
      meta: { requires: ["fake"], docs: { description: "reads fake too" } },
      create(context) {
        const artifact = context.getArtifact("fake");
        context.report({
          severity: "error",
          file: context.getFiles()[0],
          range: { start: { line: 1, column: 1 }, end: { line: 1, column: 1 } },
          message: \`beta builds=\${artifact.builds}\`,
          suggestion: "n/a",
        });
      },
    },
  },
};
`;

test("artifact provider builds once and exposes getArtifact", async () => {
  const dir = await writeTree({
    "plugin.mjs": fakeProviderPlugin,
    "qualety.config.json": config({
      "fixture/alpha": "error",
      "fixture/beta": "error",
    }),
    "src/hello.ts": "export const n = 1;\n",
  });
  const lines: string[] = [];
  expect(await check(dir, (m) => lines.push(String(m)), silent)).toBe(1);
  const out = lines.join("\n");
  expect(out).toMatch(/fixture\/alpha\s+alpha builds=1 by=fixture\/alpha,fixture\/beta/);
  expect(out).toMatch(/fixture\/beta\s+beta builds=1/);
});

test("missing provider exits 2 and names the rule", async () => {
  const dir = await writeTree({
    "plugin.mjs": pluginWith(`{ requires: ["ghost"], docs: { description: "needs ghost" } }`),
    "qualety.config.json": config({ "fixture/ping": "error" }),
    "src/hello.ts": "export const n = 1;\n",
  });
  const errors: string[] = [];
  expect(await check(dir, silent, (m) => errors.push(String(m)))).toBe(2);
  expect(errors.join("\n")).toMatch(/No provider for artifact "ghost"/);
  expect(errors.join("\n")).toMatch(/fixture\/ping/);
});

test("provider build throw exits 2 and names the rule", async () => {
  const dir = await writeTree({
    "plugin.mjs": `export default {
  name: "fixture",
  provides: {
    fake: {
      build() {
        throw new Error("provider exploded");
      },
    },
  },
  rules: {
    ping: {
      meta: { requires: ["fake"], docs: { description: "needs fake" } },
      create() {},
    },
  },
};
`,
    "qualety.config.json": config({ "fixture/ping": "error" }),
    "src/hello.ts": "export const n = 1;\n",
  });
  const errors: string[] = [];
  expect(await check(dir, silent, (m) => errors.push(String(m)))).toBe(2);
  expect(errors.join("\n")).toMatch(/provider exploded/);
  expect(errors.join("\n")).toMatch(/fixture\/ping/);
});

test("duplicate artifact id exits 2", async () => {
  const dir = await writeTree({
    "plugin.mjs": `export default {
  name: "fixture",
  provides: { fake: { build() { return 1; } } },
  rules: {
    ping: {
      meta: { requires: ["fake"], docs: { description: "needs fake" } },
      create() {},
    },
  },
};
`,
    "other.mjs": `export default {
  name: "other",
  provides: { fake: { build() { return 2; } } },
  rules: {},
};
`,
    "qualety.config.json": JSON.stringify({
      plugins: ["./plugin.mjs", "./other.mjs"],
      rules: { "fixture/ping": "error" },
    }),
    "src/hello.ts": "export const n = 1;\n",
  });
  const errors: string[] = [];
  expect(await check(dir, silent, (m) => errors.push(String(m)))).toBe(2);
  expect(errors.join("\n")).toMatch(/Artifact "fake" is provided by more than one owner/);
  expect(errors.join("\n")).toMatch(/fixture/);
  expect(errors.join("\n")).toMatch(/other/);
});

test("plugin provides.typescript overrides the default provider", async () => {
  const dir = await writeTree({
    "plugin.mjs": `export default {
  name: "fixture",
  provides: {
    typescript: {
      build() {
        return { project: "plugin", sources: new Map() };
      },
    },
  },
  rules: {
    ping: {
      meta: { requires: ["typescript"], docs: { description: "needs ts" } },
      create(context) {
        const parsed = context.getArtifact("typescript");
        if (parsed.project !== "plugin") {
          context.report({
            severity: "error",
            file: context.getFiles()[0],
            range: { start: { line: 1, column: 1 }, end: { line: 1, column: 1 } },
            message: "default provider was used",
          });
        }
      },
    },
  },
};
`,
    "qualety.config.json": config({ "fixture/ping": "error" }),
    "src/hello.ts": "export const n = 1;\n",
  });
  const lines: string[] = [];
  const errors: string[] = [];
  expect(
    await check(
      dir,
      (m) => lines.push(String(m)),
      (m) => errors.push(String(m)),
    ),
  ).toBe(0);
  expect(lines.join("\n")).not.toMatch(/default provider was used/);
  expect(errors.join("\n")).not.toMatch(/more than one owner/);
});

test("ruleless plugin provides an artifact another plugin requires", async () => {
  const dir = await writeTree({
    "providers.mjs": `let builds = 0;
export default {
  name: "shared",
  provides: {
    graph: {
      build() {
        builds += 1;
        return { builds };
      },
    },
  },
};
`,
    "plugin.mjs": `export default {
  name: "fixture",
  rules: {
    ping: {
      meta: { requires: ["graph"], docs: { description: "needs graph" } },
      create(context) {
        const artifact = context.getArtifact("graph");
        context.report({
          severity: "error",
          file: context.getFiles()[0],
          range: { start: { line: 1, column: 1 }, end: { line: 1, column: 1 } },
          message: \`graph builds=\${artifact.builds}\`,
          suggestion: "n/a",
        });
      },
    },
    again: {
      meta: { requires: ["graph"], docs: { description: "needs graph too" } },
      create(context) {
        const artifact = context.getArtifact("graph");
        context.report({
          severity: "error",
          file: context.getFiles()[0],
          range: { start: { line: 1, column: 1 }, end: { line: 1, column: 1 } },
          message: \`again builds=\${artifact.builds}\`,
          suggestion: "n/a",
        });
      },
    },
  },
};
`,
    "qualety.config.json": JSON.stringify({
      plugins: ["./providers.mjs", "./plugin.mjs"],
      rules: { "fixture/ping": "error", "fixture/again": "error" },
    }),
    "src/hello.ts": "export const n = 1;\n",
  });
  const lines: string[] = [];
  expect(await check(dir, (m) => lines.push(String(m)), silent)).toBe(1);
  const out = lines.join("\n");
  expect(out).toMatch(/fixture\/ping\s+graph builds=1/);
  expect(out).toMatch(/fixture\/again\s+again builds=1/);
});

test("getArtifact without require exits 2", async () => {
  const dir = await writeTree({
    "plugin.mjs": `export default {
  name: "fixture",
  provides: { fake: { build() { return { ok: true }; } } },
  rules: {
    listed: {
      meta: { docs: { description: "no require" } },
      create(context) {
        context.getArtifact("fake");
      },
    },
  },
};
`,
    "qualety.config.json": config({ "fixture/listed": "error" }),
    "src/hello.ts": "export const n = 1;\n",
  });
  const errors: string[] = [];
  expect(await check(dir, silent, (m) => errors.push(String(m)))).toBe(2);
  expect(errors.join("\n")).toMatch(/getArtifact\("fake"\) requires meta.requires/);
});

test("mixed language and plugin artifacts both report", async () => {
  const dir = await writeTree({
    "plugin.mjs": fixturePlugin,
    "qualety.config.json": config({
      "fixture/unusedExport": "error",
      "fixture/workspacePing": "error",
    }),
    "src/a.ts": "export const x = 1;\n",
    "src/b.ts": "export const y = 2;\n",
  });
  const lines: string[] = [];
  expect(await check(dir, (m) => lines.push(String(m)), silent)).toBe(1);
  const out = lines.join("\n");
  expect(out).toMatch(/fixture\/unusedExport\s+export x is unused across files/);
  expect(out).toMatch(/fixture\/workspacePing\s+workspace ping/);
  expect(out).not.toMatch(/create invoked/);
});

test("language and plugin artifacts in one run each build once", async () => {
  const dir = await writeTree({
    "plugin.mjs": `let fakeBuilds = 0;
export default {
  name: "fixture",
  provides: {
    fake: {
      build() {
        fakeBuilds += 1;
        return { fakeBuilds };
      },
    },
  },
  rules: {
    lang: {
      meta: { requires: ["typescript"], docs: { description: "reads ts" } },
      create(context) {
        const parsed = context.getArtifact("typescript");
        context.report({
          severity: "error",
          file: context.getFiles()[0],
          range: { start: { line: 1, column: 1 }, end: { line: 1, column: 1 } },
          message: \`lang sources=\${parsed.sources.size}\`,
          suggestion: "n/a",
        });
      },
    },
    plug: {
      meta: { requires: ["fake"], docs: { description: "reads fake" } },
      create(context) {
        const artifact = context.getArtifact("fake");
        context.report({
          severity: "error",
          file: context.getFiles()[0],
          range: { start: { line: 1, column: 1 }, end: { line: 1, column: 1 } },
          message: \`plug builds=\${artifact.fakeBuilds}\`,
          suggestion: "n/a",
        });
      },
    },
    both: {
      meta: { requires: ["typescript", "fake"], docs: { description: "reads both" } },
      create(context) {
        const parsed = context.getArtifact("typescript");
        const artifact = context.getArtifact("fake");
        context.report({
          severity: "error",
          file: context.getFiles()[0],
          range: { start: { line: 1, column: 1 }, end: { line: 1, column: 1 } },
          message: \`both sources=\${parsed.sources.size} builds=\${artifact.fakeBuilds}\`,
          suggestion: "n/a",
        });
      },
    },
  },
};
`,
    "qualety.config.json": config({
      "fixture/lang": "error",
      "fixture/plug": "error",
      "fixture/both": "error",
    }),
    "src/hello.ts": "export const n = 1;\n",
  });
  const lines: string[] = [];
  expect(await check(dir, (m) => lines.push(String(m)), silent)).toBe(1);
  const out = lines.join("\n");
  expect(out).toMatch(/fixture\/lang\s+lang sources=1/);
  expect(out).toMatch(/fixture\/plug\s+plug builds=1/);
  expect(out).toMatch(/fixture\/both\s+both sources=1 builds=1/);
});

test("module export without name is not a plugin", async () => {
  const dir = await writeTree({
    "plugin.mjs": `export default { rules: {} };
`,
    "qualety.config.json": config({ "fixture/ping": "error" }),
    "src/hello.ts": "export const n = 1;\n",
  });
  const errors: string[] = [];
  expect(await check(dir, silent, (m) => errors.push(String(m)))).toBe(2);
  expect(errors.join("\n")).toMatch(/does not export a Plugin/);
});

test("empty artifact id exits 2", async () => {
  const dir = await writeTree({
    "plugin.mjs": `export default {
  name: "fixture",
  provides: { "": { build() {} } },
  rules: {
    ping: {
      meta: { docs: { description: "ping" } },
      create() {},
    },
  },
};
`,
    "qualety.config.json": config({ "fixture/ping": "error" }),
    "src/hello.ts": "export const n = 1;\n",
  });
  const errors: string[] = [];
  expect(await check(dir, silent, (m) => errors.push(String(m)))).toBe(2);
  expect(errors.join("\n")).toMatch(/empty artifact id/);
});

test("provider without build exits 2", async () => {
  const dir = await writeTree({
    "plugin.mjs": `export default {
  name: "fixture",
  provides: { fake: {} },
  rules: {
    ping: {
      meta: { docs: { description: "ping" } },
      create() {},
    },
  },
};
`,
    "qualety.config.json": config({ "fixture/ping": "error" }),
    "src/hello.ts": "export const n = 1;\n",
  });
  const errors: string[] = [];
  expect(await check(dir, silent, (m) => errors.push(String(m)))).toBe(2);
  expect(errors.join("\n")).toMatch(/Plugin "fixture" is invalid \(provides\.fake/);
});

test("rule missing create exits 2", async () => {
  const dir = await writeTree({
    "plugin.mjs": `export default {
  name: "fixture",
  rules: {
    ping: {
      meta: { docs: { description: "ping" } },
    },
  },
};
`,
    "qualety.config.json": config({ "fixture/ping": "error" }),
    "src/hello.ts": "export const n = 1;\n",
  });
  const errors: string[] = [];
  expect(await check(dir, silent, (m) => errors.push(String(m)))).toBe(2);
  expect(errors.join("\n")).toMatch(/Plugin "fixture" is invalid \(rules\.ping\.create/);
});

test("rule missing docs description exits 2", async () => {
  const dir = await writeTree({
    "plugin.mjs": `export default {
  name: "fixture",
  rules: {
    ping: {
      meta: { docs: {} },
      create() {},
    },
  },
};
`,
    "qualety.config.json": config({ "fixture/ping": "error" }),
    "src/hello.ts": "export const n = 1;\n",
  });
  const errors: string[] = [];
  expect(await check(dir, silent, (m) => errors.push(String(m)))).toBe(2);
  expect(errors.join("\n")).toMatch(/Plugin "fixture" is invalid \(rules\.ping\.meta\.docs/);
});

const otherPlugin = `export default {
  name: "other",
  rules: {
    pong: {
      meta: { docs: { description: "always reports" } },
      create(context) {
        context.report({
          severity: "error",
          file: context.getFiles()[0] ?? ".",
          range: { start: { line: 1, column: 1 }, end: { line: 1, column: 1 } },
          message: "pong",
        });
      },
    },
  },
};
`;

const listPlugin = `export default {
  name: "fixture",
  rules: {
    list: {
      meta: { requires: ["typescript"], docs: { description: "lists files" } },
      create(context) {
        const parsed = context.getArtifact("typescript");
        context.report({
          severity: "error",
          file: context.getFiles()[0] ?? ".",
          range: { start: { line: 1, column: 1 }, end: { line: 1, column: 1 } },
          message: "listed:" + context.getFiles().join("|"),
          suggestion: "sources:" + String(parsed.sources.size),
        });
      },
    },
  },
};
`;

const noFilters = { plugins: [], excludePlugins: [], rules: [], diff: "off" } as const;

const execFileAsync = promisify(execFile);

async function git(cwd: string, args: string[]): Promise<void> {
  await execFileAsync("git", args, { cwd });
}

async function initGit(cwd: string): Promise<void> {
  await git(cwd, ["init", "-b", "main"]);
  await git(cwd, ["config", "user.name", "qualety-test"]);
  await git(cwd, ["config", "user.email", "qualety@test"]);
  await git(cwd, ["config", "commit.gpgsign", "false"]);
}

async function commitAll(cwd: string, message: string): Promise<void> {
  await git(cwd, ["add", "-A"]);
  await git(cwd, ["commit", "-m", message]);
}

test("unknown --plugin exits 2 with the name", async () => {
  const dir = await writeTree({
    "plugin.mjs": fixturePlugin,
    "qualety.config.json": config({ "fixture/ping": "error" }),
    "src/hello.ts": "export const n = 1;\n",
  });
  const errors: string[] = [];
  expect(
    await check(dir, silent, (m) => errors.push(String(m)), {
      ...noFilters,
      plugins: ["react"],
    }),
  ).toBe(2);
  expect(errors.join("\n")).toMatch(/Unknown plugin name: react/);
});

test("unknown --rule exits 2 with the id", async () => {
  const dir = await writeTree({
    "plugin.mjs": fixturePlugin,
    "qualety.config.json": config({ "fixture/ping": "error" }),
    "src/hello.ts": "export const n = 1;\n",
  });
  const errors: string[] = [];
  expect(
    await check(dir, silent, (m) => errors.push(String(m)), {
      ...noFilters,
      rules: ["fixture/missing"],
    }),
  ).toBe(2);
  expect(errors.join("\n")).toMatch(/Unknown rule id: fixture\/missing/);
});

test("--rule on an off id exits 2 as not enabled", async () => {
  const dir = await writeTree({
    "plugin.mjs": fixturePlugin,
    "qualety.config.json": config({ "fixture/ping": "error", "fixture/quiet": "off" }),
    "src/hello.ts": "export const n = 1;\n",
  });
  const errors: string[] = [];
  expect(
    await check(dir, silent, (m) => errors.push(String(m)), {
      ...noFilters,
      rules: ["fixture/quiet"],
    }),
  ).toBe(2);
  expect(errors.join("\n")).toMatch(/Rule "fixture\/quiet" is not enabled/);
});

test("filters that match no rules exit 0 honestly", async () => {
  const dir = await writeTree({
    "plugin.mjs": fixturePlugin,
    "qualety.config.json": config({ "fixture/ping": "error" }),
    "src/hello.ts": "export const n = 1;\n",
  });
  const lines: string[] = [];
  expect(
    await check(dir, (m) => lines.push(String(m)), silent, {
      ...noFilters,
      plugins: ["fixture"],
      excludePlugins: ["fixture"],
    }),
  ).toBe(0);
  expect(lines.join("\n")).toMatch(/No rules matched filters/);
});

test("--plugin union keeps each named plugin", async () => {
  const dir = await writeTree({
    "plugin.mjs": fixturePlugin,
    "other.mjs": otherPlugin,
    "qualety.config.json": JSON.stringify({
      plugins: ["./plugin.mjs", "./other.mjs"],
      rules: { "fixture/ping": "error", "other/pong": "error" },
    }),
    "src/hello.ts": "export const n = 1;\n",
  });
  const lines: string[] = [];
  expect(
    await check(dir, (m) => lines.push(String(m)), silent, {
      ...noFilters,
      plugins: ["fixture", "other"],
    }),
  ).toBe(1);
  expect(lines.join("\n")).toMatch(/fixture\/ping/);
  expect(lines.join("\n")).toMatch(/other\/pong/);
});

test("--exclude-plugin applies after --plugin allow", async () => {
  const dir = await writeTree({
    "plugin.mjs": fixturePlugin,
    "other.mjs": otherPlugin,
    "qualety.config.json": JSON.stringify({
      plugins: ["./plugin.mjs", "./other.mjs"],
      rules: { "fixture/ping": "error", "other/pong": "error" },
    }),
    "src/hello.ts": "export const n = 1;\n",
  });
  const lines: string[] = [];
  expect(
    await check(dir, (m) => lines.push(String(m)), silent, {
      ...noFilters,
      plugins: ["fixture", "other"],
      excludePlugins: ["other"],
    }),
  ).toBe(1);
  expect(lines.join("\n")).toMatch(/fixture\/ping/);
  expect(lines.join("\n")).not.toMatch(/other\/pong/);
});

test("--plugin and --rule intersect", async () => {
  const dir = await writeTree({
    "plugin.mjs": fixturePlugin,
    "other.mjs": otherPlugin,
    "qualety.config.json": JSON.stringify({
      plugins: ["./plugin.mjs", "./other.mjs"],
      rules: { "fixture/ping": "error", "other/pong": "error" },
    }),
    "src/hello.ts": "export const n = 1;\n",
  });
  const lines: string[] = [];
  expect(
    await check(dir, (m) => lines.push(String(m)), silent, {
      ...noFilters,
      plugins: ["other"],
      rules: ["fixture/ping"],
    }),
  ).toBe(0);
  expect(lines.join("\n")).toMatch(/No rules matched filters/);
});

test("expandTypeScriptClosure walks imports both ways", async () => {
  const dir = await writeTree({
    "src/a.ts": "export const x = 1;\n",
    "src/b.ts": 'import { x } from "./a";\nexport const y = x;\n',
    "src/c.ts": "export const z = 1;\n",
  });
  const a = join(dir, "src/a.ts");
  const b = join(dir, "src/b.ts");
  const c = join(dir, "src/c.ts");
  expect(expandTypeScriptClosure(dir, [a, b, c], [a])).toEqual([a, b].sort());
  expect(expandTypeScriptClosure(dir, [a, b, c], [b])).toEqual([a, b].sort());
});

test("--diff seeds branch files and pulls import closure", async () => {
  const dir = await writeTree({
    "plugin.mjs": listPlugin,
    "qualety.config.json": config({ "fixture/list": "error" }),
    "src/a.ts": "export const x = 1;\n",
    "src/b.ts": 'import { x } from "./a";\nexport const y = x;\n',
    "src/c.ts": "export const z = 1;\n",
  });
  await initGit(dir);
  await commitAll(dir, "base");
  await git(dir, ["update-ref", "refs/remotes/origin/main", "HEAD"]);
  await git(dir, ["checkout", "-b", "feature"]);
  await writeFile(join(dir, "src/a.ts"), "export const x = 2;\n");
  await git(dir, ["add", "src/a.ts"]);
  await git(dir, ["commit", "-m", "change a"]);
  const lines: string[] = [];
  expect(
    await check(dir, (m) => lines.push(String(m)), silent, { ...noFilters, diff: "upstream" }),
  ).toBe(1);
  const out = lines.join("\n");
  expect(out).toMatch(/listed:src\/a\.ts\|src\/b\.ts/);
  expect(out).not.toMatch(/src\/c\.ts/);
  expect(out).toMatch(/sources:2/);
});

test("--diff-worktree seeds dirty and untracked files plus closure", async () => {
  const dir = await writeTree({
    "plugin.mjs": listPlugin,
    "qualety.config.json": config({ "fixture/list": "error" }),
    "src/a.ts": "export const x = 1;\n",
    "src/b.ts": 'import { x } from "./a";\nexport const y = x;\n',
    "src/c.ts": "export const z = 1;\n",
  });
  await initGit(dir);
  await commitAll(dir, "base");
  await writeFile(join(dir, "src/a.ts"), "export const x = 2;\n");
  await writeFile(join(dir, "src/d.ts"), "export const w = 1;\n");
  const lines: string[] = [];
  expect(
    await check(dir, (m) => lines.push(String(m)), silent, { ...noFilters, diff: "worktree" }),
  ).toBe(1);
  const out = lines.join("\n");
  expect(out).toMatch(/listed:src\/a\.ts\|src\/b\.ts\|src\/d\.ts/);
  expect(out).not.toMatch(/src\/c\.ts/);
  expect(out).toMatch(/sources:3/);
});

test("--diff outside git exits 2", async () => {
  const dir = await writeTree({
    "plugin.mjs": listPlugin,
    "qualety.config.json": config({ "fixture/list": "error" }),
    "src/a.ts": "export const x = 1;\n",
  });
  const errors: string[] = [];
  expect(
    await check(dir, silent, (m) => errors.push(String(m)), { ...noFilters, diff: "upstream" }),
  ).toBe(2);
  expect(errors.join("\n")).toMatch(/git /);
  await expect(listGitSeed(dir, "upstream")).rejects.toThrow(/git /);
});

test("empty --diff seed exits 0 and does not scan the tree", async () => {
  const dir = await writeTree({
    "plugin.mjs": listPlugin,
    "qualety.config.json": config({ "fixture/list": "error" }),
    "src/a.ts": "export const x = 1;\n",
    "src/c.ts": "export const z = 1;\n",
  });
  await initGit(dir);
  await commitAll(dir, "base");
  await git(dir, ["update-ref", "refs/remotes/origin/main", "HEAD"]);
  const lines: string[] = [];
  expect(
    await check(dir, (m) => lines.push(String(m)), silent, { ...noFilters, diff: "upstream" }),
  ).toBe(0);
  expect(lines.join("\n")).toMatch(/No files to check/);
  expect(lines.join("\n")).not.toMatch(/listed:/);
});

test("empty --diff-worktree seed exits 0 and does not scan the tree", async () => {
  const dir = await writeTree({
    "plugin.mjs": listPlugin,
    "qualety.config.json": config({ "fixture/list": "error" }),
    "src/a.ts": "export const x = 1;\n",
  });
  await initGit(dir);
  await commitAll(dir, "base");
  const lines: string[] = [];
  expect(
    await check(dir, (m) => lines.push(String(m)), silent, { ...noFilters, diff: "worktree" }),
  ).toBe(0);
  expect(lines.join("\n")).toMatch(/No files to check/);
  expect(lines.join("\n")).not.toMatch(/listed:/);
});

test("expandCompanions adds the other side both ways", async () => {
  const dir = await writeTree({
    "docs/rulesets/dev.md": "",
    "packages/dev/src/index.ts": "",
    "docs/api.md": "",
    "packages/qualety/src/index.ts": "",
    "src/other.ts": "",
  });
  const catalog = join(dir, "docs/rulesets/dev.md");
  const plugin = join(dir, "packages/dev/src/index.ts");
  const api = join(dir, "docs/api.md");
  const core = join(dir, "packages/qualety/src/index.ts");
  const other = join(dir, "src/other.ts");
  const workspace = [catalog, plugin, api, core, other];
  expect(expandCompanions(dir, workspace, [catalog])).toEqual([catalog, plugin].sort());
  expect(expandCompanions(dir, workspace, [plugin])).toEqual([catalog, plugin].sort());
  expect(expandCompanions(dir, workspace, [api])).toEqual([api, core].sort());
  expect(expandCompanions(dir, workspace, [core])).toEqual([api, core].sort());
  expect(expandCompanions(dir, workspace, [other])).toEqual([other]);
  expect(expandCompanions(dir, [plugin, other], [plugin])).toEqual([plugin]);
});

const companionInclude = { include: ["**/*.ts", "**/*.md"] };

test("--diff expands catalog companion into plugin entry", async () => {
  const dir = await writeTree({
    "plugin.mjs": listPlugin,
    "qualety.config.json": config({ "fixture/list": "error" }, companionInclude),
    "docs/rulesets/dev.md": "# dev\n",
    "packages/dev/src/index.ts": "export default { name: 'dev', rules: {} };\n",
    "src/unrelated.ts": "export const n = 1;\n",
  });
  await initGit(dir);
  await commitAll(dir, "base");
  await git(dir, ["update-ref", "refs/remotes/origin/main", "HEAD"]);
  await git(dir, ["checkout", "-b", "feature"]);
  await writeFile(join(dir, "docs/rulesets/dev.md"), "# dev\n\nchanged\n");
  await git(dir, ["add", "docs/rulesets/dev.md"]);
  await git(dir, ["commit", "-m", "change catalog"]);
  const lines: string[] = [];
  expect(
    await check(dir, (m) => lines.push(String(m)), silent, { ...noFilters, diff: "upstream" }),
  ).toBe(1);
  const out = lines.join("\n");
  expect(out).toMatch(/listed:docs\/rulesets\/dev\.md\|packages\/dev\/src\/index\.ts/);
  expect(out).not.toMatch(/src\/unrelated\.ts/);
  expect(out).toMatch(/sources:1/);
});

test("--diff expands plugin entry companion into catalog", async () => {
  const dir = await writeTree({
    "plugin.mjs": listPlugin,
    "qualety.config.json": config({ "fixture/list": "error" }, companionInclude),
    "docs/rulesets/dev.md": "# dev\n",
    "packages/dev/src/index.ts": "export default { name: 'dev', rules: {} };\n",
    "src/unrelated.ts": "export const n = 1;\n",
  });
  await initGit(dir);
  await commitAll(dir, "base");
  await git(dir, ["update-ref", "refs/remotes/origin/main", "HEAD"]);
  await git(dir, ["checkout", "-b", "feature"]);
  await writeFile(
    join(dir, "packages/dev/src/index.ts"),
    "export default { name: 'dev', rules: { ping: {} } };\n",
  );
  await git(dir, ["add", "packages/dev/src/index.ts"]);
  await git(dir, ["commit", "-m", "change plugin"]);
  const lines: string[] = [];
  expect(
    await check(dir, (m) => lines.push(String(m)), silent, { ...noFilters, diff: "upstream" }),
  ).toBe(1);
  const out = lines.join("\n");
  expect(out).toMatch(/listed:docs\/rulesets\/dev\.md\|packages\/dev\/src\/index\.ts/);
  expect(out).not.toMatch(/src\/unrelated\.ts/);
  expect(out).toMatch(/sources:1/);
});
