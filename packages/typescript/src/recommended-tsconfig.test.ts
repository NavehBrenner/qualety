import { createRequire } from "node:module";
import { expect, test } from "vitest";

const require = createRequire(import.meta.url);
const fragment: unknown = require("../tsconfig/recommended.json");
const pkg: unknown = require("../package.json");

const lockedFragment = {
  compilerOptions: {
    strict: true,
    noUncheckedIndexedAccess: true,
    noImplicitOverride: true,
    noFallthroughCasesInSwitch: true,
    skipLibCheck: true,
    verbatimModuleSyntax: true,
    isolatedModules: true,
  },
};

test("recommended tsconfig is the locked compilerOptions fragment", () => {
  expect(fragment).toEqual(lockedFragment);
});

test("package exports and files ship the recommended tsconfig", () => {
  expect(pkg).toEqual(
    expect.objectContaining({
      exports: expect.objectContaining({
        "./tsconfig/recommended.json": "./tsconfig/recommended.json",
      }),
      files: expect.arrayContaining(["tsconfig"]),
    }),
  );
  const resolved: unknown = require(
    require.resolve("@qualety/typescript/tsconfig/recommended.json"),
  );
  expect(resolved).toEqual(fragment);
});
