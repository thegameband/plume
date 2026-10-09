/**
 * Which file the graph on screen belongs to, and whether it has unsaved changes.
 *
 * `dir` is relative to the dev server's file root (see `vite/fileApiPlugin.ts`). An
 * untitled graph (starter, preset, imported) has no `current` file; Save on it opens
 * Save As. Persisted next to the graph autosave so a reload still knows where to save.
 */

import { graphStore } from "./graph/graphStore.svelte.js";
import { serialize } from "./persistence.js";
import { fetchRoot } from "./fileApi.js";

export interface EffectFile {
  /** Effect name, also the file name without `.json`. */
  name: string;
  /** Folder relative to the file root, forward slashes, no trailing slash ("" = root). */
  dir: string;
}

const STORAGE_KEY = "plume-editor:file-v1";

interface Persisted {
  current?: EffectFile;
  savedSnapshot?: string;
  /** Folder of the last save or open; survives the graph being detached from its file. */
  lastDir?: string;
}

function load(): Persisted {
  if (typeof localStorage === "undefined") return {};
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}") as Persisted;
  } catch {
    return {};
  }
}

const persisted = load();

let current: EffectFile | undefined = $state(persisted.current);
// Serialized graph as of the last save/open; the graph is dirty when it no longer matches.
let savedSnapshot: string | undefined = $state(persisted.savedSnapshot);
let lastDir: string = $state(persisted.lastDir ?? persisted.current?.dir ?? "");
let root: { root: string; rootName: string } | undefined = $state(undefined);

function snapshot(): string {
  return JSON.stringify(serialize(graphStore.nodes, graphStore.edges));
}

function persist(): void {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({ current, savedSnapshot, lastDir } satisfies Persisted),
  );
}

export const fileStore = {
  get current(): EffectFile | undefined {
    return current;
  },
  get dirty(): boolean {
    return current === undefined || snapshot() !== savedSnapshot;
  },
  /** Where Save As / Open start browsing: the folder last saved to or opened from. */
  get lastDir(): string {
    return lastDir;
  },
  /** Absolute file root on disk and its folder name, once the dev server has answered. */
  get root(): { root: string; rootName: string } | undefined {
    return root;
  },
};

/** Path of a file relative to the root, e.g. `RailWords/public/vfx/clouds.json`. */
export function filePath(file: EffectFile): string {
  return file.dir ? `${file.dir}/${file.name}.json` : `${file.name}.json`;
}

/** Mark the graph on screen as belonging to `file` and matching what's on disk. */
export function setCurrentFile(file: EffectFile): void {
  current = file;
  savedSnapshot = snapshot();
  lastDir = file.dir;
  persist();
}

/** Detach the graph from any file (presets, Reset, Import). */
export function clearCurrentFile(): void {
  current = undefined;
  savedSnapshot = undefined;
  persist();
}

void fetchRoot()
  .then((r) => (root = r))
  .catch((err: unknown) => console.warn("[plume-editor] file API unavailable:", err));
