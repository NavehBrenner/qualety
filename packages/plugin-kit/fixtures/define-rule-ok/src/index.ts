import type { Plugin } from "qualety";
import { demoRule } from "./rule.ts";

const plugin: Plugin = {
  name: "demo",
  rules: {
    ok: demoRule,
  },
};

export default plugin;
