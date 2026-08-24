import { readFileSync } from "node:fs";

export const someRule = {
  create() {
    return readFileSync("x", "utf8");
  },
};
