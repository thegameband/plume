import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { fileURLToPath, URL } from "node:url";
import { fileApiPlugin } from "./vite/fileApiPlugin.js";

// Save / Open can reach anything under this folder. Defaults to the folder that holds the
// plume repo, so sibling projects (e.g. RailWords) are in reach.
const fileRoot =
  process.env["PLUME_EDITOR_ROOT"] ?? fileURLToPath(new URL("../../..", import.meta.url));

export default defineConfig({
  plugins: [svelte(), fileApiPlugin(fileRoot)],
  resolve: {
    alias: [
      {
        find: /^three-plume\/graph$/,
        replacement: fileURLToPath(new URL("../plume/src/graph/index.ts", import.meta.url)),
      },
      {
        find: /^three-plume$/,
        replacement: fileURLToPath(new URL("../plume/src/index.ts", import.meta.url)),
      },
    ],
  },
  server: {
    port: 5174,
  },
});
