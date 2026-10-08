<script lang="ts">
  import GraphCanvas from "./lib/graph/GraphCanvas.svelte";
  import Palette from "./lib/graph/Palette.svelte";
  import Inspector from "./lib/graph/Inspector.svelte";
  import PreviewPane from "./lib/preview/PreviewPane.svelte";
  import CodeExportModal from "./lib/CodeExportModal.svelte";
  import FileDialog from "./lib/FileDialog.svelte";
  import { editorStore } from "./lib/state.svelte.js";
  import { graphStore, replaceGraph, resetToStarter } from "./lib/graph/graphStore.svelte.js";
  import { deserialize, pickGraphFile, serialize } from "./lib/persistence.js";
  import {
    clearCurrentFile,
    fileStore,
    filePath,
    setCurrentFile,
    type EffectFile,
  } from "./lib/file.svelte.js";
  import { FileExistsError, loadJson, saveJson } from "./lib/fileApi.js";
  // Importing for the side effect: registers the global history snapshotter.
  import { undo, redo } from "./lib/graph/history.svelte.js";
  import { PRESETS } from "./lib/presets/gallery.js";

  let exportOpen = $state(false);

  // Preview column width, dragged from its left border; double-click resets.
  const PREVIEW_WIDTH_KEY = "plume-editor:preview-width";
  const DEFAULT_PREVIEW_WIDTH = 480;
  const MIN_PREVIEW_WIDTH = 240;
  // Palette (200) + inspector (280) + a usable graph (300).
  const OTHER_COLUMNS_MIN = 780;
  let previewWidth = $state(clampPreviewWidth(Number(localStorage.getItem(PREVIEW_WIDTH_KEY)) || DEFAULT_PREVIEW_WIDTH));
  let resizingPreview = $state(false);

  function clampPreviewWidth(w: number): number {
    return Math.round(Math.max(MIN_PREVIEW_WIDTH, Math.min(w, window.innerWidth - OTHER_COLUMNS_MIN)));
  }

  function setPreviewWidth(w: number): void {
    previewWidth = clampPreviewWidth(w);
    localStorage.setItem(PREVIEW_WIDTH_KEY, String(previewWidth));
  }

  function onResizerDown(event: PointerEvent): void {
    event.preventDefault();
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    resizingPreview = true;
  }

  function onResizerMove(event: PointerEvent): void {
    if (resizingPreview) setPreviewWidth(window.innerWidth - event.clientX);
  }

  function onResizerUp(event: PointerEvent): void {
    (event.currentTarget as HTMLElement).releasePointerCapture(event.pointerId);
    resizingPreview = false;
  }
  let fileDialogOpen = $state(false);
  let fileDialogMode: "save" | "open" = $state("save");

  function loadPreset(idx: number): void {
    const preset = PRESETS[idx];
    if (!preset) return;
    const built = preset.build();
    replaceGraph(built.nodes, built.edges);
    clearCurrentFile();
    editorStore.statusText = `Preset: ${preset.name} — ${preset.description}`;
  }

  function onKeydown(event: KeyboardEvent): void {
    const mod = event.metaKey || event.ctrlKey;
    if (mod && (event.key === "s" || event.key === "S")) {
      event.preventDefault();
      if (event.shiftKey) openSaveAs();
      else void save();
      return;
    }
    // Don't intercept undo/redo while the user is typing into a field.
    const t = event.target as HTMLElement | null;
    if (
      t &&
      (t.tagName === "INPUT" ||
        t.tagName === "TEXTAREA" ||
        t.tagName === "SELECT" ||
        t.isContentEditable)
    ) {
      return;
    }
    if (!mod) return;
    if (event.key === "z" || event.key === "Z") {
      event.preventDefault();
      if (event.shiftKey) redo();
      else undo();
    } else if (event.key === "y") {
      event.preventDefault();
      redo();
    }
  }

  function restartGraph(): void {
    editorStore.restartTick++;
    editorStore.statusText = "Restarting…";
  }

  /** Returns false if the file exists and the user chose not to overwrite it. */
  async function writeFile(file: EffectFile, overwrite: boolean): Promise<boolean> {
    const json = serialize(graphStore.nodes, graphStore.edges, file.name);
    try {
      await saveJson(filePath(file), json, overwrite);
    } catch (err) {
      if (!(err instanceof FileExistsError)) throw err;
      if (!confirm(`${filePath(file)} already exists. Replace it?`)) return false;
      await saveJson(filePath(file), json, true);
    }
    setCurrentFile(file);
    editorStore.statusText = `Saved ${filePath(file)}`;
    return true;
  }

  async function save(): Promise<void> {
    const file = fileStore.current;
    if (!file) {
      openSaveAs();
      return;
    }
    try {
      await writeFile(file, true);
    } catch (err) {
      editorStore.statusText = `Save failed: ${err instanceof Error ? err.message : String(err)}`;
    }
  }

  function openSaveAs(): void {
    fileDialogMode = "save";
    fileDialogOpen = true;
  }

  function openOpen(): void {
    fileDialogMode = "open";
    fileDialogOpen = true;
  }

  async function onFileDialogConfirm(file: EffectFile): Promise<boolean> {
    if (fileDialogMode === "save") return writeFile(file, false);
    const result = deserialize(await loadJson(filePath(file)));
    replaceGraph(result.nodes, result.edges);
    setCurrentFile(file);
    editorStore.statusText = `Opened ${filePath(file)}`;
    return true;
  }

  async function importGraph(): Promise<void> {
    try {
      const result = await pickGraphFile();
      if (!result) return;
      replaceGraph(result.nodes, result.edges);
      clearCurrentFile();
      editorStore.statusText = `Imported ${result.nodes.length} nodes / ${result.edges.length} edges — Save As to give it a location`;
    } catch (err) {
      editorStore.statusText = `Import failed: ${err instanceof Error ? err.message : String(err)}`;
    }
  }

  function resetGraph(): void {
    if (!confirm("Reset to the starter graph? This clears the autosave.")) return;
    resetToStarter();
    clearCurrentFile();
    editorStore.statusText = "Reset to starter graph.";
  }
</script>

<svelte:window onkeydown={onKeydown} onresize={() => (previewWidth = clampPreviewWidth(previewWidth))} />

<div class="app">
  <header>
    <span class="logo">plume editor</span>
    <span class="status">{editorStore.statusText}</span>
    <label class="live">
      <input type="checkbox" bind:checked={editorStore.live} />
      Live
    </label>
    <select
      class="presets"
      value=""
      title="Load a preset graph"
      onchange={(e) => {
        const v = (e.currentTarget as HTMLSelectElement).value;
        (e.currentTarget as HTMLSelectElement).value = "";
        if (v !== "") loadPreset(+v);
      }}
    >
      <option value="">Presets…</option>
      {#each PRESETS as p, i (p.name)}
        <option value={i}>{p.name}</option>
      {/each}
    </select>
    <button class="ghost" onclick={resetGraph} title="Reset to starter graph">Reset</button>
    <button
      class="ghost"
      onclick={() => (exportOpen = true)}
      title="Export the current graph as TypeScript code">Export</button
    >
    <button class="ghost" onclick={openOpen} title="Open an effect file">Open</button>
    <button class="ghost" onclick={importGraph} title="Import a JSON file from anywhere on this computer (opens untitled)">Import</button>
    <button class="ghost" onclick={save} title="Save to the effect's current file (Ctrl+S)">Save</button>
    <button class="ghost" onclick={openSaveAs} title="Save under a new name or location (Ctrl+Shift+S)">Save As</button>
    <button onclick={restartGraph} title="Rebuild the effect and restart the preview">Restart</button>
  </header>

  <main class:resizing={resizingPreview} style:grid-template-columns="200px 1fr 280px {previewWidth}px">
    <section class="palette">
      <Palette />
    </section>
    <section class="graph">
      <GraphCanvas />
    </section>
    <section class="inspector">
      <Inspector />
    </section>
    <section class="preview">
      <PreviewPane restartTick={editorStore.restartTick} />
      <div
        class="preview-resizer"
        class:active={resizingPreview}
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize preview"
        title="Drag to resize the preview (double-click to reset)"
        onpointerdown={onResizerDown}
        onpointermove={onResizerMove}
        onpointerup={onResizerUp}
        ondblclick={() => setPreviewWidth(DEFAULT_PREVIEW_WIDTH)}
      ></div>
    </section>
  </main>

  <CodeExportModal bind:open={exportOpen} />
  <FileDialog
    bind:open={fileDialogOpen}
    mode={fileDialogMode}
    startDir={fileStore.current?.dir ?? ""}
    startName={fileDialogMode === "save" ? (fileStore.current?.name ?? "") : ""}
    onconfirm={onFileDialogConfirm}
  />
</div>

<style>
  .app {
    display: grid;
    grid-template-rows: auto 1fr;
    height: 100vh;
    width: 100vw;
  }
  header {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 8px 16px;
    background: #14161b;
    border-bottom: 1px solid #2a2c33;
  }
  .logo {
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: #9ae6b4;
  }
  .status {
    flex: 1;
    color: #888;
    font-size: 13px;
  }
  .live {
    display: flex;
    align-items: center;
    gap: 6px;
    color: #cdd2da;
    font-size: 13px;
    user-select: none;
    cursor: pointer;
  }
  .live input {
    accent-color: #9ae6b4;
  }
  button {
    background: #2c5b8c;
    color: #fff;
    border: none;
    padding: 6px 14px;
    border-radius: 6px;
    cursor: pointer;
    font: inherit;
  }
  button:hover {
    background: #3a72ad;
  }
  button.ghost {
    background: transparent;
    color: #cdd2da;
    border: 1px solid #2a2c33;
    padding: 5px 12px;
  }
  button.ghost:hover {
    background: #1c1f26;
    border-color: #3a3d44;
  }
  .presets {
    background: #1c1f26;
    color: #cdd2da;
    border: 1px solid #2a2c33;
    border-radius: 6px;
    padding: 5px 8px;
    font: inherit;
    cursor: pointer;
  }
  .presets:hover {
    background: #242832;
    border-color: #3a3d44;
  }
  main {
    display: grid;
    overflow: hidden;
  }
  main.resizing {
    cursor: col-resize;
    user-select: none;
  }
  .preview-resizer {
    position: absolute;
    top: 0;
    bottom: 0;
    left: 0;
    width: 6px;
    z-index: 10;
    cursor: col-resize;
    border-left: 1px solid #2a2c33;
    touch-action: none;
  }
  .preview-resizer:hover,
  .preview-resizer.active {
    border-left: 2px solid #3a72ad;
    background: rgba(58, 114, 173, 0.15);
  }
  .palette,
  .graph,
  .inspector,
  .preview {
    overflow: hidden;
    position: relative;
  }
  .graph {
    border-right: 1px solid #2a2c33;
  }
</style>
