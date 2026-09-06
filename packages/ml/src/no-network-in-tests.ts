import { isTestPath, nodeRange, type PythonNode, walkNodes } from "@qualety/python/walk";
import { defineRule } from "qualety";
import { attrChain, callKeyword, lastAttr } from "./ast.ts";

const DOWNLOAD_HINT =
  "Build encoders/models with pretrained=False / weights=None in tests; use fixtures or local tiny weights.";

export const noNetworkInTests = defineRule({
  meta: {
    requires: ["python"],
    docs: {
      description: "Test modules must not download weights on first use.",
    },
  },
  create(context) {
    const cwd = context.getCwd();
    const python = context.getArtifact("python");
    for (const unit of python.sources.values()) {
      if (!isTestPath(unit.file, cwd)) {
        continue;
      }
      walkNodes(unit.tree, (node) => {
        if (!isDownloadCall(node)) {
          return;
        }
        context.report({
          severity: "error",
          file: unit.file,
          range: nodeRange(node),
          message: "Test module downloads weights (pretrained/from_pretrained/hub).",
          suggestion: DOWNLOAD_HINT,
        });
      });
    }
  },
});

function isDownloadCall(node: PythonNode): boolean {
  if (node._type !== "Call") {
    return false;
  }
  const name = lastAttr(node.func);
  const chain = attrChain(node.func);
  if (name === "from_pretrained" || name === "hf_hub_download") {
    return true;
  }
  if (name === "load" && chain.includes("hub")) {
    return true;
  }
  const pretrained = callKeyword(node, "pretrained");
  if (pretrained !== undefined && pretrained._type === "Constant" && pretrained.value === true) {
    return true;
  }
  const weights = callKeyword(node, "weights");
  if (weights === undefined) {
    return false;
  }
  if (weights._type === "Constant" && (weights.value === null || weights.value === false)) {
    return false;
  }
  if (
    weights._type === "Constant" &&
    (typeof weights.value === "string" || weights.value === true)
  ) {
    return true;
  }
  return weights._type === "Attribute";
}
