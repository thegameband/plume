<script lang="ts">
  /**
   * Graph canvas — wraps `<SvelteFlow>` and binds it to `graphStore`. Registers our
   * single custom node type ("plume") so every module renders with the right accent
   * and label, and forwards click selection back into the store so the inspector
   * stays in sync.
   *
   * Edges are explicit in v1: users drag wires from a source handle to a target
   * handle, and the compiler walks the resulting DAG via BFS from the emitter.
   */
  import {
    SvelteFlow,
    Background,
    Controls,
    type Node,
    type Edge,
    type NodeTypes,
    type Connection,
  } from "@xyflow/svelte";
  import "@xyflow/svelte/dist/style.css";

  import PlumeNode from "./PlumeNode.svelte";
  import {
    graphStore,
    selectNode,
    addEdge,
    removeEdge,
    removeNode,
  } from "./graphStore.svelte.js";
  import { fileStore, filePath } from "../file.svelte.js";

  const location = $derived.by(() => {
    const file = fileStore.current;
    if (!file) return "not saved yet";
    const rootName = fileStore.root?.rootName;
    return [rootName, file.dir].filter(Boolean).join("/") + "/";
  });
  const fullPath = $derived(
    fileStore.current && fileStore.root ? `${fileStore.root.root}/${filePath(fileStore.current)}` : undefined,
  );

  // xyflow's `NodeTypes` map embeds `any` in its component-prop generics — that's their
  // public surface, not ours. Cast through `unknown` so we don't propagate the `any`
  // into our own code; the runtime shape is the same.
  const nodeTypes = { plume: PlumeNode } as unknown as NodeTypes;

  // Local bound copies for SvelteFlow's `bind:` machinery. Held as `$state.raw` so
  // xyflow's internal in-place tweaks don't trigger Svelte reactivity (it warns
  // explicitly about that — `warnIfDeeplyReactive`).
  let boundNodes: Node[] = $state.raw(graphStore.nodes as unknown as Node[]);
  let boundEdges: Edge[] = $state.raw(graphStore.edges);

  // Re-sync xyflow's internal copy when the palette adds/removes a node externally
  // (or when a new edge is drawn / deleted).
  $effect(() => {
    boundNodes = graphStore.nodes as unknown as Node[];
  });
  $effect(() => {
    boundEdges = graphStore.edges;
  });

  // Push xyflow's edits (drag, position changes) back into the store so the compiler
  // and inspector see the same data.
  $effect(() => {
    graphStore.nodes = boundNodes as unknown as typeof graphStore.nodes;
  });
  $effect(() => {
    graphStore.edges = boundEdges;
  });

  function onNodeClick(event: { node: { id: string } }): void {
    selectNode(event.node.id);
  }
  function onPaneClick(): void {
    selectNode(undefined);
  }

  function onConnect(connection: Connection): void {
    if (connection.source && connection.target) addEdge(connection.source, connection.target);
  }

  // Endpoint-drag rerouting: when the user grabs either end of an existing edge
  // and drops it on a different handle, xyflow fires `onreconnect` with the old
  // edge + the new connection. We map that to a remove+add in the store.
  function onReconnect(oldEdge: { id: string }, newConnection: Connection): void {
    if (!newConnection.source || !newConnection.target) return;
    removeEdge(oldEdge.id);
    addEdge(newConnection.source, newConnection.target);
  }

  // Keep the store in sync when xyflow deletes nodes/edges via keyboard (Delete key
  // or rubber-band selection). The event payload reports what was removed; we mirror
  // it back into the store.
  function onDelete(payload: { nodes: { id: string }[]; edges: { id: string }[] }): void {
    for (const e of payload.edges) removeEdge(e.id);
    for (const n of payload.nodes) removeNode(n.id);
  }
</script>

<div class="graph-canvas">
  <SvelteFlow
    bind:nodes={boundNodes}
    bind:edges={boundEdges}
    {nodeTypes}
    fitView
    proOptions={{ hideAttribution: true }}
    onnodeclick={onNodeClick}
    onpaneclick={onPaneClick}
    onconnect={onConnect}
    onreconnect={onReconnect}
    ondelete={onDelete}
  >
    <Background />
    <Controls />
  </SvelteFlow>
  <div class="file-label" title={fullPath}>
    <div class="file-name">
      {fileStore.current?.name ?? "Untitled"}{#if fileStore.dirty}<span class="dirty" title="Unsaved changes"> ●</span>{/if}
    </div>
    <div class="file-dir">{location}</div>
  </div>
</div>

<style>
  .graph-canvas {
    position: relative;
    width: 100%;
    height: 100%;
  }
  .file-label {
    position: absolute;
    top: 8px;
    left: 10px;
    z-index: 5;
    max-width: calc(100% - 20px);
    padding: 5px 10px;
    border-radius: 4px;
    background: rgba(17, 19, 26, 0.85);
    border: 1px solid #2a2c33;
  }
  .file-name {
    color: #e7e7e9;
    font-size: 13px;
    font-weight: 600;
  }
  .dirty {
    color: #f6c177;
  }
  .file-dir {
    color: #8a909c;
    font: 11px/1.4 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  :global(.svelte-flow) {
    background-color: #0e1116;
  }
  :global(.svelte-flow__background) {
    background-color: #0e1116;
  }
  :global(.svelte-flow__edge-path) {
    stroke: #3a72ad;
    stroke-width: 1.5;
  }
  /* !important: every edge carries an inline stroke style (see graphStore addEdge). */
  :global(.svelte-flow .svelte-flow__edge.selected .svelte-flow__edge-path) {
    stroke: #ffd84d !important;
    stroke-width: 3 !important;
    filter: drop-shadow(0 0 4px rgba(255, 216, 77, 0.8));
  }
  :global(.svelte-flow__connectionline) {
    stroke: #9ae6b4;
    stroke-width: 2;
  }
  :global(.svelte-flow__controls button) {
    background: #1c1f26;
    color: #e7e7e9;
    border-bottom: 1px solid #2a2c33;
  }
  :global(.svelte-flow__node) {
    /* Let our PlumeNode card take over background/border styling. */
    background: transparent;
    border: none;
    padding: 0;
  }
</style>
