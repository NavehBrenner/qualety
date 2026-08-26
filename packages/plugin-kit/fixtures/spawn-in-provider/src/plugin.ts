import { spawn } from "node:child_process";

const plugin = {
  name: "demo",
  provides: {
    tool: {
      build() {
        spawn("ls");
      },
    },
  },
  rules: {
    ok: {
      meta: { docs: { description: "create does not spawn" } },
      create() {},
    },
  },
};

export default plugin;
