/**
 * `three-plume/graph` — the node graph the Plume editor authors, its compiler, and loading of
 * saved effect files. Kept out of the main entry so apps that build systems in code don't
 * carry the node catalog.
 */

export * from "./nodes.js";
export {
  compileGraph,
  alphaCurveKeys,
  CompileError,
  type GraphNode,
  type GraphEdge,
  type CompileContext,
  type CompileResult,
} from "./compile.js";
export {
  parseGraphDocument,
  compileGraphDocument,
  GRAPH_FORMAT_VERSION,
  type GraphDocument,
} from "./document.js";
export {
  buildSpriteColorNode,
  buildMeshMaterial,
  type SpriteShader,
  type MeshShader,
} from "./shaders.js";
export {
  cloudsColorNode,
  impactCloudColorNode,
  getCloudNoiseTexture,
  CLOUD_NOISE_TEXTURE_KEY,
  DEFAULT_CLOUD_NOISE_URL,
} from "./cloudShaders.js";
export { getTexture } from "./textures.js";
