import { i as EmissionShape, p as SystemDef, k as ColorNodeFn } from '../system-07-8mpfS.js';
import * as THREE from 'three';
import { NodeMaterial } from 'three/webgpu';
import 'three/src/nodes/core/Node.js';
import 'three/src/nodes/accessors/TextureNode.js';
import 'three/src/nodes/gpgpu/ComputeNode.js';
import 'three/src/nodes/accessors/StorageBufferNode.js';
import 'three/src/nodes/core/UniformNode.js';

/**
 * Node-spec catalog — one entry per plume module exposed in the editor.
 *
 * Each spec describes:
 *   - `category`: which stage of the particle lifecycle the node lives in. Determines
 *     visual grouping in the palette AND ordering during graph compilation: a system's
 *     emitter applies all `spawn` nodes, then `init`, then `update`, then `render`.
 *   - `label`: human display name on the canvas.
 *   - `accent`: tint for the node body so categories read at a glance.
 *   - `fields`: the parameter set surfaced in the inspector. Each field has a kind
 *     (number / range / vec3 / color / select) plus default value(s).
 *   - `defaults`: the initial `params` object stored on a graph node when it's created.
 *
 * The compiler in `compile.ts` reads the same structure to instantiate plume modules.
 */

type Category = "emitter" | "spawn" | "init" | "update" | "render";
/** A keyframe in a 1D curve param (stored as plain JSON for trivial persistence). */
interface CurveKey {
    t: number;
    v: number;
}
/** A stop in a colour gradient param. RGBA in linear-ish [0..1+]. */
interface GradientStopJSON {
    t: number;
    color: [number, number, number, number];
}
/** An uploaded texture — stored as a data URL so the graph round-trips through
 *  JSON without losing the image. */
interface TextureRef {
    kind: "texture";
    dataUrl: string;
    /** User-visible filename ("particle.png"). Just metadata; not used at compile. */
    name: string;
}
/** Procedural geometry — a preset choice plus its dimensions. The compiler
 *  instantiates the matching `THREE.BufferGeometry` at compile time. */
type GeometryRef = {
    kind: "geometry";
    preset: "sphere";
    radius: number;
    widthSegments: number;
    heightSegments: number;
} | {
    kind: "geometry";
    preset: "box";
    width: number;
    height: number;
    depth: number;
} | {
    kind: "geometry";
    preset: "torus";
    radius: number;
    tube: number;
    radialSegments: number;
    tubularSegments: number;
} | {
    kind: "geometry";
    preset: "cone";
    radius: number;
    height: number;
    radialSegments: number;
} | {
    kind: "geometry";
    preset: "cylinder";
    radiusTop: number;
    radiusBottom: number;
    height: number;
    radialSegments: number;
} | {
    kind: "geometry";
    preset: "plane";
    width: number;
    height: number;
};
/** Signed-distance-function preset — chosen shape + parameters. The compiler
 *  builds the corresponding `sdfSphere` / `sdfBox` / `sdfPlane` SdfFn. */
type SdfRef = {
    kind: "sdf";
    preset: "sphere";
    center: [number, number, number];
    radius: number;
} | {
    kind: "sdf";
    preset: "box";
    center: [number, number, number];
    halfSize: [number, number, number];
} | {
    kind: "sdf";
    preset: "plane";
    point: [number, number, number];
    normal: [number, number, number];
};
/** Reference to another emitter node by id. Used by spawn.from_events. */
interface EmitterRef {
    kind: "emitter-ref";
    /** Graph-node id of the source emitter. The compiler maps this to the
     *  generated emitter name when registering the system. */
    nodeId: string | undefined;
}
/** Show a field in the inspector only while another select field has one of these values. */
interface FieldVisibility {
    showWhen?: {
        key: string;
        oneOf: string[];
    };
}
type Field = FieldVisibility & ({
    kind: "number";
    key: string;
    label: string;
    min?: number;
    max?: number;
    step?: number;
} | {
    kind: "range";
    key: string;
    label: string;
    min?: number;
    max?: number;
    step?: number;
} | {
    kind: "vec3";
    key: string;
    label: string;
    step?: number;
} | {
    kind: "color";
    key: string;
    label: string;
} | {
    kind: "select";
    key: string;
    label: string;
    options: string[];
} | {
    kind: "shape";
    key: string;
    label: string;
} | {
    kind: "curve";
    key: string;
    label: string;
} | {
    kind: "gradient";
    key: string;
    label: string;
} | {
    kind: "texture";
    key: string;
    label: string;
    optional?: boolean;
} | {
    kind: "geometry";
    key: string;
    label: string;
} | {
    kind: "sdf";
    key: string;
    label: string;
} | {
    kind: "emitter-ref";
    key: string;
    label: string;
} | {
    kind: "boolean";
    key: string;
    label: string;
});
/**
 * Parameter values stored on a graph node. Curve + gradient values carry a `kind`
 * tag so deserializers can distinguish them from EmissionShape (which also has a
 * `kind` field, but with disjoint string values).
 */
type ParamValue = number | boolean | [number, number] | [number, number, number] | string | EmissionShape | {
    kind: "curve1d";
    keys: CurveKey[];
} | {
    kind: "gradient";
    stops: GradientStopJSON[];
} | TextureRef | GeometryRef | SdfRef | EmitterRef;
type Params = Record<string, ParamValue>;
interface NodeSpec {
    type: string;
    category: Category;
    label: string;
    accent: string;
    fields: Field[];
    defaults: Params;
}
/**
 * Trapezoid alpha curve: 0 → 1 over the first `fadeIn` of life, 1 → 0 over the last
 * `fadeOut`. Overlapping fades collapse to a constant 1. This is the shape the old
 * two-number AlphaOverLife node produced.
 */
declare function fadeCurve(fadeIn: number, fadeOut: number): {
    kind: "curve1d";
    keys: CurveKey[];
};
/** Upgrade params saved by older editor versions to the current spec. */
declare function migrateParams(type: string, params: Params): Params;
declare const NODE_SPECS: NodeSpec[];
declare function getSpec(type: string): NodeSpec;
declare function specsByCategory(category: Category): NodeSpec[];

/**
 * Graph → SystemDef compiler.
 *
 * Each Emitter node roots its own BFS traversal of the user-drawn DAG. The compiler
 * walks every emitter independently, groups its reachable modules by category in
 * visit order, and emits one `.emitter("…", e => …)` call per Emitter node into a
 * single `SystemDef`. Modules reachable from multiple emitters are included in
 * each — that's intentional, since plume's API takes a fresh module instance per
 * emitter anyway.
 *
 * Validation rules:
 *   - At least one Emitter node required.
 *   - Each emitter must have exactly one reachable render module.
 *   - Disconnected modules (not reachable from any emitter) are silently skipped —
 *     they show up in the canvas but aren't compiled in. This makes "comment out by
 *     unwiring" a useful editor gesture.
 */

/** Minimal shape of a graph node we care about — matches @xyflow/svelte's `Node` shape. */
interface GraphNode {
    id: string;
    position: {
        x: number;
        y: number;
    };
    data: {
        type: string;
        params: Params;
    };
}
interface GraphEdge {
    id: string;
    source: string;
    target: string;
}
/** Optional runtime hooks the editor preview supplies. `update.depth_collision`
 *  needs both; if absent the module is silently skipped at compile time so the
 *  rest of the graph still previews. (Code-export emits the call regardless.) */
interface CompileContext {
    depthTexture?: THREE.Texture;
    camera?: THREE.Camera;
    /**
     * Preview only this emitter's chain (plus any emitter it spawns from via events).
     * Ignored when the id isn't an emitter in the graph.
     */
    soloEmitterId?: string;
    /**
     * The noise image `clouds` / `impact_cloud` sprites fall back to when their texture slot is
     * empty. Defaults to `DEFAULT_CLOUD_NOISE_URL`, where the editor serves it.
     */
    cloudNoiseUrl?: string;
    /** Name given to the built system. Defaults to "editor_graph". */
    systemName?: string;
    /**
     * Restart the whole system once its one-shot emitters have finished, so a preview keeps
     * replaying them. Defaults to true; turn it off for effects spawned in a game, where a
     * one-shot should play once and return to the pool.
     */
    replayOneShots?: boolean;
    /**
     * Start particles relative to where the system is spawned, whatever an InitPosition or
     * InitFromMesh node's "World space" box says. With the box off, particles are born at fixed
     * world coordinates — invisible in the editor preview, which plays at the origin, but a game
     * spawning the effect at a character's foot would see it appear at the world origin instead.
     */
    spawnRelative?: boolean;
}
interface CompileResult {
    def: SystemDef;
    /** Plain-text summary of what got compiled — surfaced in the editor status bar. */
    summary: string;
}
declare class CompileError extends Error {
}
declare function compileGraph(nodes: GraphNode[], edges?: GraphEdge[], context?: CompileContext): CompileResult;
/** AlphaOverLife keys, clamped to 0..1 unless the node's "Clamp values to 1" is off. */
declare function alphaCurveKeys(p: Params): CurveKey[];

/**
 * The Plume editor's saved-effect format, and the path from a saved file to a `SystemDef`.
 *
 * Apps load effect files the editor wrote (`parseGraphDocument`) and build them with
 * `compileGraphDocument` — the same compiler the editor preview uses, so an effect plays in
 * the game exactly as it did in the editor.
 */

declare const GRAPH_FORMAT_VERSION = 1;
interface GraphDocument {
    version: number;
    /** Effect name; matches the file name (without `.json`) it was saved as. */
    name?: string;
    nodes: Array<{
        id: string;
        type: string;
        position: {
            x: number;
            y: number;
        };
        params: Params;
    }>;
    edges: Array<{
        id: string;
        source: string;
        target: string;
    }>;
}
/**
 * Validate a saved effect and bring its params up to date with the current node catalog.
 * Throws with a readable message on malformed input or an unknown node type.
 */
declare function parseGraphDocument(raw: unknown): GraphDocument;
/** Build a parsed effect. Call once per spawned instance — each build gets fresh GPU state. */
declare function compileGraphDocument(doc: GraphDocument, context?: CompileContext): CompileResult;

/**
 * Built-in shader presets for sprite / ribbon / beam / mesh renderers.
 *
 * Without these the default sprite renderer draws hard-edged quads — every
 * particle reads as a "circle" or "square" with sharp corners. The presets
 * here apply per-fragment shaping (radial falloff, noise-driven alpha, magma
 * lava ramps for mesh) so out-of-the-box visuals look like real VFX instead
 * of programmer-art placeholders.
 */

type SpriteShader = "soft" | "hard" | "fire" | "smoke" | "spark" | "texture_additive" | "texture_luma_alpha" | "clouds" | "impact_cloud";
type MeshShader = "pbr" | "magma" | "emissive";
/**
 * Builds a sprite/ribbon/beam fragment shader. Returns `undefined` for "hard"
 * so the renderer falls back to its built-in solid-quad path; everything else
 * returns a `ColorNodeFn` that gets handed to the renderer's `colorNode` option.
 */
declare function buildSpriteColorNode(preset: SpriteShader): ColorNodeFn | undefined;
/**
 * Build the material a `render.mesh` node uses. "pbr" returns the standard
 * `MeshStandardNodeMaterial`; "magma" returns a custom unlit material with a
 * domain-warped noise field that animates over time (looks like flowing lava
 * and is the right choice for stars/suns/molten orbs); "emissive" is a pure
 * unlit colour for non-physical glowing shapes.
 */
declare function buildMeshMaterial(preset: MeshShader, color: [number, number, number], metalness: number, roughness: number): NodeMaterial;

/**
 * `clouds` / `impact_cloud` sprite presets — ports of the `Clouds` and `ImpactCloud`
 * materials in RailWords' SourceArt/VFX/Base_Materials.blend. The game runs its own copy at
 * RailWords/src/Vfx/shaders/cloudShaders.ts; keep the two in step.
 *
 * Four rotating samples of one Voronoi noise texture are multiplied and masked by a
 * spherical gradient (a ring for `impact_cloud`), shaded light blue → white, lifted toward
 * the top of the screen, and cut out with a hard alpha threshold.
 *
 * Particle alpha is the material's "Opacity Control" — drive it with AlphaOverLife to grow
 * and dissolve the cloud. For `impact_cloud` it also opens the cutout: alpha 0 is the
 * material's near-invisible rest state, alpha 1 its keyframed impact dip, so pulse the alpha
 * curve to flash it. Particle RGB multiplies the shaded colour, so ColorOverLife tints.
 * Use alpha blending.
 */

declare const CLOUD_NOISE_TEXTURE_KEY = "cloudNoise";
/** Where the Plume editor serves the bundled noise; apps override it with `cloudNoiseUrl`. */
declare const DEFAULT_CLOUD_NOISE_URL = "/textures/voronoi_08_512.png";
declare function getCloudNoiseTexture(url?: string): THREE.Texture;
declare function cloudsColorNode(): ColorNodeFn;
declare function impactCloudColorNode(): ColorNodeFn;

/**
 * Runtime cache: data-URL → THREE.Texture.
 *
 * The editor stores uploaded images as data URLs inside graph params (so saves
 * and localStorage round-trip cleanly). At compile time we need the materialised
 * `THREE.Texture` to hand into renderer modules — this module keeps that mapping
 * so identical data URLs are re-used between compiles instead of re-decoded.
 */

/**
 * Resolve a data URL (or any HTMLImage-loadable URL) into a THREE.Texture. The
 * texture is created synchronously and starts populating once the image decodes;
 * three.js's renderer will pick up the GPU upload via `texture.needsUpdate` set
 * inside the `onload` callback.
 */
declare function getTexture(dataUrl: string): THREE.Texture;

export { CLOUD_NOISE_TEXTURE_KEY, type Category, type CompileContext, CompileError, type CompileResult, type CurveKey, DEFAULT_CLOUD_NOISE_URL, type EmitterRef, type Field, type FieldVisibility, GRAPH_FORMAT_VERSION, type GeometryRef, type GradientStopJSON, type GraphDocument, type GraphEdge, type GraphNode, type MeshShader, NODE_SPECS, type NodeSpec, type ParamValue, type Params, type SdfRef, type SpriteShader, type TextureRef, alphaCurveKeys, buildMeshMaterial, buildSpriteColorNode, cloudsColorNode, compileGraph, compileGraphDocument, fadeCurve, getCloudNoiseTexture, getSpec, getTexture, impactCloudColorNode, migrateParams, parseGraphDocument, specsByCategory };
