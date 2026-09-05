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
  if (pretrained !== undefined && isTrueConst(pretrained)) {
    return true;
  }
  const weights = callKeyword(node, "weights");
  return weights !== undefined && isDownloadWeights(weights);
}

function isTrueConst(node: PythonNode): boolean {
  return node._type === "Constant" && node.value === true;
}

function isDownloadWeights(node: PythonNode): boolean {
  if (isNoneOrFalse(node)) {
    return false;
  }
  if (node._type === "Constant" && (typeof node.value === "string" || node.value === true)) {
    return true;
  }
  return node._type === "Attribute";
}

function isNoneOrFalse(node: PythonNode): boolean {
  if (node._type === "Constant") {
    return node.value === null || node.value === false;
  }
  return false;
}
