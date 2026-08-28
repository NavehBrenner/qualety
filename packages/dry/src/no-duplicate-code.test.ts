import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import { check } from "../../qualety/src/engine.ts";
import { NO_SUGGESTION } from "../../qualety/src/index.ts";
import { resolveDupehoundBinary } from "./dupehound.ts";
import { reportsFromIndex } from "./no-duplicate-code.ts";

const here = fileURLToPath(new URL(".", import.meta.url));
const fixtures = join(here, "../fixtures");
const emptyReport = { schema_version: 2, clusters: [] };

const canned = {
  clusters: [
    {
      id: 1,
      similarity: 0.94,
      testOnly: false,
      members: [
        {
          file: "src/invoice.ts",
          name: "computeOrderTotal",
          startLine: 1,
          endLine: 20,
          representative: true,
          test: false,
        },
        {
          file: "src/billing.ts",
          name: "calculateBillingTotal",
          startLine: 3,
          endLine: 22,
          representative: false,
          test: false,
        },
      ],
    },
  ],
};

const cannedReport = {
  schema_version: 2,
  clusters: [
    {
      id: 1,
      similarity: 0.94,
      test_only: false,
      members: [
        {
          file: "src/invoice.ts",
          name: "computeOrderTotal",
          start_line: 1,
          end_line: 20,
          representative: true,
          test: false,
        },
        {
          file: "src/billing.ts",
          name: "calculateBillingTotal",
          start_line: 3,
          end_line: 22,
          representative: false,
          test: false,
        },
      ],
    },
  ],
};

async function writeStub(dir: string, report: unknown): Promise<string> {
  const path = join(dir, "dupehound-stub.mjs");
  await mkdir(dirname(path), { recursive: true });
  await writeFile(
    path,
    `#!/usr/bin/env node
process.stdout.write(${JSON.stringify(JSON.stringify(report))});
`,
    { mode: 0o755 },
  );
  return path;
}

async function runFixture(
  name: string,
  report: unknown,
  rules: string[] = ["dry/no-duplicate-code"],
) {
  const stubDir = await mkdtemp(join(tmpdir(), "ci-dry-stub-"));
  const stub = await writeStub(stubDir, report);
  const prevBin = process.env.QUALETY_DUPEHOUND;
  const lines: string[] = [];
  const errors: string[] = [];
  try {
    process.env.QUALETY_DUPEHOUND = stub;
    const code = await check(
      join(fixtures, name),
      (m) => lines.push(String(m)),
      (m) => errors.push(String(m)),
      { plugins: [], excludePlugins: [], rules, diff: "off" },
    );
    return { code, out: lines.join("\n"), err: errors.join("\n") };
  } finally {
    if (prevBin === undefined) {
      delete process.env.QUALETY_DUPEHOUND;
    } else {
      process.env.QUALETY_DUPEHOUND = prevBin;
    }
  }
}

function hasRealDupehound(): boolean {
  try {
    resolveDupehoundBinary({ PATH: process.env.PATH });
    return true;
  } catch {
    return false;
  }
}

test("reportsFromIndex maps a cluster to a concrete suggestion", () => {
  const reports = reportsFromIndex(canned);
  expect(reports).toHaveLength(1);
  expect(reports[0]?.file).toBe("src/invoice.ts");
  expect(reports[0]?.message).toMatch(
    /"computeOrderTotal" is duplicate logical code of "calculateBillingTotal"/,
  );
  expect(reports[0]?.suggestion).toMatch(/Reuse "calculateBillingTotal" from src\/billing\.ts:3/);
  expect(reports[0]?.suggestion).not.toBe(NO_SUGGESTION);
  expect(reports[0]?.range.start).toEqual({ line: 1, column: 1 });
});

test("reportsFromIndex maps class methods", () => {
  const reports = reportsFromIndex({
    clusters: [
      {
        id: 2,
        similarity: 0.97,
        testOnly: false,
        members: [
          {
            file: "src/invoice.ts",
            name: "Invoice.computeOrderTotal",
            startLine: 2,
            endLine: 21,
            representative: true,
            test: false,
          },
          {
            file: "src/billing.ts",
            name: "Billing.calculateBillingTotal",
            startLine: 2,
            endLine: 21,
            representative: false,
            test: false,
          },
        ],
      },
    ],
  });
  expect(reports).toHaveLength(1);
  expect(reports[0]?.message).toMatch(/"Invoice.computeOrderTotal"/);
  expect(reports[0]?.suggestion).toMatch(/Reuse "Billing.calculateBillingTotal"/);
});

test("reportsFromIndex maps arrow / const function-likes", () => {
  const reports = reportsFromIndex({
    clusters: [
      {
        id: 3,
        similarity: 0.96,
        testOnly: false,
        members: [
          {
            file: "src/invoice.ts",
            name: "computeOrderTotal",
            startLine: 1,
            endLine: 19,
            representative: true,
            test: false,
          },
          {
            file: "src/billing.ts",
            name: "calculateBillingTotal",
            startLine: 1,
            endLine: 19,
            representative: false,
            test: false,
          },
        ],
      },
    ],
  });
  expect(reports).toHaveLength(1);
  expect(reports[0]?.file).toBe("src/invoice.ts");
  expect(reports[0]?.range.start.line).toBe(1);
});

test("reportsFromIndex flags only non-representatives in a multi-member cluster", () => {
  const reports = reportsFromIndex({
    clusters: [
      {
        id: 4,
        similarity: 0.9,
        testOnly: false,
        members: [
          {
            file: "src/invoice.ts",
            name: "alpha",
            startLine: 1,
            endLine: 20,
            representative: true,
            test: false,
          },
          {
            file: "src/billing.ts",
            name: "beta",
            startLine: 1,
            endLine: 20,
            representative: false,
            test: false,
          },
          {
            file: "src/ledger.ts",
            name: "gamma",
            startLine: 4,
            endLine: 24,
            representative: false,
            test: false,
          },
        ],
      },
    ],
  });
  expect(reports.map((item) => item.file)).toEqual(["src/invoice.ts", "src/ledger.ts"]);
  expect(reports.every((item) => item.message.includes('"beta"'))).toBe(true);
});

test("reportsFromIndex span 9 × 2 is quiet", () => {
  const reports = reportsFromIndex({
    clusters: [
      {
        id: 10,
        similarity: 1,
        testOnly: false,
        members: [
          {
            file: "a.ts",
            name: "a",
            startLine: 1,
            endLine: 9,
            representative: true,
            test: false,
          },
          {
            file: "b.ts",
            name: "b",
            startLine: 1,
            endLine: 9,
            representative: false,
            test: false,
          },
        ],
      },
    ],
  });
  expect(reports).toHaveLength(0);
});

test("reportsFromIndex span 10 × 2 reports", () => {
  const reports = reportsFromIndex({
    clusters: [
      {
        id: 11,
        similarity: 1,
        testOnly: false,
        members: [
          {
            file: "a.ts",
            name: "a",
            startLine: 1,
            endLine: 10,
            representative: true,
            test: false,
          },
          {
            file: "b.ts",
            name: "b",
            startLine: 1,
            endLine: 10,
            representative: false,
            test: false,
          },
        ],
      },
    ],
  });
  expect(reports).toHaveLength(1);
  expect(reports[0]?.file).toBe("b.ts");
});

test("reportsFromIndex 4 tiny spans reports", () => {
  const reports = reportsFromIndex({
    clusters: [
      {
        id: 12,
        similarity: 1,
        testOnly: false,
        members: [
          {
            file: "a.ts",
            name: "a",
            startLine: 1,
            endLine: 2,
            representative: true,
            test: false,
          },
          {
            file: "b.ts",
            name: "b",
            startLine: 1,
            endLine: 2,
            representative: false,
            test: false,
          },
          {
            file: "c.ts",
            name: "c",
            startLine: 1,
            endLine: 2,
            representative: false,
            test: false,
          },
          {
            file: "d.ts",
            name: "d",
            startLine: 1,
            endLine: 2,
            representative: false,
            test: false,
          },
        ],
      },
    ],
  });
  expect(reports.map((item) => item.file)).toEqual(["b.ts", "c.ts", "d.ts"]);
});

test("duplicate pair exits 1 with concrete suggestion", async () => {
  const result = await runFixture("duplicate-pair", cannedReport);
  expect(result.err).toBe("");
  expect(result.code).toBe(1);
  expect(result.out).toMatch(
    /src\/invoice\.ts:1:1\s+error\s+dry\/no-duplicate-code\s+"computeOrderTotal" is duplicate logical code/,
  );
  expect(result.out).toMatch(/suggestion: Reuse "calculateBillingTotal"/);
  expect(result.out).not.toMatch(NO_SUGGESTION);
});

test("method pair exits 1", async () => {
  const result = await runFixture("method-pair", {
    schema_version: 2,
    clusters: [
      {
        id: 1,
        similarity: 0.97,
        test_only: false,
        members: [
          {
            file: "src/invoice.ts",
            name: "Invoice.computeOrderTotal",
            start_line: 2,
            end_line: 21,
            representative: true,
            test: false,
          },
          {
            file: "src/billing.ts",
            name: "Billing.calculateBillingTotal",
            start_line: 2,
            end_line: 21,
            representative: false,
            test: false,
          },
        ],
      },
    ],
  });
  expect(result.err).toBe("");
  expect(result.code).toBe(1);
  expect(result.out).toMatch(/Invoice.computeOrderTotal/);
  expect(result.out).toMatch(/suggestion: Reuse "Billing.calculateBillingTotal"/);
});

test("arrow / const function-like pair exits 1", async () => {
  const result = await runFixture("arrow-pair", {
    schema_version: 2,
    clusters: [
      {
        id: 1,
        similarity: 0.96,
        test_only: false,
        members: [
          {
            file: "src/invoice.ts",
            name: "computeOrderTotal",
            start_line: 1,
            end_line: 19,
            representative: true,
            test: false,
          },
          {
            file: "src/billing.ts",
            name: "calculateBillingTotal",
            start_line: 1,
            end_line: 19,
            representative: false,
            test: false,
          },
        ],
      },
    ],
  });
  expect(result.err).toBe("");
  expect(result.code).toBe(1);
  expect(result.out).toMatch(/src\/invoice\.ts:1:1\s+error\s+dry\/no-duplicate-code/);
});

test("unique functions exit 0", async () => {
  const result = await runFixture("unique", emptyReport);
  expect(result.err).toBe("");
  expect(result.code).toBe(0);
  expect(result.out).not.toMatch(/dry\/no-duplicate-code/);
});

test("tests are excluded", async () => {
  const result = await runFixture("tests-excluded", {
    schema_version: 2,
    clusters: [
      {
        ...cannedReport.clusters[0],
        test_only: true,
        members: cannedReport.clusters[0]?.members.map((m) => ({
          ...m,
          file: m.file.replace("src/", "src/").replace(".ts", ".test.ts"),
          test: true,
        })),
      },
    ],
  });
  expect(result.err).toBe("");
  expect(result.code).toBe(0);
  expect(result.out).not.toMatch(/dry\/no-duplicate-code/);
});

test("generated files are excluded", async () => {
  const result = await runFixture("generated-excluded", emptyReport);
  expect(result.err).toBe("");
  expect(result.code).toBe(0);
  expect(result.out).not.toMatch(/dry\/no-duplicate-code/);
});

test("warn severity prints warn and still exits 1", async () => {
  const result = await runFixture("warn-severity", cannedReport);
  expect(result.err).toBe("");
  expect(result.code).toBe(1);
  expect(result.out).toMatch(/\swarn\s+dry\/no-duplicate-code\s+/);
  expect(result.out).not.toMatch(/\serror\s+dry\/no-duplicate-code\s+/);
});

test("missing dupehound binary exits 2 and names the rule", async () => {
  const prevBin = process.env.QUALETY_DUPEHOUND;
  const prevPath = process.env.PATH;
  const errors: string[] = [];
  try {
    delete process.env.QUALETY_DUPEHOUND;
    process.env.PATH = "/nonexistent";
    const code = await check(
      join(fixtures, "unique"),
      () => {},
      (m) => errors.push(String(m)),
      { plugins: [], excludePlugins: [], rules: ["dry/no-duplicate-code"], diff: "off" },
    );
    expect(code).toBe(2);
  } finally {
    process.env.PATH = prevPath;
    if (prevBin === undefined) {
      delete process.env.QUALETY_DUPEHOUND;
    } else {
      process.env.QUALETY_DUPEHOUND = prevBin;
    }
  }
  expect(errors.join("\n")).toMatch(/dupehound/i);
  expect(errors.join("\n")).toMatch(/dry\/no-duplicate-code/);
});

test("bad dupehound JSON exits 2 and names the rule", async () => {
  const stubDir = await mkdtemp(join(tmpdir(), "ci-dry-bad-"));
  const stub = join(stubDir, "dupehound-stub.mjs");
  await writeFile(
    stub,
    `#!/usr/bin/env node
process.stdout.write("not-json");
`,
    { mode: 0o755 },
  );
  const prevBin = process.env.QUALETY_DUPEHOUND;
  const errors: string[] = [];
  try {
    process.env.QUALETY_DUPEHOUND = stub;
    const code = await check(
      join(fixtures, "unique"),
      () => {},
      (m) => errors.push(String(m)),
      { plugins: [], excludePlugins: [], rules: ["dry/no-duplicate-code"], diff: "off" },
    );
    expect(code).toBe(2);
  } finally {
    if (prevBin === undefined) {
      delete process.env.QUALETY_DUPEHOUND;
    } else {
      process.env.QUALETY_DUPEHOUND = prevBin;
    }
  }
  expect(errors.join("\n")).toMatch(/dupehound/i);
  expect(errors.join("\n")).toMatch(/dry\/no-duplicate-code/);
});

test("multi-plugin run attributes ts/, react/, and dry/ without cross-talk", async () => {
  const result = await runFixture("multi-plugin", cannedReport, [
    "ts/public-exports-tested",
    "react/no-fetch-in-useeffect",
    "react/query-error-handled",
    "dry/no-duplicate-code",
  ]);
  expect(result.err).toBe("");
  expect(result.code).toBe(1);
  expect(result.out).toMatch(/react\/no-fetch-in-useeffect/);
  expect(result.out).toMatch(/react\/query-error-handled/);
  expect(result.out).toMatch(/ts\/public-exports-tested/);
  expect(result.out).toMatch(/dry\/no-duplicate-code/);
  expect(result.out).not.toMatch(NO_SUGGESTION);
});

test("fragment 3-line × 3 is quiet under the report gate", async () => {
  const result = await runFixture("fragment-3x3", emptyReport);
  expect(result.err).toBe("");
  expect(result.code).toBe(0);
  expect(result.out).not.toMatch(/dry\/no-duplicate-code/);
});

test("fragment 3-line × 4 exits 1 with concrete suggestion", async () => {
  const result = await runFixture("fragment-3x4", emptyReport);
  expect(result.err).toBe("");
  expect(result.code).toBe(1);
  expect(result.out).toMatch(/dry\/no-duplicate-code/);
  expect(result.out).toMatch(/contains duplicate logical code of "alpha" in src\/hosts\.ts:\d+/);
  expect(result.out).toMatch(/src\/hosts\.ts:\d+:[2-9]\s+error\s+dry\/no-duplicate-code/);
  expect(result.out).toMatch(/suggestion: Extract a shared helper from src\/hosts\.ts:\d+/);
  expect(result.out).not.toMatch(NO_SUGGESTION);
});

test("fragment ~13-line × 2 exits 1 (joint ≥ 20)", async () => {
  const result = await runFixture("fragment-13x2", emptyReport);
  expect(result.err).toBe("");
  expect(result.code).toBe(1);
  expect(result.out).toMatch(/dry\/no-duplicate-code/);
  expect(result.out).toMatch(
    /contains duplicate logical code of "processLeft" in src\/left\.ts:\d+/,
  );
  expect(result.out).toMatch(/src\/right\.ts:\d+:[2-9]\s+error\s+dry\/no-duplicate-code/);
  expect(result.out).toMatch(/suggestion: Extract a shared helper from src\/left\.ts:\d+/);
  expect(result.out).not.toMatch(NO_SUGGESTION);
});

test("fragment renamed locals still cluster", async () => {
  const result = await runFixture("fragment-renamed", emptyReport);
  expect(result.err).toBe("");
  expect(result.code).toBe(1);
  expect(result.out).toMatch(/dry\/no-duplicate-code/);
  expect(result.out).toMatch(/contains duplicate logical code of "processAlpha"/);
  expect(result.out).toMatch(/suggestion: Extract a shared helper/);
  expect(result.out).not.toMatch(NO_SUGGESTION);
});

test("fragment nested stop clusters same outer with different nested bodies", async () => {
  const result = await runFixture("fragment-nested-stop", emptyReport);
  expect(result.err).toBe("");
  expect(result.code).toBe(1);
  expect(result.out).toMatch(/dry\/no-duplicate-code/);
  expect(result.out).toMatch(/contains duplicate logical code of "processAlpha"/);
  expect(result.out).toMatch(/suggestion: Extract a shared helper/);
  expect(result.out).not.toMatch(NO_SUGGESTION);
});

test("fragment nested inner still clusters nested bodies", async () => {
  const result = await runFixture("fragment-nested-inner", emptyReport);
  expect(result.err).toBe("");
  expect(result.code).toBe(1);
  expect(result.out).toMatch(/dry\/no-duplicate-code/);
  expect(result.out).toMatch(/contains duplicate logical code of "sharedInner"/);
  expect(result.out).toMatch(/suggestion: Extract a shared helper/);
  expect(result.out).not.toMatch(NO_SUGGESTION);
});

test("Arm F never reports Python under dry/no-duplicate-code", async () => {
  const result = await runFixture(
    "mixed-lang",
    {
      schema_version: 2,
      clusters: [
        {
          id: 1,
          similarity: 0.94,
          test_only: false,
          members: [
            {
              file: "src/invoice.py",
              name: "tokenize_words",
              start_line: 1,
              end_line: 20,
              representative: true,
              test: false,
            },
            {
              file: "src/billing.py",
              name: "walk_depth_sum",
              start_line: 1,
              end_line: 20,
              representative: false,
              test: false,
            },
          ],
        },
      ],
    },
    ["dry/no-duplicate-code", "dry/no-duplicate-python"],
  );
  expect(result.err).toBe("");
  expect(result.code).toBe(1);
  expect(result.out).toMatch(/dry\/no-duplicate-python/);
  expect(result.out).not.toMatch(/dry\/no-duplicate-code/);
  expect(result.out).not.toMatch(/\.py:\d+:\d+\s+\w+\s+dry\/no-duplicate-code/);
});

test("fragment quiet paths and type-only shapes exit 0", async () => {
  const result = await runFixture("fragment-quiet", emptyReport);
  expect(result.err).toBe("");
  expect(result.code).toBe(0);
  expect(result.out).not.toMatch(/dry\/no-duplicate-code/);
});

test.skipIf(!hasRealDupehound())(
  "live dupehound scan flags duplicate-pair and not unique",
  async () => {
    const prevBin = process.env.QUALETY_DUPEHOUND;
    try {
      delete process.env.QUALETY_DUPEHOUND;
      const dupLines: string[] = [];
      const dupErr: string[] = [];
      const dup = await check(
        join(fixtures, "duplicate-pair"),
        (m) => dupLines.push(String(m)),
        (m) => dupErr.push(String(m)),
        { plugins: [], excludePlugins: [], rules: ["dry/no-duplicate-code"], diff: "off" },
      );
      expect(dupErr.join("\n")).toBe("");
      expect(dup).toBe(1);
      expect(dupLines.join("\n")).toMatch(/dry\/no-duplicate-code/);
      expect(dupLines.join("\n")).toMatch(/suggestion: Reuse/);

      const uniqLines: string[] = [];
      const uniqErr: string[] = [];
      const uniq = await check(
        join(fixtures, "unique"),
        (m) => uniqLines.push(String(m)),
        (m) => uniqErr.push(String(m)),
        { plugins: [], excludePlugins: [], rules: ["dry/no-duplicate-code"], diff: "off" },
      );
      expect(uniqErr.join("\n")).toBe("");
      expect(uniq).toBe(0);
      expect(uniqLines.join("\n")).not.toMatch(/dry\/no-duplicate-code/);
    } finally {
      if (prevBin === undefined) {
        delete process.env.QUALETY_DUPEHOUND;
      } else {
        process.env.QUALETY_DUPEHOUND = prevBin;
      }
    }
  },
);
