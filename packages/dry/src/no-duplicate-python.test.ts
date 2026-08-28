import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import { check } from "../../qualety/src/engine.ts";
import { NO_SUGGESTION } from "../../qualety/src/index.ts";
import { reportsFromIndex } from "./no-duplicate-code.ts";

const here = fileURLToPath(new URL(".", import.meta.url));
const fixtures = join(here, "../fixtures");
const emptyReport = { schema_version: 2, clusters: [] };

const cannedReport = {
  schema_version: 2,
  clusters: [
    {
      id: 1,
      similarity: 0.94,
      test_only: false,
      members: [
        {
          file: "src/invoice.py",
          name: "compute_order_total",
          start_line: 1,
          end_line: 20,
          representative: true,
          test: false,
        },
        {
          file: "src/billing.py",
          name: "calculate_billing_total",
          start_line: 3,
          end_line: 22,
          representative: false,
          test: false,
        },
      ],
    },
  ],
};

const tsPairReport = {
  schema_version: 2,
  clusters: [
    {
      id: 1,
      similarity: 0.94,
      test_only: false,
      members: [
        {
          file: "src/invoice.ts",
          name: "tokenizeWords",
          start_line: 1,
          end_line: 20,
          representative: true,
          test: false,
        },
        {
          file: "src/billing.ts",
          name: "walkDepthSum",
          start_line: 1,
          end_line: 20,
          representative: false,
          test: false,
        },
      ],
    },
  ],
};

const mixedMembersReport = {
  schema_version: 2,
  clusters: [
    {
      id: 1,
      similarity: 0.9,
      test_only: false,
      members: [
        {
          file: "src/invoice.ts",
          name: "tokenizeWords",
          start_line: 1,
          end_line: 20,
          representative: true,
          test: false,
        },
        {
          file: "src/invoice.py",
          name: "tokenize_words",
          start_line: 1,
          end_line: 20,
          representative: false,
          test: false,
        },
      ],
    },
  ],
};

const bothLangsReport = {
  schema_version: 2,
  clusters: [...tsPairReport.clusters, ...cannedReport.clusters],
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
  rules: string[] = ["dry/no-duplicate-python"],
) {
  const stubDir = await mkdtemp(join(tmpdir(), "ci-dry-py-stub-"));
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

test("reportsFromIndex maps a python cluster to a concrete suggestion", () => {
  const reports = reportsFromIndex({
    clusters: [
      {
        id: 1,
        similarity: 0.94,
        testOnly: false,
        members: [
          {
            file: "src/invoice.py",
            name: "compute_order_total",
            startLine: 1,
            endLine: 20,
            representative: true,
            test: false,
          },
          {
            file: "src/billing.py",
            name: "calculate_billing_total",
            startLine: 3,
            endLine: 22,
            representative: false,
            test: false,
          },
        ],
      },
    ],
  });
  expect(reports).toHaveLength(1);
  expect(reports[0]?.file).toBe("src/invoice.py");
  expect(reports[0]?.message).toMatch(
    /"compute_order_total" is duplicate logical code of "calculate_billing_total"/,
  );
  expect(reports[0]?.suggestion).toMatch(/Reuse "calculate_billing_total" from src\/billing\.py:3/);
  expect(reports[0]?.suggestion).not.toBe(NO_SUGGESTION);
});

test("python duplicate pair exits 1 with concrete suggestion", async () => {
  const result = await runFixture("python-duplicate-pair", cannedReport);
  expect(result.err).toBe("");
  expect(result.code).toBe(1);
  expect(result.out).toMatch(
    /src\/invoice\.py:1:1\s+error\s+dry\/no-duplicate-python\s+"compute_order_total" is duplicate logical code/,
  );
  expect(result.out).toMatch(/suggestion: Reuse "calculate_billing_total"/);
  expect(result.out).not.toMatch(NO_SUGGESTION);
  expect(result.out).not.toMatch(/dry\/no-duplicate-code/);
});

test("unique python functions exit 0", async () => {
  const result = await runFixture("python-unique", emptyReport);
  expect(result.err).toBe("");
  expect(result.code).toBe(0);
  expect(result.out).not.toMatch(/dry\/no-duplicate-python/);
});

test("python test and fixture paths are skipped", async () => {
  const result = await runFixture("python-tests-excluded", {
    schema_version: 2,
    clusters: [
      {
        id: 1,
        similarity: 1,
        test_only: false,
        members: [
          {
            file: "src/test_invoice.py",
            name: "compute_order_total",
            start_line: 1,
            end_line: 20,
            representative: true,
            test: false,
          },
          {
            file: "src/test_billing.py",
            name: "calculate_billing_total",
            start_line: 1,
            end_line: 20,
            representative: false,
            test: false,
          },
        ],
      },
      {
        id: 2,
        similarity: 1,
        test_only: false,
        members: [
          {
            file: "src/invoice_test.py",
            name: "compute_order_total",
            start_line: 1,
            end_line: 20,
            representative: true,
            test: false,
          },
          {
            file: "src/billing_test.py",
            name: "calculate_billing_total",
            start_line: 1,
            end_line: 20,
            representative: false,
            test: false,
          },
        ],
      },
      {
        id: 3,
        similarity: 1,
        test_only: false,
        members: [
          {
            file: "src/tests/invoice.py",
            name: "compute_order_total",
            start_line: 1,
            end_line: 20,
            representative: true,
            test: false,
          },
          {
            file: "src/tests/billing.py",
            name: "calculate_billing_total",
            start_line: 1,
            end_line: 20,
            representative: false,
            test: false,
          },
        ],
      },
    ],
  });
  expect(result.err).toBe("");
  expect(result.code).toBe(0);
  expect(result.out).not.toMatch(/dry\/no-duplicate-python/);
});

test("warn severity prints warn and still exits 1", async () => {
  const result = await runFixture("python-warn-severity", cannedReport);
  expect(result.err).toBe("");
  expect(result.code).toBe(1);
  expect(result.out).toMatch(/\swarn\s+dry\/no-duplicate-python\s+/);
  expect(result.out).not.toMatch(/\serror\s+dry\/no-duplicate-python\s+/);
});

test("missing dupehound binary exits 2 and names the python rule", async () => {
  const prevBin = process.env.QUALETY_DUPEHOUND;
  const prevPath = process.env.PATH;
  const errors: string[] = [];
  try {
    delete process.env.QUALETY_DUPEHOUND;
    process.env.PATH = "/nonexistent";
    const code = await check(
      join(fixtures, "python-unique"),
      () => {},
      (m) => errors.push(String(m)),
      { plugins: [], excludePlugins: [], rules: ["dry/no-duplicate-python"], diff: "off" },
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
  expect(errors.join("\n")).toMatch(/dry\/no-duplicate-python/);
  expect(errors.join("\n")).not.toMatch(/dry\/no-duplicate-code/);
});

test("mixed tree keeps each rule on its language", async () => {
  const result = await runFixture("mixed-lang", bothLangsReport, [
    "dry/no-duplicate-code",
    "dry/no-duplicate-python",
  ]);
  expect(result.err).toBe("");
  expect(result.code).toBe(1);
  expect(result.out).toMatch(/dry\/no-duplicate-code/);
  expect(result.out).toMatch(/dry\/no-duplicate-python/);
  expect(result.out).not.toMatch(/\.py:\d+:\d+\s+\w+\s+dry\/no-duplicate-code/);
  expect(result.out).not.toMatch(/\.ts:\d+:\d+\s+\w+\s+dry\/no-duplicate-python/);
  expect(result.out).not.toMatch(NO_SUGGESTION);
});

test("mixed-language cluster is quiet after each rule keeps one language", async () => {
  const result = await runFixture("mixed-lang", mixedMembersReport, [
    "dry/no-duplicate-code",
    "dry/no-duplicate-python",
  ]);
  expect(result.err).toBe("");
  expect(result.code).toBe(0);
  expect(result.out).not.toMatch(/dry\/no-duplicate-code/);
  expect(result.out).not.toMatch(/dry\/no-duplicate-python/);
});

test("python rule ignores a typescript-only cluster", async () => {
  const result = await runFixture("mixed-lang", tsPairReport, [
    "dry/no-duplicate-code",
    "dry/no-duplicate-python",
  ]);
  expect(result.err).toBe("");
  expect(result.code).toBe(1);
  expect(result.out).toMatch(/dry\/no-duplicate-code/);
  expect(result.out).not.toMatch(/dry\/no-duplicate-python/);
});
