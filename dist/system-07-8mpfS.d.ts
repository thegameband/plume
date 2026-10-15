import * as THREE from 'three';
import Node from 'three/src/nodes/core/Node.js';
import TextureNode from 'three/src/nodes/accessors/TextureNode.js';
import ComputeNode from 'three/src/nodes/gpgpu/ComputeNode.js';
import { WebGPURenderer } from 'three/webgpu';
import StorageBufferNode from 'three/src/nodes/accessors/StorageBufferNode.js';
import UniformNode from 'three/src/nodes/core/UniformNode.js';

type Vec3Tuple = [number, number, number];
type Vec4Tuple = [number, number, number, number];
type ColorTuple = [number, number, number];
type ColorRGBATuple = [number, number, number, number];
/** Numeric input that may be a constant, a uniform range, or a value chosen from a list. */
type ScalarInput = {
    kind: "constant";
    value: number;
} | {
    kind: "range";
    min: number;
    max: number;
} | {
    kind: "list";
    values: number[];
};
type Vec3Input = {
    kind: "constant";
    value: Vec3Tuple;
} | {
    kind: "range";
    min: Vec3Tuple;
    max: Vec3Tuple;
};
type ColorInput = {
    kind: "constant";
    value: ColorTuple;
} | {
    kind: "range";
    min: ColorTuple;
    max: ColorTuple;
} | {
    kind: "list";
    values: ColorTuple[];
};
interface Disposable {
    dispose(): void;
}
interface WorldTransform {
    position: THREE.Vector3;
    quaternion: THREE.Quaternion;
    scale: THREE.Vector3;
}

/**
 * Mulberry32: small, fast, deterministic PRNG. Good enough for VFX.
 * Given the same seed, produces the same stream — required for reproducible effects.
 */
declare class RNG {
    private state;
    constructor(seed?: number);
    reseed(seed: number): void;
    /** Raw 32-bit unsigned integer from the stream. */
    u32(): number;
    /** Uniform float in [0, 1). */
    next(): number;
    /** Uniform float in [min, max). */
    range(min: number, max: number): number;
    /** Uniform integer in [min, max). */
    rangeInt(min: number, max: number): number;
    /** Uniform unit vector on sphere. */
    unitSphere(out: [number, number, number]): [number, number, number];
}
/** Process-global shared RNG. Modules can take an RNG instance to override. */
declare const sharedRNG: RNG;

/** Emission shape — determines how a position or direction is sampled for a new particle. */
type EmissionShape = {
    kind: "point";
} | {
    kind: "sphere";
    radius: number;
    thickness?: number;
} | {
    kind: "box";
    size: Vec3Tuple;
} | {
    kind: "cone";
    angle: number;
    radius?: number;
} | {
    kind: "ring";
    radius: number;
    thickness?: number;
} | {
    kind: "disc";
    radius: number;
    thickness?: number;
};
/** Sample a position from a shape into `out`. */
declare function samplePosition(shape: EmissionShape, rng: RNG, out: Vec3Tuple): Vec3Tuple;
/** Sample a unit direction from a shape into `out`. */
declare function sampleDirection(shape: EmissionShape, rng: RNG, out: Vec3Tuple): Vec3Tuple;

/**
 * GPU-owned particle storage, aggressively packed into 6 vec4 storage buffers so we can
 * afford additional bindings (e.g. event buffers) without exceeding WebGPU's 8-storage-buffer
 * per-stage limit. Layout:
 *
 *   posAlive.xyzw     = (position.x, position.y, position.z, alive)
 *   velAge.xyzw       = (velocity.x, velocity.y, velocity.z, age)
 *   color.rgba
 *   initialColor.rgba
 *   initVelSize.xyzw  = (initialVelocity.x, initialVelocity.y, initialVelocity.z, initialSize)
 *   traits.xyzw       = (size, rotation, angularVelocity, lifetime)
 *
 * Use the `attr` helpers below — they hide the packing so modules read/write via logical
 * attribute names. Per-component writes do read-modify-write on the owning vec4; per-vec3
 * writes (position/velocity/initialVelocity) rewrite xyz while preserving the packed w.
 */
interface ParticleStorage {
    posAlive: StorageBufferNode<"vec4">;
    velAge: StorageBufferNode<"vec4">;
    color: StorageBufferNode<"vec4">;
    initialColor: StorageBufferNode<"vec4">;
    initVelSize: StorageBufferNode<"vec4">;
    traits: StorageBufferNode<"vec4">;
}
declare class ParticleBuffer {
    readonly capacity: number;
    readonly storage: ParticleStorage;
    constructor(capacity: number);
}

/** JSON form of a serialized module. Includes `type` for registry lookup. */
interface ModuleJSON {
    type: string;
    id?: string;
    [key: string]: unknown;
}
/** Per-tick context passed to CPU-side emitter-spawn modules (SpawnRate, SpawnBurst). */
interface EmitterContext {
    rng: RNG;
    deltaTime: number;
    emitterTime: number;
    intensity: number;
}
/** TSL context for the spawn compute kernel — populated by the Emitter at kernel-build time. */
interface SpawnInitContext {
    storage: ParticleStorage;
    /** Int node: the slot index being initialized (0..capacity-1). */
    slot: Node<"int">;
    /** Float node: per-slot deterministic seed for RNG sampling. */
    seed: Node<"float">;
    /** mat4 uniform: emitter world transform. */
    worldMatrix: UniformNode<"mat4", THREE.Matrix4>;
    emitterTime: UniformNode<"float", number>;
    intensity: UniformNode<"float", number>;
}
/** TSL context for the update compute kernel. */
interface UpdateContext {
    storage: ParticleStorage;
    /** Int node: the instance being updated. */
    i: Node<"int">;
    dt: UniformNode<"float", number>;
    emitterTime: UniformNode<"float", number>;
    intensity: UniformNode<"float", number>;
    /** Emitter world transform — same uniform as the spawn kernel sees. */
    worldMatrix: UniformNode<"mat4", THREE.Matrix4>;
}
interface RenderContext {
    camera: THREE.Camera;
    worldMatrix: THREE.Matrix4;
    intensity: number;
}
type ModuleKind = "emitter_spawn" | "particle_spawn" | "particle_update" | "render";
interface ModuleBase {
    readonly kind: ModuleKind;
    readonly type: string;
    readonly id?: string;
    toJSON(): ModuleJSON;
}
/** CPU-side: decides how many particles to spawn this tick. */
interface EmitterSpawnModule extends ModuleBase {
    readonly kind: "emitter_spawn";
    requestSpawn(ctx: EmitterContext): number;
    reset?(): void;
}
/** TSL-emitting: contributes code to the spawn compute kernel that initializes a new particle. */
interface ParticleSpawnModule extends ModuleBase {
    readonly kind: "particle_spawn";
    contributeSpawnTSL(ctx: SpawnInitContext): void;
}
/** TSL-emitting: contributes code to the update compute kernel run per live particle each frame. */
interface ParticleUpdateModule extends ModuleBase {
    readonly kind: "particle_update";
    contributeUpdateTSL(ctx: UpdateContext): void;
    /**
     * Also run `contributeUpdateTSL` in the spawn kernel, right after the init modules. A
     * particle spawned this frame is drawn before the update kernel ever sees it, so without
     * this it renders one frame with its raw init values (e.g. full alpha before AlphaOverLife
     * fades it in). Only set this on modules that are a pure function of the particle's state
     * and age — anything that integrates `dt` would be applied twice.
     */
    readonly applyOnSpawn?: boolean;
    /**
     * Optional per-frame hook fired by the Emitter before its update kernel dispatches.
     * Modules that need per-frame uniform updates (e.g. camera matrices for depth-buffer
     * collision) implement this to sync CPU state → GPU uniform. `camera` is the camera the
     * Manager is rendering with, or `undefined` if none was supplied to the tick.
     */
    beforeUpdate?(dt: number, camera?: THREE.Camera): void;
}
/**
 * Options passed to `RenderModule.init` by the Emitter. Lets the renderer opt into
 * Emitter-owned auxiliary buffers when they exist.
 */
interface RenderInitOptions {
    /**
     * If the Emitter has `sortByDepth` enabled, this is a storage buffer of uint indices
     * [0, capacity) sorted back-to-front by view-space depth each frame. Sort-aware renderers
     * (SpriteRenderer) map `instanceIndex → sortIndices[instanceIndex]` to read particles in
     * depth-correct draw order.
     */
    sortIndices?: StorageBufferNode<"uint">;
}
/** Owns a Three.js Object3D that renders particles by reading the ParticleStorage. */
interface RenderModule extends ModuleBase {
    readonly kind: "render";
    readonly object3D: THREE.Object3D;
    init?(storage: ParticleStorage, capacity: number, opts?: RenderInitOptions): void;
    reset?(): void;
    updateRender(liveCount: number, ctx: RenderContext): void;
    setFollowPosition?(position: THREE.Vector3, hasFollow: boolean): void;
    /**
     * Optional compute dispatch called by the Emitter after its main update + spawn kernels.
     * Used by renderers that need per-frame compute work — e.g., `RibbonRenderer` captures each
     * alive particle's current position into a per-slot history buffer.
     */
    postUpdate?(renderer: WebGPURenderer, liveCount: number, deltaTime: number, emitterTime: number): void;
    dispose(): void;
}
type Module = EmitterSpawnModule | ParticleSpawnModule | ParticleUpdateModule | RenderModule;
interface ModuleFactory {
    readonly type: string;
    fromJSON(data: ModuleJSON): Module;
}

interface EmitterEventConfig {
    /** Emit an event each time a particle dies (age reaches lifetime). */
    onDeath?: boolean;
    /** Max events per frame. Default 256. */
    capacity?: number;
}
interface EmitterDef {
    name?: string;
    capacity: number;
    spawn: EmitterSpawnModule[];
    init: ParticleSpawnModule[];
    update: ParticleUpdateModule[];
    render: RenderModule;
    /** Optional event output configuration. Allocates an event buffer this emitter writes to. */
    events?: EmitterEventConfig;
    /**
     * If true, allocates sort-index storage and runs a bitonic GPU sort each frame, producing
     * back-to-front depth ordering for the renderer. Enable for alpha-blended emitters where
     * draw order matters. Adds ~log²(capacity)/2 compute dispatches per frame (~55 for N=1024).
     */
    sortByDepth?: boolean;
    seed?: number;
    duration?: number;
    loop?: boolean;
}
/**
 * A single particle-pipeline instance, backed entirely by GPU compute.
 *
 * When `events.onDeath` is set, the Emitter allocates an event buffer + atomic counter.
 * In the update kernel's kill branch, the dying particle's position is atomically appended.
 * Other emitters can consume these events via the `SpawnFromEvents` spawn module to trigger
 * chained effects (fireworks, explosions, debris, compound VFX).
 */
declare class Emitter {
    readonly name?: string;
    readonly buffer: ParticleBuffer;
    readonly spawn: EmitterSpawnModule[];
    readonly init: ParticleSpawnModule[];
    readonly update: ParticleUpdateModule[];
    readonly render: RenderModule;
    readonly rng: RNG;
    readonly duration?: number;
    loop: boolean;
    readonly uDt: UniformNode<"float", number>;
    readonly uEmitterTime: UniformNode<"float", number>;
    readonly uIntensity: UniformNode<"float", number>;
    readonly uWorldMatrix: UniformNode<"mat4", THREE.Matrix4>;
    readonly uSpawnCount: UniformNode<"float", number>;
    readonly uSpawnBase: UniformNode<"float", number>;
    readonly uSeedBase: UniformNode<"float", number>;
    readonly eventCapacity: number;
    readonly eventBuffer?: StorageBufferNode<"vec4">;
    readonly eventCounter?: StorageBufferNode<"uint">;
    private _writeDeathEvents;
    private _resetEventKernel?;
    private _eventSource?;
    private _eventPerTrigger;
    private _sortEnabled;
    private _sortIndices?;
    private _sortKeys?;
    private _sortKeyKernel?;
    private _sortEngine?;
    private _uCameraView?;
    private _emitterTime;
    private _playing;
    private _spawning;
    private _ringHead;
    private _aliveHighWater;
    private _seeded;
    private readonly _initialSeed;
    private readonly _retireTailSeconds;
    private _spawnKernel;
    private _updateKernel;
    constructor(def: EmitterDef);
    /**
     * Re-resolves cross-emitter event-source references and rebuilds the spawn kernel
     * if any deferred name (string source for `SpawnFromEvents`) was resolved after
     * construction. Called by `System` once every emitter has been built and
     * `resolveSource()` has run on each spawn module. No-op when sources were already
     * supplied as direct `Emitter` instances.
     */
    finalizeWiring(): void;
    setFollowPosition(position: THREE.Vector3, hasFollow: boolean): void;
    /**
     * Number of live particles, read back from the GPU. Async with a frame or two of latency
     * and a copy of up to `capacity * 16` bytes, so poll it a few times a second (debug HUDs,
     * editors) rather than every frame.
     */
    countAlive(renderer: WebGPURenderer): Promise<number>;
    play(): void;
    stopSpawning(): void;
    hardStop(): void;
    isAlive(): boolean;
    /**
     * Pre-compile all compute kernels for this emitter. Dispatches each kernel once against
     * the (currently all-dead) particle storage — the work is harmless but forces the WebGPU
     * backend to translate WGSL → MSL/HLSL and build pipelines.
     *
     * Call once per prefab via `Manager.preload()` (or ambiently on first use). Without this,
     * the first real use of an Emitter pays the full shader-compilation cost up front —
     * typically frames-to-seconds depending on kernel complexity (bitonic sort especially).
     */
    warmup(renderer: WebGPURenderer): Promise<void>;
    tick(renderer: WebGPURenderer, deltaTime: number, worldMatrix: THREE.Matrix4, intensity: number, camera?: THREE.Camera, 
    /**
     * Optional shared compute batch. When provided, this emitter's frame kernels (reset/update
     * /spawn) are pushed into it instead of dispatched immediately — the caller (Manager) is
     * responsible for `renderer.computeAsync(batch)` at the end of the tick. This cuts per-frame
     * command-buffer submits from O(emitters) down to 1 when ticking many systems.
     *
     * postUpdate (ribbon/light-emission) and sort dispatches stay out-of-batch because they
     * depend on conditional internal state the outer caller can't observe.
     */
    batch?: ComputeNode[]): void;
    syncRender(ctx: RenderContext): void;
    dispose(): void;
    private _dispatchSort;
    /**
     * Build the compute kernel that packs per-slot depth + slot-index into a single uint32
     * and writes it into `_sortKeys`. After this kernel runs, `BitonicSort.compute()` sorts
     * the buffer ascending — the lower `SLOT_BITS` bits of each sorted element then name the
     * particle slot that should draw at that position.
     */
    private _buildSortKeyKernel;
    private _buildResetEventKernel;
    private _buildSpawnKernel;
    private _buildUpdateKernel;
}

/**
 * Shared types + helpers for renderer-level shading hooks (R16).
 *
 * Every visible particle renderer in plume — SpriteRenderer, RibbonRenderer, BeamRenderer —
 * accepts a `colorNode` callback that replaces the default fragment color computation. The
 * callback receives a `ColorNodeContext` carrying:
 *   - already-loaded particle state (color, age, lifetime fraction, size, world position).
 *   - the geometry's `uv` node (semantics differ per renderer — see below).
 *   - a map of TSL `texture()` nodes built from the user-supplied texture inputs, ready to
 *     `.sample(uv)` directly.
 *   - emitter time, for scrolling / time-driven effects.
 *
 * UV conventions:
 *   - Sprite quads: standard 0..1 UV across the billboard quad.
 *   - Ribbon strips: u = 0..1 along ribbon length (0 = newest sample, 1 = oldest tail),
 *     v = 0..1 across the strip width.
 *   - Beam quads: u = 0..1 along the beam (0 = tail/spawn, 1 = head/current),
 *     v = 0..1 across the strip width.
 *
 * The `colorNode` returns a `Node<"vec4">` that becomes the fragment's RGBA. Particle
 * fade-in/out via `AlphaOverLife` etc. is already baked into `particle.color.a`, so the
 * common case is just `return tex.sample(uv).mul(particle.color);`.
 */

/** Per-fragment context passed into a renderer's `colorNode` hook. */
interface ColorNodeContext {
    /** Per-particle state already read from GPU storage. All values are TSL nodes. */
    particle: {
        /** Current RGBA, post-`ColorOverLife` / `AlphaOverLife`. */
        color: Node<"vec4">;
        /** Current age in seconds. */
        age: Node<"float">;
        /** Current lifetime in seconds. Clamped to a small positive number to avoid /0. */
        lifetime: Node<"float">;
        /** `age / lifetime`, clamped to [0, 1]. The most useful "where am I in life" knob. */
        lifetimeT: Node<"float">;
        /** Current size (post-`SizeOverLife`). */
        size: Node<"float">;
        /** World-space position. */
        position: Node<"vec3">;
        /** 1.0 if alive, 0.0 if dead. */
        alive: Node<"float">;
    };
    /** Geometry UV — see header for per-renderer semantics. */
    uv: Node<"vec2">;
    /** Map of TSL texture nodes built from the renderer's `textures` input. Sample with `.sample(uv)`. */
    textures: Record<string, TextureNode>;
    /** Emitter time in seconds, for scrolling textures and time-driven shading. */
    time: Node<"float">;
}
/** Renderer-side `colorNode` callback signature. */
type ColorNodeFn = (ctx: ColorNodeContext) => Node<"vec4">;
/**
 * Inputs to a renderer's texture map. Accepts either a single texture (mapped to the key
 * `"base"`) for the common case, or a `Record<string, Texture>` for multi-texture materials.
 */
type TextureInput = THREE.Texture | Record<string, THREE.Texture>;
/** Normalize the loose `TextureInput` form into a stable `Record<string, Texture>`. */
declare function normalizeTextures(input: TextureInput | undefined): Record<string, THREE.Texture>;
/**
 * Helper for the common scrolling-texture pattern: returns `uv + speed * time`, with the
 * fractional part wrapped back into [0, 1) so the texture stays in its sampler's range.
 *
 * ```ts
 * colorNode: ({ textures, uv, time }) =>
 *   textures.base.sample(scrollUV(uv, vec2(0.5, 0), time)).mul(particle.color);
 * ```
 */
declare function scrollUV(uv: Node<"vec2">, speed: Node<"vec2">, time: Node<"float">): Node<"vec2">;

interface SystemDef {
    name?: string;
    emitters: EmitterDef[];
    /** Seconds of playback after which all emitters stop spawning. Undefined = indefinite. */
    duration?: number;
    loop?: boolean;
}
/** A composite VFX system — one or more Emitters bound to a common transform. */
declare class System {
    readonly name?: string;
    readonly emitters: Emitter[];
    readonly object3D: THREE.Group;
    readonly position: THREE.Vector3;
    readonly quaternion: THREE.Quaternion;
    readonly scale: THREE.Vector3;
    intensity: number;
    duration?: number;
    loop: boolean;
    private _systemTime;
    private _playing;
    private _worldMatrix;
    constructor(def: SystemDef);
    play(): void;
    /** Pre-compile all compute kernels for every emitter. See `Emitter.warmup`. */
    warmup(renderer: WebGPURenderer): Promise<void>;
    stopSpawning(): void;
    hardStop(): void;
    /** Emitter lifecycle: true while any emitter has live particles or is still spawning. */
    isAlive(): boolean;
    setIntensity(value: number): void;
    setFollowPosition(position: THREE.Vector3, hasFollow: boolean): void;
    /** Live particles across all emitters. See {@link Emitter.countAlive} for cost. */
    countAlive(renderer: WebGPURenderer): Promise<number>;
    /**
     * Update all emitters. Renderer is passed through for GPU compute dispatch.
     *
     * If `batch` is provided, emitter frame kernels are collected into it instead of being
     * dispatched inline — the Manager uses this to coalesce every active system's kernels
     * into a single `renderer.computeAsync([...])` call per tick, cutting per-frame command-
     * buffer submits from O(systems) down to O(1).
     */
    tick(renderer: WebGPURenderer, deltaTime: number, parentIntensity: number, camera?: THREE.Camera, batch?: ComputeNode[]): void;
    syncRender(camera: THREE.Camera, parentIntensity: number): void;
    dispose(): void;
}

export { scrollUV as A, sharedRNG as B, type ColorRGBATuple as C, type Disposable as D, type EmitterSpawnModule as E, type ModuleFactory as M, type ParticleSpawnModule as P, RNG as R, type ScalarInput as S, type TextureInput as T, type UpdateContext as U, type Vec3Input as V, type WorldTransform as W, type ColorInput as a, type ColorTuple as b, type Vec3Tuple as c, type ModuleJSON as d, type Module as e, type EmitterContext as f, Emitter as g, type SpawnInitContext as h, type EmissionShape as i, type ParticleUpdateModule as j, type ColorNodeFn as k, type RenderModule as l, type ParticleStorage as m, type RenderInitOptions as n, type RenderContext as o, type SystemDef as p, System as q, type EmitterEventConfig as r, type EmitterDef as s, type ColorNodeContext as t, type ModuleKind as u, ParticleBuffer as v, type Vec4Tuple as w, normalizeTextures as x, sampleDirection as y, samplePosition as z };
