// Loaded only by the bun-compiled binary, never by node.
//
// bun --compile cannot use either of the obvious wasm builds: the "nodejs" ones
// readFileSync a __dirname baked at compile time (so the binary reads the build
// machine's node_modules), and the "bundler" ones call wasm.__wbindgen_start(),
// which bun's wasm module namespace does not expose. The "web" builds take the
// wasm as bytes, so both gates are initialised explicitly from assets embedded
// by `with { type: "file" }`.
import initRuff, { Workspace } from "@astral-sh/ruff-wasm-web";
import ruffWasm from "@astral-sh/ruff-wasm-web/ruff_wasm_bg.wasm" with { type: "file" };
import { Biome } from "@biomejs/js-api/web";
import initBiome from "@biomejs/wasm-web";
import biomeWasm from "@biomejs/wasm-web/biome_wasm_bg.wasm" with { type: "file" };

declare const Bun: { file(path: string): { arrayBuffer(): Promise<ArrayBuffer> } };

let biomeReady: Promise<unknown> | undefined;
let ruffReady: Promise<unknown> | undefined;

export async function loadStandaloneBiome(): Promise<typeof Biome> {
  biomeReady ??= Bun.file(biomeWasm)
    .arrayBuffer()
    .then((bytes) => initBiome({ module_or_path: bytes }));
  await biomeReady;
  return Biome;
}

// Shaped like the module namespace loadRuffWasm() inspects, so both paths agree.
export async function loadStandaloneRuff(): Promise<{ Workspace: typeof Workspace }> {
  ruffReady ??= Bun.file(ruffWasm)
    .arrayBuffer()
    .then((bytes) => initRuff({ module_or_path: bytes }));
  await ruffReady;
  return { Workspace };
}
