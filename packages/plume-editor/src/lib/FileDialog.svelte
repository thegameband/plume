<script lang="ts">
  /**
   * Save As / Open dialog. Browses folders through the dev-server file API, so every
   * location is relative to its root. `onconfirm` returns false to keep the dialog open
   * (e.g. the user declined to overwrite).
   */
  import { untrack } from "svelte";
  import { listDir, makeDir, type DirListing } from "./fileApi.js";
  import type { EffectFile } from "./file.svelte.js";

  let {
    open = $bindable(false),
    mode,
    startDir = "",
    startName = "",
    onconfirm,
  }: {
    open?: boolean;
    mode: "save" | "open";
    startDir?: string;
    startName?: string;
    onconfirm: (file: EffectFile) => Promise<boolean | void>;
  } = $props();

  const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9 _.-]*$/;

  let dir = $state("");
  let name = $state("");
  let listing: DirListing | undefined = $state(undefined);
  let error = $state("");
  let busy = $state(false);
  let nameInput: HTMLInputElement | undefined = $state(undefined);

  const crumbs = $derived(dir ? dir.split("/") : []);
  const cleanName = $derived(name.trim().replace(/\.json$/i, ""));
  const nameOk = $derived(NAME_RE.test(cleanName));

  $effect(() => {
    if (!open) return;
    untrack(() => {
      dir = startDir;
      name = startName;
      error = "";
      void browse(startDir, true);
    });
  });

  async function browse(target: string, fallBackToRoot = false): Promise<void> {
    try {
      listing = await listDir(target);
      dir = listing.dir;
      error = "";
    } catch (err) {
      if (fallBackToRoot && target !== "") return browse("");
      error = err instanceof Error ? err.message : String(err);
    }
    queueMicrotask(() => nameInput?.focus());
  }

  function join(...parts: string[]): string {
    return parts.filter(Boolean).join("/");
  }

  async function newFolder(): Promise<void> {
    const folder = prompt("New folder name:")?.trim();
    if (!folder) return;
    if (!NAME_RE.test(folder)) {
      error = "Folder names can use letters, numbers, spaces, dots, dashes and underscores.";
      return;
    }
    try {
      await makeDir(join(dir, folder));
      await browse(join(dir, folder));
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }
  }

  async function confirm(): Promise<void> {
    if (!nameOk || busy) return;
    busy = true;
    error = "";
    try {
      const keepOpen = (await onconfirm({ name: cleanName, dir })) === false;
      if (!keepOpen) open = false;
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      busy = false;
    }
  }

  function close(): void {
    open = false;
  }

  function onKeydown(event: KeyboardEvent): void {
    if (!open) return;
    if (event.key === "Escape") close();
  }
</script>

<svelte:window onkeydown={onKeydown} />

{#if open}
  <div
    class="backdrop"
    role="dialog"
    aria-modal="true"
    aria-label={mode === "save" ? "Save effect as" : "Open effect"}
    tabindex="-1"
    onclick={(e) => {
      if (e.target === e.currentTarget) close();
    }}
    onkeydown={(e) => {
      if (e.key === "Escape") close();
    }}
  >
    <div class="modal">
      <header>
        <h2>{mode === "save" ? "Save effect as" : "Open effect"}</h2>
        <button class="close" type="button" onclick={close} aria-label="Close">×</button>
      </header>

      <nav class="crumbs">
        <button type="button" class="crumb" onclick={() => browse("")}>{listing?.rootName ?? "root"}</button>
        {#each crumbs as crumb, i (i)}
          <span class="sep">/</span>
          <button type="button" class="crumb" onclick={() => browse(crumbs.slice(0, i + 1).join("/"))}>{crumb}</button>
        {/each}
        <span class="spacer"></span>
        {#if mode === "save"}
          <button type="button" class="ghost" onclick={newFolder}>New folder</button>
        {/if}
      </nav>

      <ul class="entries">
        {#if dir}
          <li>
            <button type="button" class="entry folder" onclick={() => browse(crumbs.slice(0, -1).join("/"))}>..</button>
          </li>
        {/if}
        {#each listing?.folders ?? [] as folder (folder)}
          <li>
            <button type="button" class="entry folder" onclick={() => browse(join(dir, folder))}>{folder}/</button>
          </li>
        {/each}
        {#each listing?.files ?? [] as file (file)}
          <li>
            <button
              type="button"
              class="entry file"
              class:selected={file.replace(/\.json$/i, "") === cleanName}
              onclick={() => (name = file.replace(/\.json$/i, ""))}
              ondblclick={() => {
                name = file.replace(/\.json$/i, "");
                void confirm();
              }}>{file}</button
            >
          </li>
        {/each}
        {#if listing && listing.folders.length === 0 && listing.files.length === 0}
          <li class="empty">Empty folder</li>
        {/if}
      </ul>

      <footer>
        <label class="name">
          Name
          <input
            bind:this={nameInput}
            bind:value={name}
            placeholder="my_effect"
            onkeydown={(e) => {
              if (e.key === "Enter") void confirm();
            }}
          />
          <span class="ext">.json</span>
        </label>
        <button type="button" class="ghost" onclick={close}>Cancel</button>
        <button type="button" class="primary" disabled={!nameOk || busy} onclick={confirm}>
          {mode === "save" ? "Save" : "Open"}
        </button>
      </footer>
      {#if error}
        <p class="error">{error}</p>
      {:else if name.trim() && !nameOk}
        <p class="error">Names can use letters, numbers, spaces, dots, dashes and underscores.</p>
      {/if}
    </div>
  </div>
{/if}

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.55);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 50;
    padding: 24px;
  }
  .modal {
    width: min(620px, 100%);
    max-height: 80vh;
    background: #14161b;
    border: 1px solid #2a2c33;
    border-radius: 8px;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    box-shadow: 0 12px 40px rgba(0, 0, 0, 0.5);
    color: #cdd2da;
    font-size: 13px;
  }
  header {
    display: flex;
    align-items: center;
    padding: 10px 14px;
    border-bottom: 1px solid #2a2c33;
  }
  h2 {
    flex: 1;
    margin: 0;
    font-size: 14px;
    font-weight: 600;
  }
  .close {
    background: transparent;
    border: 1px solid #2a2c33;
    color: #aaa;
    width: 26px;
    height: 26px;
    border-radius: 4px;
    cursor: pointer;
    font-size: 18px;
    line-height: 1;
  }
  .close:hover {
    background: #1c1f26;
    color: #fff;
  }
  .crumbs {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 2px;
    padding: 8px 14px;
    border-bottom: 1px solid #2a2c33;
  }
  .crumb {
    background: transparent;
    border: none;
    color: #9ae6b4;
    padding: 2px 4px;
    border-radius: 3px;
    cursor: pointer;
    font: inherit;
  }
  .crumb:hover {
    background: #1c1f26;
  }
  .sep {
    color: #555;
  }
  .spacer {
    flex: 1;
  }
  .entries {
    flex: 1;
    min-height: 220px;
    margin: 0;
    padding: 6px;
    list-style: none;
    overflow: auto;
    background: #0e1116;
  }
  .entry {
    display: block;
    width: 100%;
    text-align: left;
    background: transparent;
    border: none;
    color: #cdd2da;
    padding: 4px 8px;
    border-radius: 4px;
    cursor: pointer;
    font: 12px/1.5 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  }
  .entry:hover {
    background: #1c1f26;
  }
  .entry.folder {
    color: #8fb8e6;
  }
  .entry.selected {
    background: #22324a;
  }
  .empty {
    padding: 4px 8px;
    color: #666;
    font-style: italic;
  }
  footer {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px 14px;
    border-top: 1px solid #2a2c33;
  }
  .name {
    flex: 1;
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .name input {
    flex: 1;
    padding: 5px 8px;
    border: 1px solid #2a2c33;
    border-radius: 4px;
    background: #0e1116;
    color: #e7e7e9;
    font: inherit;
  }
  .ext {
    color: #777;
  }
  .ghost {
    background: transparent;
    color: #cdd2da;
    border: 1px solid #2a2c33;
    padding: 5px 12px;
    border-radius: 6px;
    cursor: pointer;
    font: inherit;
  }
  .ghost:hover {
    background: #1c1f26;
  }
  .primary {
    background: #2c5b8c;
    color: #fff;
    border: none;
    padding: 6px 14px;
    border-radius: 6px;
    cursor: pointer;
    font: inherit;
  }
  .primary:hover:not(:disabled) {
    background: #3a72ad;
  }
  .primary:disabled {
    opacity: 0.5;
    cursor: default;
  }
  .error {
    margin: 0;
    padding: 0 14px 10px;
    color: #f28b82;
  }
</style>
