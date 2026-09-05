import type { Plugin } from "qualety";
import { artifactHashRecorded } from "./artifact-hash-recorded.ts";
import { dataloaderWorkerSeeding } from "./dataloader-worker-seeding.ts";
import { determinismTestRequired } from "./determinism-test-required.ts";
import { deterministicAlgorithmsOptIn } from "./deterministic-algorithms-opt-in.ts";
import { metadataWriterRequired } from "./metadata-writer-required.ts";
import { noCudaHardcoded } from "./no-cuda-hardcoded.ts";
import { noInplaceArtifactClobber } from "./no-inplace-artifact-clobber.ts";
import { noNetworkInTests } from "./no-network-in-tests.ts";
import { optimizerZeroGrad } from "./optimizer-zero-grad.ts";
import { packPaddedSequenceBeforeRnn } from "./pack-padded-sequence-before-rnn.ts";
import { recordCodeVersion } from "./record-code-version.ts";
import { requireGlobalSeed } from "./require-global-seed.ts";
import { runMetadataCompleteness } from "./run-metadata-completeness.ts";
import { seedMustReachFrameworkRng } from "./seed-must-reach-framework-rng.ts";
import { tensorToDeviceResultIgnored } from "./tensor-to-device-result-ignored.ts";
import { tf32MustBeExplicit } from "./tf32-must-be-explicit.ts";
import { trainModeRestored } from "./train-mode-restored.ts";

const plugin: Plugin = {
  name: "ml",
  rules: {
    "require-global-seed": requireGlobalSeed,
    "seed-must-reach-framework-rng": seedMustReachFrameworkRng,
    "dataloader-worker-seeding": dataloaderWorkerSeeding,
    "tf32-must-be-explicit": tf32MustBeExplicit,
    "determinism-test-required": determinismTestRequired,
    "deterministic-algorithms-opt-in": deterministicAlgorithmsOptIn,
    "metadata-writer-required": metadataWriterRequired,
    "record-code-version": recordCodeVersion,
    "run-metadata-completeness": runMetadataCompleteness,
    "artifact-hash-recorded": artifactHashRecorded,
    "no-inplace-artifact-clobber": noInplaceArtifactClobber,
    "pack-padded-sequence-before-rnn": packPaddedSequenceBeforeRnn,
    "train-mode-restored": trainModeRestored,
    "optimizer-zero-grad": optimizerZeroGrad,
    "tensor-to-device-result-ignored": tensorToDeviceResultIgnored,
    "no-network-in-tests": noNetworkInTests,
    "no-cuda-hardcoded": noCudaHardcoded,
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
        "ml/metadata-writer-required": "error",
        "ml/record-code-version": "error",
        "ml/run-metadata-completeness": "error",
        "ml/artifact-hash-recorded": "error",
        "ml/no-inplace-artifact-clobber": "error",
        "ml/pack-padded-sequence-before-rnn": "error",
        "ml/train-mode-restored": "error",
        "ml/optimizer-zero-grad": "error",
        "ml/tensor-to-device-result-ignored": "error",
        "ml/no-network-in-tests": "error",
        "ml/no-cuda-hardcoded": "error",
      },
    },
  },
};

export default plugin;
export { plugin };
