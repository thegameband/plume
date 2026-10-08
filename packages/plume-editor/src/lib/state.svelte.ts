/**
 * Global editor state, exposed as a Svelte 5 rune-backed object.
 *
 * Kept tiny on purpose: a counter the preview pane watches (Restart button), a status
 * string for the header, and a "live" toggle that turns on debounced auto-apply.
 */

interface EditorStore {
  /** Bumped each time the user clicks "Restart" in the header — preview pane reacts to it. */
  restartTick: number;
  /** Short message shown in the header. */
  statusText: string;
  /** When true, every graph mutation auto-recompiles + respawns after a short debounce. */
  live: boolean;
}

export const editorStore: EditorStore = $state({
  restartTick: 0,
  statusText: "drag wires between handles, edit params on the right, Restart to replay",
  live: true,
});
