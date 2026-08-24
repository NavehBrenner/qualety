import { Project } from "ts-morph";

export function createTypeScriptProvider() {
  return new Project();
}
