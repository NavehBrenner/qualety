import type { Plugin } from "qualety";
import { dataloaderWorkerSeeding } from "./dataloader-worker-seeding.ts";
import { determinismTestRequired } from "./determinism-test-required.ts";
import { deterministicAlgorithmsOptIn } from "./deterministic-algorithms-opt-in.ts";
import { requireGlobalSeed } from "./require-global-seed.ts";
import { seedMustReachFrameworkRng } from "./seed-must-reach-framework-rng.ts";
import { tf32MustBeExplicit } from "./tf32-must-be-explicit.ts";

const plugin: Plugin = {
  name: "ml",
  rules: {
    "require-global-seed": requireGlobalSeed,
    "seed-must-reach-framework-rng": seedMustReachFrameworkRng,
    "dataloader-worker-seeding": dataloaderWorkerSeeding,
    "tf32-must-be-explicit": tf32MustBeExplicit,
    "determinism-test-required": determinismTestRequired,
    "deterministic-algorithms-opt-in": deterministicAlgorithmsOptIn,
  },
  configs: {
    recommended: {
      rules: {
        "ml/require-global-seed": "error",
        "ml/seed-must-reach-framework-rng": "error",
        "ml/dataloader-worker-seeding": "error",
        "ml/tf32-must-be-explicit": "error",
        "ml/determinism-test-required": "error",
        "ml/deterministic-algorithms-opt-in": "off",
      },
    },
  },
};

export default plugin;
export { plugin };
