/**
 * Graph serialization + persistence.
 *
 * Round-trips the editor's current graph (nodes + edges) through JSON. Used for
 * `localStorage` autosave/restore and for Save / Save As / Open / Import in the
 * header. Format is versioned so we can migrate later without trashing existing
 * user work.
 *
 * Only data essential to rebuilding the graph is preserved: node id / type /
 * position / params, edge id / source / target. Visual styling (accent stripes,
 * edge stroke colour) is re-derived on load from the spec catalog.
 */

import type { Edge } from "@xyflow/svelte";
import { GRAPH_FORMAT_VERSION, parseGraphDocument, type GraphDocument } from "three-plume/graph";
import type { PlumeNode } from "./graph/graphStore.svelte.js";

export const STORAGE_KEY = "plume-editor:graph-v1";

export type SerializedGraph = GraphDocument;

export function serialize(nodes: PlumeNode[], edges: Edge[], name?: string): SerializedGraph {
  return {
    version: GRAPH_FORMAT_VERSION,
    ...(name ? { name } : {}),
    nodes: nodes.map((n) => ({
      id: n.id,
      type: n.data.type,
      position: { x: n.position.x, y: n.position.y },
      params: n.data.params,
    })),
    edges: edges.map((e) => ({ id: e.id, source: e.source, target: e.target })),
  };
}

/** Parse and validate a saved graph. Throws on malformed input — the caller is
 *  expected to surface the message to the user. */
export function deserialize(raw: unknown): { nodes: PlumeNode[]; edges: Edge[]; name?: string } {
  const doc = parseGraphDocument(raw);
  const nodes: PlumeNode[] = doc.nodes.map((n) => ({
    id: n.id,
    type: "plume",
    position: n.position,
    data: { type: n.type, params: n.params },
  }));
  const edges: Edge[] = doc.edges.map((e) => ({
    ...e,
    style: "stroke:#3a72ad;stroke-width:1.5;",
  }));
  return { nodes, edges, name: doc.name };
}

// ─ localStorage helpers ────────────────────────────────────────────────────

export function loadFromStorage(): { nodes: PlumeNode[]; edges: Edge[] } | undefined {
  if (typeof localStorage === "undefined") return undefined;
  const json = localStorage.getItem(STORAGE_KEY);
  if (!json) return undefined;
  try {
    return deserialize(JSON.parse(json));
  } catch (err) {
    console.warn("[plume-editor] failed to restore graph from localStorage:", err);
    return undefined;
  }
}

export function saveToStorage(nodes: PlumeNode[], edges: Edge[]): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(serialize(nodes, edges)));
  } catch (err) {
    // Quota errors are the realistic failure; log but don't break the editor.
    console.warn("[plume-editor] autosave failed:", err);
  }
}

export function clearStorage(): void {
  if (typeof localStorage === "undefined") return;
  localStorage.removeItem(STORAGE_KEY);
}

// ─ File import ─────────────────────────────────────────────────────────────

/** Open a file picker and resolve with the parsed graph. Resolves undefined if
 *  the user cancels. */
export function pickGraphFile(): Promise<{ nodes: PlumeNode[]; edges: Edge[] } | undefined> {
  return new Promise((resolve, reject) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "application/json,.json";
    input.onchange = async (): Promise<void> => {
      const file = input.files?.[0];
      if (!file) {
        resolve(undefined);
        return;
      }
      try {
        const text = await file.text();
        resolve(deserialize(JSON.parse(text)));
      } catch (err) {
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    };
    input.click();
  });
}
