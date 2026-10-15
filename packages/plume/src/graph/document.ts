/**
 * The Plume editor's saved-effect format, and the path from a saved file to a `SystemDef`.
 *
 * Apps load effect files the editor wrote (`parseGraphDocument`) and build them with
 * `compileGraphDocument` — the same compiler the editor preview uses, so an effect plays in
 * the game exactly as it did in the editor.
 */

import {
  compileGraph,
  type CompileContext,
  type CompileResult,
  type GraphEdge,
  type GraphNode,
} from "./compile.js";
import { getSpec, migrateParams, type Params } from "./nodes.js";

export const GRAPH_FORMAT_VERSION = 1;

export interface GraphDocument {
  version: number;
  /** Effect name; matches the file name (without `.json`) it was saved as. */
  name?: string;
  nodes: Array<{
    id: string;
    type: string;
    position: { x: number; y: number };
    params: Params;
  }>;
  edges: Array<{ id: string; source: string; target: string }>;
}

/**
 * Validate a saved effect and bring its params up to date with the current node catalog.
 * Throws with a readable message on malformed input or an unknown node type.
 */
export function parseGraphDocument(raw: unknown): GraphDocument {
  if (!raw || typeof raw !== "object") throw new Error("Not a graph file.");
  const obj = raw as Partial<GraphDocument>;
  if (obj.version !== GRAPH_FORMAT_VERSION) {
    throw new Error(`Unsupported graph version ${obj.version} (expected ${GRAPH_FORMAT_VERSION}).`);
  }
  if (!Array.isArray(obj.nodes) || !Array.isArray(obj.edges)) {
    throw new Error("Graph missing nodes/edges arrays.");
  }

  const nodes = obj.nodes.map((node, idx) => {
    if (
      !node ||
      typeof node.id !== "string" ||
      typeof node.type !== "string" ||
      !node.position ||
      typeof node.position.x !== "number" ||
      typeof node.position.y !== "number"
    ) {
      throw new Error(`Node #${idx} is malformed.`);
    }
    getSpec(node.type);
    return {
      id: node.id,
      type: node.type,
      position: { x: node.position.x, y: node.position.y },
      params: migrateParams(node.type, (node.params ?? {}) as Params),
    };
  });

  const edges = obj.edges.map((edge, idx) => {
    if (
      !edge ||
      typeof edge.id !== "string" ||
      typeof edge.source !== "string" ||
      typeof edge.target !== "string"
    ) {
      throw new Error(`Edge #${idx} is malformed.`);
    }
    return { id: edge.id, source: edge.source, target: edge.target };
  });

  return {
    version: GRAPH_FORMAT_VERSION,
    ...(typeof obj.name === "string" ? { name: obj.name } : {}),
    nodes,
    edges,
  };
}

/** Build a parsed effect. Call once per spawned instance — each build gets fresh GPU state. */
export function compileGraphDocument(
  doc: GraphDocument,
  context: CompileContext = {},
): CompileResult {
  const nodes: GraphNode[] = doc.nodes.map((n) => ({
    id: n.id,
    position: n.position,
    data: { type: n.type, params: n.params },
  }));
  const edges: GraphEdge[] = doc.edges;
  return compileGraph(nodes, edges, { systemName: doc.name, ...context });
}
