import { expect, test } from "vitest";
import {
  assignTarget,
  attrChain,
  callKeyword,
  firstTrainingNode,
  forEachMlSource,
  isBackwardCall,
  isBefore,
  isDataLoaderCall,
  lastAttr,
  nodePos,
  treeHas,
} from "./ast.ts";

test("ml ast helpers", () => {
  expect(forEachMlSource).toBeTypeOf("function");
  expect(treeHas).toBeTypeOf("function");
  expect(assignTarget).toBeTypeOf("function");
  expect(attrChain).toBeTypeOf("function");
  expect(lastAttr).toBeTypeOf("function");
  expect(isDataLoaderCall).toBeTypeOf("function");
  expect(isBackwardCall).toBeTypeOf("function");
  expect(firstTrainingNode).toBeTypeOf("function");
  expect(nodePos).toBeTypeOf("function");
  expect(isBefore).toBeTypeOf("function");
  expect(callKeyword).toBeTypeOf("function");
});
