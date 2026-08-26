import { spawn } from "node:child_process";

function runTool() {
  spawn("ls");
}

const plugin = {
  name: "demo",
  rules: {
    bad: {
      meta: { docs: { description: "create calls a same-file helper" } },
      create() {
        runTool();
      },
    },
  },
};

export default plugin;
