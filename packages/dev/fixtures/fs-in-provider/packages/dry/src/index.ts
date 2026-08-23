import { buildIndex } from "./provider.ts";
import { noDupes } from "./rule.ts";

const plugin = {
  name: "dry",
  provides: {
    dupehound: {
      build: (context: unknown) => buildIndex(context),
    },
  },
  rules: {
    "no-duplicate-functions": noDupes,
  },
};

export default plugin;
