import { defineConfig } from "tsup";

export default defineConfig({
  entry: { index: "src/index.ts", "graph/index": "src/graph/index.ts" },
  format: ["esm"],
  dts: true,
  sourcemap: true,
  clean: true,
  target: "es2022",
  // Explicit match for `three` + every subpath (`three/tsl`, `three/webgpu`,
  // `three/examples/jsm/**`, `three/src/nodes/**`). Without the regex, bare `"three"` only
  // matches the top-level module and deeper imports would silently get bundled.
  external: [/^three($|\/)/],
  treeshake: true,
  // Both entries share one copy of the core (module registry, classes) through a common chunk.
  splitting: true,
  minify: false,
});
