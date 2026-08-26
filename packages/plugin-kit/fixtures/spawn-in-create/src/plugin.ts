import { exec, execFile, fork, spawn } from "node:child_process";

const plugin = {
  name: "demo",
  rules: {
    bad: {
      meta: { docs: { description: "spawns from create" } },
      create() {
        spawn("ls");
        exec("ls");
        execFile("ls");
        fork("ls");
      },
    },
  },
};

export default plugin;
