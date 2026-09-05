import { expect, test } from "vitest";
import {
  assignTarget,
  attrChain,
  boundValue,
  callKeyword,
  collectTrainingEntries,
  firstTrainingNode,
  forEachMlSource,
  isBackwardCall,
  isBefore,
  isDataLoaderCall,
  isModelForwardCall,
  lastAttr,
  nodePos,
  optionsSchema,
  parseEntryPoints,
  treeHas,
  walkSkipDefs,
} from "./ast.ts";

test("ml ast helpers", () => {
  expect(forEachMlSource).toBeTypeOf("function");
  expect(treeHas).toBeTypeOf("function");
  expect(assignTarget).toBeTypeOf("function");
  expect(boundValue).toBeTypeOf("function");
  expect(attrChain).toBeTypeOf("function");
  expect(lastAttr).toBeTypeOf("function");
  expect(isDataLoaderCall).toBeTypeOf("function");
  expect(isBackwardCall).toBeTypeOf("function");
  expect(isModelForwardCall).toBeTypeOf("function");
  expect(firstTrainingNode).toBeTypeOf("function");
  expect(nodePos).toBeTypeOf("function");
  expect(isBefore).toBeTypeOf("function");
  expect(callKeyword).toBeTypeOf("function");
  expect(collectTrainingEntries).toBeTypeOf("function");
  expect(parseEntryPoints).toBeTypeOf("function");
  expect(optionsSchema.parse).toBeTypeOf("function");
  expect(walkSkipDefs).toBeTypeOf("function");
});
