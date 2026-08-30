// `with { type: "file" }` imports resolve to the embedded asset's path at runtime.
// Only the bun build ever evaluates them; this keeps tsc able to check the module.
declare module "*.wasm" {
  const path: string;
  export default path;
}
