import { defineRule } from "qualety";

const plugin = {
  name: "demo",
  rules: {
    ok: defineRule({
      meta: { docs: { description: "ok" } },
      create() {},
    }),
  },
  configs: {
    recommended: {
      rules: {
        "demo/ok": "error",
      },
    },
  },
};

export default plugin;
