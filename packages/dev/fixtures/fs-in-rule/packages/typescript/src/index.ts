import { someRule } from "./rule.ts";

const plugin = {
  name: "ts",
  rules: {
    "public-exports-tested": someRule,
  },
};

export default plugin;
