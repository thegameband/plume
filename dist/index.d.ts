import { C as ColorRGBATuple, a as ColorInput, R as RNG, b as ColorTuple, S as ScalarInput, V as Vec3Input, c as Vec3Tuple, M as ModuleFactory, d as ModuleJSON, e as Module, E as EmitterSpawnModule, f as EmitterContext, g as Emitter, P as ParticleSpawnModule, h as SpawnInitContext, i as EmissionShape, j as ParticleUpdateModule, U as UpdateContext, T as TextureInput, k as ColorNodeFn, l as RenderModule, m as ParticleStorage, n as RenderInitOptions, o as RenderContext, p as SystemDef, q as System, r as EmitterEventConfig, s as EmitterDef } from './system-07-8mpfS.js';
export { t as ColorNodeContext, D as Disposable, u as ModuleKind, v as ParticleBuffer, w as Vec4Tuple, W as WorldTransform, x as normalizeTextures, y as sampleDirection, z as samplePosition, A as scrollUV, B as sharedRNG } from './system-07-8mpfS.js';
import * as THREE from 'three';
import Node from 'three/src/nodes/core/Node.js';
import NodeMaterial from 'three/src/materials/nodes/NodeMaterial.js';
import { WebGPURenderer } from 'three/webgpu';
import 'three/src/nodes/accessors/TextureNode.js';
import 'three/src/nodes/gpgpu/ComputeNode.js';
import 'three/src/nodes/accessors/StorageBufferNode.js';
import 'three/src/nodes/core/UniformNode.js';

/**
 * 1D scalar curve sampled by time in [0, 1].
 * Serialized as a sparse list of (time, value) keyframes; evaluated via linear interpolation.
 * Can be baked to a 1D DataTexture for GPU sampling in shaders (see `.getTexture()`).
 */
interface CurveKeyframe {
    t: number;
    v: number;
}
declare class Curve1D {
    readonly keyframes: CurveKeyframe[];
    constructor(keyframes: CurveKeyframe[]);
    static constant(value: number): Curve1D;
    static linear(from: number, to: number): Curve1D;
    sample(t: number): number;
    /** Bake to a Float32Array for GPU texture upload. */
    bake(samples?: number): Float32Array;
    toJSON(): {
        keyframes: CurveKeyframe[];
    };
    static fromJSON(data: {
        keyframes: CurveKeyframe[];
    }): Curve1D;
    /**
     * Lazily bake the curve to a 1×N R32F DataTexture for GPU sampling.
     * Cached per-instance; reused across kernel rebuilds.
     */
    private _texture?;
    getTexture(samples?: number): THREE.DataTexture;
}

interface GradientStop {
    t: number;
    color: ColorRGBATuple;
}
/**
 * RGBA color gradient, sampled by time in [0, 1]. Premultiplied-free linear interpolation.
 * Will bake to a 1D RGBA texture for GPU.
 */
declare class Gradient {
    readonly stops: GradientStop[];
    constructor(stops: GradientStop[]);
    static constant(rgba: ColorRGBATuple): Gradient;
    static linear(from: ColorRGBATuple, to: ColorRGBATuple): Gradient;
    sample(t: number, out: ColorRGBATuple): ColorRGBATuple;
    /** Bake to a Float32Array RGBA buffer (length = samples * 4). */
    bake(samples?: number): Float32Array;
    toJSON(): {
        stops: GradientStop[];
    };
    static fromJSON(data: {
        stops: GradientStop[];
    }): Gradient;
    /** Lazily bake to a 1×N RGBA32F DataTexture for GPU sampling. */
    private _texture?;
    getTexture(samples?: number): THREE.DataTexture;
}

declare function sampleScalar(input: ScalarInput, rng: RNG): number;
declare function sampleVec3(input: Vec3Input, rng: RNG, out: Vec3Tuple): Vec3Tuple;
declare function sampleColor(input: ColorInput, rng: RNG, out: ColorTuple): ColorTuple;

/**
 * Signed-distance-function (SDF) primitive builders for `SdfCollision`.
 *
 * Each helper returns a function `(p: Node<"vec3">) => Node<"float">` that evaluates the
 * signed distance from world-space point `p` to the surface of the shape. Negative means
 * inside, positive means outside. Collisions fire when the value drops below zero (or
 * below `thickness` for tolerance).
 *
 * Primitives follow iq's standard formulations (https://iquilezles.org/articles/distfunctions/).
 * They're pure TSL — compose them with `min`/`max`/`abs` for booleans, or call multiple in
 * parallel for a scene.
 */

type SdfFn = (p: Node<"vec3">) => Node<"float">;
/** Sphere centered at `center` with radius `radius`. */
declare function sdfSphere(center: Vec3Tuple, radius: number): SdfFn;
/**
 * Axis-aligned box centered at `center` with half-extents `halfSize`. Exact (not bounding)
 * SDF — interior distance is correctly negative.
 */
declare function sdfBox(center: Vec3Tuple, halfSize: Vec3Tuple): SdfFn;
/**
 * Plane passing through `point` with unit normal `normal`. Positive distance on the normal's
 * side, negative on the opposite side.
 */
declare function sdfPlane(point: Vec3Tuple, normal: Vec3Tuple): SdfFn;
/** Union of two SDFs — the closer surface wins. */
declare function sdfUnion(a: SdfFn, b: SdfFn): SdfFn;
/** Intersection of two SDFs — inside only where both are inside. */
declare function sdfIntersect(a: SdfFn, b: SdfFn): SdfFn;
/** Subtraction `a - b`: `a` with `b` carved out. */
declare function sdfSubtract(a: SdfFn, b: SdfFn): SdfFn;

/** Register a module factory (module class with static `type` + `fromJSON`). */
declare function registerModule(factory: ModuleFactory): void;
declare function unregisterModule(type: string): void;
declare function getModuleFactory(type: string): ModuleFactory | undefined;
declare function listRegisteredModules(): string[];
declare function moduleFromJSON(data: ModuleJSON): Module;

interface SpawnRateParams {
    /** Particles per second. */
    rate: number;
    id?: string;
}
/** Continuous spawner emitting `rate` particles per second. Fractional carry-over accumulates. */
declare class SpawnRate implements EmitterSpawnModule {
    static readonly type = "spawn.rate";
    readonly kind: "emitter_spawn";
    readonly type = "spawn.rate";
    readonly id?: string;
    rate: number;
    private _accumulator;
    constructor(params: SpawnRateParams);
    reset(): void;
    requestSpawn(ctx: EmitterContext): number;
    toJSON(): ModuleJSON;
    static fromJSON(data: ModuleJSON): SpawnRate;
}

interface SpawnBurstEntry {
    /** Seconds after emitter start when this burst fires. */
    time: number;
    /** Number of particles to emit. */
    count: number;
    /** Fire every `cycle` seconds after `time` (0 = one-shot). */
    cycle?: number;
    /** Max number of cycles to fire (defaults to Infinity when cycle > 0). */
    repeats?: number;
}
interface SpawnBurstParams {
    bursts: SpawnBurstEntry[];
    id?: string;
}
/** Burst spawner: fires configurable bursts of particles at specific times or on a cycle. */
declare class SpawnBurst implements EmitterSpawnModule {
    static readonly type = "spawn.burst";
    readonly kind: "emitter_spawn";
    readonly type = "spawn.burst";
    readonly id?: string;
    readonly bursts: SpawnBurstEntry[];
    private _fired;
    constructor(params: SpawnBurstParams);
    reset(): void;
    requestSpawn(ctx: EmitterContext): number;
    toJSON(): ModuleJSON;
    static fromJSON(data: ModuleJSON): SpawnBurst;
}

interface SpawnFromEventsParams {
    /**
     * The emitter whose events drive spawns. Either a built `Emitter` instance
     * (must already exist when this module is constructed) or the string `name`
     * of an emitter defined elsewhere in the same `SystemDef` — the System
     * constructor resolves the name to the actual instance after every emitter
     * has been created.
     */
    source: Emitter | string;
    /** Particles to emit per source event. Default 1. */
    perEvent?: number;
    /**
     * CPU-side upper bound on events per frame. Determines dispatch size each tick.
     * Excess threads exit early in the shader via the event counter. Default 64.
     */
    maxEventsPerFrame?: number;
    /** If true, new particles inherit the event's velocity (requires source to emit velocity events). */
    inheritVelocity?: boolean;
    id?: string;
}
/**
 * Spawns particles in response to events fired by another emitter (e.g. particle deaths).
 *
 * Pairs with an Emitter that has `events: { onDeath: true }`. Each frame, this module
 * requests `maxEventsPerFrame × perEvent` spawn slots. The Emitter's spawn kernel then reads
 * the source's event buffer to initialize each new particle's position (and optionally velocity).
 */
declare class SpawnFromEvents implements EmitterSpawnModule {
    static readonly type = "spawn.from_events";
    readonly kind: "emitter_spawn";
    readonly type = "spawn.from_events";
    readonly id?: string;
    /** Resolved at construction time when an `Emitter` instance is passed, or
     *  filled in by `System` after construction when only a name was given. */
    source: Emitter;
    /** When `source` was given as a string, this is the deferred name kept
     *  around for the System to resolve. Cleared once resolved. */
    pendingSourceName?: string;
    readonly perEvent: number;
    readonly maxEventsPerFrame: number;
    readonly inheritVelocity: boolean;
    constructor(params: SpawnFromEventsParams);
    /** Called by `System` once every emitter is constructed. Looks up the
     *  source by name and finishes wiring this module. */
    resolveSource(emitters: Emitter[]): void;
    requestSpawn(_ctx: EmitterContext): number;
    toJSON(): ModuleJSON;
    static fromJSON(_data: ModuleJSON): SpawnFromEvents;
}

interface InitLifetimeParams {
    lifetime: ScalarInput;
    id?: string;
}
declare class InitLifetime implements ParticleSpawnModule {
    static readonly type = "init.lifetime";
    readonly kind: "particle_spawn";
    readonly type = "init.lifetime";
    readonly id?: string;
    lifetime: ScalarInput;
    constructor(params: InitLifetimeParams);
    contributeSpawnTSL(ctx: SpawnInitContext): void;
    toJSON(): ModuleJSON;
    static fromJSON(data: ModuleJSON): InitLifetime;
}

interface InitPositionParams {
    shape: EmissionShape;
    /** If true (default), sampled positions are transformed by emitter world matrix. */
    worldSpace?: boolean;
    /**
     * Added to every sampled position, in the emitter's local space, before any world-space
     * transform. Lifts a ground effect just above the surface it lands on. Default `[0, 0, 0]`.
     */
    offset?: [number, number, number];
    id?: string;
}
declare class InitPosition implements ParticleSpawnModule {
    static readonly type = "init.position";
    readonly kind: "particle_spawn";
    readonly type = "init.position";
    readonly id?: string;
    shape: EmissionShape;
    worldSpace: boolean;
    offset: [number, number, number];
    constructor(params: InitPositionParams);
    contributeSpawnTSL(ctx: SpawnInitContext): void;
    toJSON(): ModuleJSON;
    static fromJSON(data: ModuleJSON): InitPosition;
}

interface InitVelocityParams {
    shape: EmissionShape;
    speed: ScalarInput;
    /** If true (default), the sampled direction is rotated by the emitter's world matrix. */
    worldSpace?: boolean;
    id?: string;
}
declare class InitVelocity implements ParticleSpawnModule {
    static readonly type = "init.velocity";
    readonly kind: "particle_spawn";
    readonly type = "init.velocity";
    readonly id?: string;
    shape: EmissionShape;
    speed: ScalarInput;
    worldSpace: boolean;
    constructor(params: InitVelocityParams);
    contributeSpawnTSL(ctx: SpawnInitContext): void;
    toJSON(): ModuleJSON;
    static fromJSON(data: ModuleJSON): InitVelocity;
}

interface InitColorParams {
    color: ColorInput;
    alpha?: ScalarInput;
    id?: string;
}
declare class InitColor implements ParticleSpawnModule {
    static readonly type = "init.color";
    readonly kind: "particle_spawn";
    readonly type = "init.color";
    readonly id?: string;
    color: ColorInput;
    alpha: ScalarInput;
    constructor(params: InitColorParams);
    contributeSpawnTSL(ctx: SpawnInitContext): void;
    toJSON(): ModuleJSON;
    static fromJSON(data: ModuleJSON): InitColor;
}

interface InitSizeParams {
    size: ScalarInput;
    id?: string;
}
declare class InitSize implements ParticleSpawnModule {
    static readonly type = "init.size";
    readonly kind: "particle_spawn";
    readonly type = "init.size";
    readonly id?: string;
    size: ScalarInput;
    constructor(params: InitSizeParams);
    contributeSpawnTSL(ctx: SpawnInitContext): void;
    toJSON(): ModuleJSON;
    static fromJSON(data: ModuleJSON): InitSize;
}

interface InitRotationParams {
    rotation?: ScalarInput;
    angularVelocity?: ScalarInput;
    id?: string;
}
declare class InitRotation implements ParticleSpawnModule {
    static readonly type = "init.rotation";
    readonly kind: "particle_spawn";
    readonly type = "init.rotation";
    readonly id?: string;
    rotation: ScalarInput;
    angularVelocity: ScalarInput;
    constructor(params: InitRotationParams);
    contributeSpawnTSL(ctx: SpawnInitContext): void;
    toJSON(): ModuleJSON;
    static fromJSON(data: ModuleJSON): InitRotation;
}

type InitFromMeshFill = "surface" | "volume";
interface InitFromMeshParams {
    /** Geometry to sample — indexed or non-indexed. Must have position attribute. */
    geometry: THREE.BufferGeometry;
    /**
     * Local→world transform for the geometry. Applied per spawn so the mesh can move/rotate/scale
     * without re-uploading. Defaults to identity (mesh is at the emitter origin).
     */
    matrix?: THREE.Matrix4;
    /**
     * If true, the sampled point stays local and the emitter's world transform is composed on
     * top (like any other InitPosition). If false, sampled points are emitted in world space
     * (useful when the source mesh is independent of the emitter's own transform). Default true.
     */
    worldSpace?: boolean;
    /**
     * `"surface"` (default): area-weighted sampling of points on the mesh skin. Works for any
     * mesh — open or closed, thin or solid.
     *
     * `"volume"`: uniform sampling of points inside the mesh interior. Requires the mesh to be
     * a closed watertight surface (holes will leak samples). Computed once at construction via
     * rejection sampling — may take ~100ms for dense meshes. Each particle picks a random
     * entry from a pre-generated sample set; `volumeSampleCount` controls the set size.
     */
    fill?: InitFromMeshFill;
    /**
     * Only used when `fill: "volume"`. Number of pre-sampled interior points cached on the GPU.
     * Higher = less visible repetition at high spawn rates, at the cost of construction time
     * and GPU memory. Default 2048 (24 KB of storage). Set lower (256–512) for tiny meshes.
     */
    volumeSampleCount?: number;
    id?: string;
}
/**
 * Spawn-init module: picks a point on or inside a mesh for each new particle. Used for
 * effects that emit from a model — e.g. dust off an armor, sparks from a blade edge, embers
 * along a dragon silhouette (surface), or fog filling a magical containment (volume).
 *
 * **Surface mode** (default): CPU builds a triangle area-weighted cumulative distribution;
 * GPU binary-searches it per spawn, then barycentric-samples within the chosen triangle.
 *
 * **Volume mode**: CPU pre-generates `volumeSampleCount` points via rejection sampling
 * (raycast-based inside test); GPU reads a uniformly-random index each spawn. Fast on GPU
 * because no per-spawn geometry work happens, but construction cost scales with mesh size.
 */
declare class InitFromMesh implements ParticleSpawnModule {
    static readonly type = "init.from_mesh";
    readonly kind: "particle_spawn";
    readonly type = "init.from_mesh";
    readonly id?: string;
    worldSpace: boolean;
    fill: InitFromMeshFill;
    private _triCount;
    private _triVerts?;
    private _triCdf?;
    private _volumePointCount;
    private _volumePoints?;
    private _uMeshMatrix;
    constructor(params: InitFromMeshParams);
    contributeSpawnTSL(ctx: SpawnInitContext): void;
    private _sampleSurface;
    private _sampleVolume;
    toJSON(): ModuleJSON;
    static fromJSON(_data: ModuleJSON): InitFromMesh;
}

/**
 * Deprecated — the Emitter now runs the age+kill step internally before any user update
 * module executes. This class is kept as a no-op for backward JSON compatibility so old
 * presets that included "update.lifetime_tick" don't fail to deserialize.
 */
declare class LifetimeTick implements ParticleUpdateModule {
    static readonly type = "update.lifetime_tick";
    readonly kind: "particle_update";
    readonly type = "update.lifetime_tick";
    readonly id?: string;
    constructor(params?: {
        id?: string;
    });
    contributeUpdateTSL(_ctx: UpdateContext): void;
    toJSON(): ModuleJSON;
    static fromJSON(data: ModuleJSON): LifetimeTick;
}

interface VelocityIntegratorParams {
    id?: string;
}
/** Integrates position by velocity and rotation by angular velocity: pos += vel * dt. */
declare class VelocityIntegrator implements ParticleUpdateModule {
    static readonly type = "update.velocity_integrator";
    readonly kind: "particle_update";
    readonly type = "update.velocity_integrator";
    readonly id?: string;
    constructor(params?: VelocityIntegratorParams);
    contributeUpdateTSL(ctx: UpdateContext): void;
    toJSON(): ModuleJSON;
    static fromJSON(data: ModuleJSON): VelocityIntegrator;
}

interface GravityParams {
    acceleration?: Vec3Tuple;
    id?: string;
}
declare class Gravity implements ParticleUpdateModule {
    static readonly type = "update.gravity";
    readonly kind: "particle_update";
    readonly type = "update.gravity";
    readonly id?: string;
    acceleration: Vec3Tuple;
    private _uAccel;
    constructor(params?: GravityParams);
    /** Change acceleration at runtime without rebuilding the kernel. */
    setAcceleration(x: number, y: number, z: number): void;
    contributeUpdateTSL(ctx: UpdateContext): void;
    toJSON(): ModuleJSON;
    static fromJSON(data: ModuleJSON): Gravity;
}

interface DragParams {
    coefficient: number;
    id?: string;
}
/** Exponential velocity decay: v *= exp(-coefficient * dt). */
declare class Drag implements ParticleUpdateModule {
    static readonly type = "update.drag";
    readonly kind: "particle_update";
    readonly type = "update.drag";
    readonly id?: string;
    coefficient: number;
    private _uCoef;
    constructor(params: DragParams);
    setCoefficient(c: number): void;
    contributeUpdateTSL(ctx: UpdateContext): void;
    toJSON(): ModuleJSON;
    static fromJSON(data: ModuleJSON): Drag;
}

interface ColorOverLifeParams {
    gradient: Gradient;
    id?: string;
}
/** Modulates particle color: color = initialColor * gradient(age/lifetime). */
declare class ColorOverLife implements ParticleUpdateModule {
    static readonly type = "update.color_over_life";
    readonly kind: "particle_update";
    readonly applyOnSpawn = true;
    readonly type = "update.color_over_life";
    readonly id?: string;
    gradient: Gradient;
    constructor(params: ColorOverLifeParams);
    contributeUpdateTSL(ctx: UpdateContext): void;
    toJSON(): ModuleJSON;
    static fromJSON(data: ModuleJSON): ColorOverLife;
}

interface SizeOverLifeParams {
    curve: Curve1D;
    id?: string;
}
/** size = initialSize * curve(age/lifetime) */
declare class SizeOverLife implements ParticleUpdateModule {
    static readonly type = "update.size_over_life";
    readonly kind: "particle_update";
    readonly applyOnSpawn = true;
    readonly type = "update.size_over_life";
    readonly id?: string;
    curve: Curve1D;
    constructor(params: SizeOverLifeParams);
    contributeUpdateTSL(ctx: UpdateContext): void;
    toJSON(): ModuleJSON;
    static fromJSON(data: ModuleJSON): SizeOverLife;
}

interface AlphaOverLifeParams {
    curve: Curve1D;
    id?: string;
}
/** color.a = initialColor.a * curve(age/lifetime); rgb preserved. */
declare class AlphaOverLife implements ParticleUpdateModule {
    static readonly type = "update.alpha_over_life";
    readonly kind: "particle_update";
    readonly applyOnSpawn = true;
    readonly type = "update.alpha_over_life";
    readonly id?: string;
    curve: Curve1D;
    constructor(params: AlphaOverLifeParams);
    contributeUpdateTSL(ctx: UpdateContext): void;
    toJSON(): ModuleJSON;
    static fromJSON(data: ModuleJSON): AlphaOverLife;
}

interface VelocityOverLifeParams {
    curve: Curve1D;
    id?: string;
}
/** velocity = initialVelocity * curve(age/lifetime). Place before forces that add to velocity. */
declare class VelocityOverLife implements ParticleUpdateModule {
    static readonly type = "update.velocity_over_life";
    readonly kind: "particle_update";
    readonly applyOnSpawn = true;
    readonly type = "update.velocity_over_life";
    readonly id?: string;
    curve: Curve1D;
    constructor(params: VelocityOverLifeParams);
    contributeUpdateTSL(ctx: UpdateContext): void;
    toJSON(): ModuleJSON;
    static fromJSON(data: ModuleJSON): VelocityOverLife;
}

interface FollowPositionParams {
    id?: string;
}
/**
 * Pins live particles to the `Manager.spawn(..., { follow })` target position.
 *
 * When no follow target is active, it falls back to the system origin from `worldMatrix`.
 * That makes trail prefabs useful both as socket-following effects and as regular
 * position-driven effects.
 */
declare class FollowPosition implements ParticleUpdateModule {
    static readonly type = "update.follow_position";
    readonly kind: "particle_update";
    readonly type = "update.follow_position";
    readonly id?: string;
    private _uPosition;
    private _uHasFollow;
    constructor(params?: FollowPositionParams);
    setFollowPosition(position: THREE.Vector3, hasFollow: boolean): void;
    contributeUpdateTSL(ctx: UpdateContext): void;
    toJSON(): ModuleJSON;
    static fromJSON(data: ModuleJSON): FollowPosition;
}

interface TurbulenceForceParams {
    amplitude: number;
    frequency: number;
    speed?: number;
    octaves?: number;
    id?: string;
}
/** Pseudo-random swirl sampled from a 3D noise field. Adds to velocity each frame. */
declare class TurbulenceForce implements ParticleUpdateModule {
    static readonly type = "update.turbulence_force";
    readonly kind: "particle_update";
    readonly type = "update.turbulence_force";
    readonly id?: string;
    amplitude: number;
    frequency: number;
    speed: number;
    octaves: number;
    private _uAmp;
    private _uFreq;
    private _uSpeed;
    constructor(params: TurbulenceForceParams);
    contributeUpdateTSL(ctx: UpdateContext): void;
    toJSON(): ModuleJSON;
    static fromJSON(data: ModuleJSON): TurbulenceForce;
}

interface CurlNoiseForceParams {
    /** Peak force magnitude (world units / s²). */
    amplitude: number;
    /** Spatial frequency of the underlying noise field (higher = tighter swirls). */
    frequency: number;
    /** Rate at which the noise field drifts through time. Default 0.5. */
    speed?: number;
    id?: string;
}
/**
 * Divergence-free swirl force. Samples three decorrelated `mx_noise_vec3` fields as a
 * vector potential `ψ` and returns `curl(ψ) = ∇ × ψ`. Curl of any smooth vector field is
 * divergence-free, so particles don't clump into sinks/sources — they endlessly swirl. This
 * is the standard "curl noise" force used for smoke, fluid, magic effects.
 *
 * Compared to `TurbulenceForce` (independent per-axis noise = has divergence → clumping),
 * this produces visibly more organic, fluid-like motion.
 */
declare class CurlNoiseForce implements ParticleUpdateModule {
    static readonly type = "update.curl_noise_force";
    readonly kind: "particle_update";
    readonly type = "update.curl_noise_force";
    readonly id?: string;
    amplitude: number;
    frequency: number;
    speed: number;
    private _uAmp;
    private _uFreq;
    private _uSpeed;
    constructor(params: CurlNoiseForceParams);
    contributeUpdateTSL(ctx: UpdateContext): void;
    toJSON(): ModuleJSON;
    static fromJSON(data: ModuleJSON): CurlNoiseForce;
}

interface VortexForceParams {
    /** Rotation axis (world-space unless `worldSpace` is false). Auto-normalized. */
    axis?: Vec3Tuple;
    /** A point on the axis. Defaults to origin (emitter local). */
    origin?: Vec3Tuple;
    /** Tangential acceleration magnitude (units/sec²). Positive = counterclockwise around axis. */
    strength: number;
    /** If true, `origin` is taken as-is in world space; otherwise transformed by emitter world. */
    worldSpace?: boolean;
    id?: string;
}
/**
 * Rotational force that pulls particles in a circular path around an arbitrary axis.
 * At each particle, the tangent direction is `axis × (p - origin)` — pushing it perpendicular
 * to both the axis and the radial vector. Use for whirlwinds, vortexes, circular wind.
 */
declare class VortexForce implements ParticleUpdateModule {
    static readonly type = "update.vortex_force";
    readonly kind: "particle_update";
    readonly type = "update.vortex_force";
    readonly id?: string;
    axis: Vec3Tuple;
    origin: Vec3Tuple;
    strength: number;
    worldSpace: boolean;
    private _uAxis;
    private _uOrigin;
    private _uStrength;
    constructor(params: VortexForceParams);
    contributeUpdateTSL(ctx: UpdateContext): void;
    toJSON(): ModuleJSON;
    static fromJSON(data: ModuleJSON): VortexForce;
}

type PointAttractorFalloff = "none" | "linear" | "inverse" | "inverseSquared";
interface PointAttractorParams {
    position?: Vec3Tuple;
    strength: number;
    radius: number;
    falloff?: PointAttractorFalloff;
    worldSpace?: boolean;
    id?: string;
}
/** Pulls particles toward (or away from) a point within a radius. */
declare class PointAttractor implements ParticleUpdateModule {
    static readonly type = "update.point_attractor";
    readonly kind: "particle_update";
    readonly type = "update.point_attractor";
    readonly id?: string;
    position: Vec3Tuple;
    strength: number;
    radius: number;
    falloff: PointAttractorFalloff;
    worldSpace: boolean;
    private _uLocalPos;
    private _uStrength;
    private _uRadius;
    constructor(params: PointAttractorParams);
    contributeUpdateTSL(ctx: UpdateContext): void;
    toJSON(): ModuleJSON;
    static fromJSON(data: ModuleJSON): PointAttractor;
}

interface ScaleBySpeedParams {
    /** Speed at or below which the particle renders at `minScale` × its initial size. */
    minSpeed?: number;
    /** Speed at or above which the particle renders at `maxScale` × its initial size. */
    maxSpeed: number;
    /** Multiplier at min speed. Default 1. */
    minScale?: number;
    /** Multiplier at max speed. Default 2. */
    maxScale?: number;
    id?: string;
}
/**
 * Rescales each particle by its instantaneous speed — fast particles stretch, slow ones
 * shrink. Useful for sparks, debris, rain-like effects where velocity should read visually.
 *
 * Acts on `traits.size` (the live-size attribute), preserving `initialSize`. Plays nicely
 * with `SizeOverLife` — this module re-applies after the age-based scale, or vice versa,
 * depending on module order.
 */
declare class ScaleBySpeed implements ParticleUpdateModule {
    static readonly type = "update.scale_by_speed";
    readonly kind: "particle_update";
    readonly applyOnSpawn = true;
    readonly type = "update.scale_by_speed";
    readonly id?: string;
    minSpeed: number;
    maxSpeed: number;
    minScale: number;
    maxScale: number;
    private _uMinSpeed;
    private _uMaxSpeed;
    private _uMinScale;
    private _uMaxScale;
    constructor(params: ScaleBySpeedParams);
    contributeUpdateTSL(ctx: UpdateContext): void;
    toJSON(): ModuleJSON;
    static fromJSON(data: ModuleJSON): ScaleBySpeed;
}

interface PlaneCollisionParams {
    /** Normal of the collision plane (auto-normalized). Default +Y (floor). */
    normal?: Vec3Tuple;
    /** Any point on the plane. Default origin. */
    point?: Vec3Tuple;
    /** 1.0 = perfect bounce, 0.0 = stick. Default 0.5. */
    restitution?: number;
    /** Tangential velocity retention after bounce. 1.0 = no friction. Default 0.9. */
    friction?: number;
    /** If true, plane is taken in world space as given; else transformed by emitter world matrix. */
    worldSpace?: boolean;
    id?: string;
}
/**
 * Infinite plane collision with restitution + friction. Reflects velocity component along the
 * plane normal, optionally dampens tangential motion. Clamps position so particles never
 * penetrate. For a floor, use default `normal = [0, 1, 0]`.
 */
declare class PlaneCollision implements ParticleUpdateModule {
    static readonly type = "update.plane_collision";
    readonly kind: "particle_update";
    readonly type = "update.plane_collision";
    readonly id?: string;
    normal: Vec3Tuple;
    point: Vec3Tuple;
    restitution: number;
    friction: number;
    worldSpace: boolean;
    private _uNormal;
    private _uPoint;
    private _uRestitution;
    private _uFriction;
    constructor(params?: PlaneCollisionParams);
    contributeUpdateTSL(ctx: UpdateContext): void;
    toJSON(): ModuleJSON;
    static fromJSON(data: ModuleJSON): PlaneCollision;
}

interface SphereCollisionParams {
    center?: Vec3Tuple;
    radius: number;
    /** If true, particles bounce off the OUTSIDE of the sphere; false = inside containment. */
    outside?: boolean;
    restitution?: number;
    friction?: number;
    worldSpace?: boolean;
    id?: string;
}
/**
 * Sphere collision — either particles bounce off the outside (default) or are contained
 * inside. Useful for spherical obstacles or magical barriers.
 */
declare class SphereCollision implements ParticleUpdateModule {
    static readonly type = "update.sphere_collision";
    readonly kind: "particle_update";
    readonly type = "update.sphere_collision";
    readonly id?: string;
    center: Vec3Tuple;
    radius: number;
    outside: boolean;
    restitution: number;
    friction: number;
    worldSpace: boolean;
    private _uCenter;
    private _uRadius;
    private _uRestitution;
    private _uFriction;
    constructor(params: SphereCollisionParams);
    contributeUpdateTSL(ctx: UpdateContext): void;
    toJSON(): ModuleJSON;
    static fromJSON(data: ModuleJSON): SphereCollision;
}

interface LimitVelocityParams {
    /** Maximum allowed speed (units/sec). Particles faster than this are rescaled. */
    maxSpeed: number;
    /**
     * How aggressively to apply the limit.
     * - 1 (default): hard clamp — anything above `maxSpeed` is set to exactly `maxSpeed`.
     * - <1: soft damp — excess speed is multiplied by `1 - damping * dt` per frame, easing in.
     */
    damping?: number;
    id?: string;
}
/**
 * Caps the particle speed at `maxSpeed`. With `damping < 1`, excess velocity decays over time
 * instead of snapping — gives a more natural feel for things like wind-buffeted debris.
 */
declare class LimitVelocity implements ParticleUpdateModule {
    static readonly type = "update.limit_velocity";
    readonly kind: "particle_update";
    readonly type = "update.limit_velocity";
    readonly id?: string;
    maxSpeed: number;
    damping: number;
    private _uMax;
    private _uDamping;
    constructor(params: LimitVelocityParams);
    contributeUpdateTSL(ctx: UpdateContext): void;
    toJSON(): ModuleJSON;
    static fromJSON(data: ModuleJSON): LimitVelocity;
}

/** Which world plane the flowmap texture covers. The other axis is preserved untouched. */
type FlowmapAxis = "xz" | "xy" | "yz";
interface FlowmapForceParams {
    /**
     * RGBA texture whose R/G channels encode a 2D flow direction. Convention: each pixel's
     * `(r, g)` is decoded as `(r * 2 - 1, g * 2 - 1)` to recover a direction in [-1, +1]² —
     * standard "centered-at-0.5" flowmap encoding (matches Houdini, Substance, common engines).
     * The B/A channels are unused by this module but you can repurpose them in custom shaders.
     */
    texture: THREE.Texture;
    /**
     * World-space corner where the texture's UV (0, 0) sits. Together with `size` and `axis`
     * this defines the rectangle that maps onto the texture.
     */
    origin: [number, number, number];
    /**
     * Width × height of the textured rectangle in world units, along the two axes named by
     * `axis`. Particles outside this rectangle still get sampled — texture wrapping comes from
     * the underlying `THREE.Texture` settings (default repeat or clamp).
     */
    size: [number, number];
    /** Which world plane the flowmap covers. Default `"xz"` (top-down ground flow). */
    axis?: FlowmapAxis;
    /** How hard the flow pushes velocity. Multiplied into the decoded direction × dt. Default 1. */
    amplitude?: number;
    id?: string;
}
/**
 * Texture-driven motion. Each frame, every particle samples a flowmap texture at its world
 * position projected onto the configured plane, decodes the R/G channels into a 2D direction,
 * scales by `amplitude * dt`, and adds the result to the particle's velocity.
 *
 * Use for: wind fields, water currents, magical streams that follow painted curves, lava
 * flow, fluid simulations baked from offline tools like Houdini.
 *
 * Example — particles drifting along a top-down flowmap:
 * ```ts
 * .flowmapForce({
 *   texture: flowmap,           // RGBA, R/G = direction
 *   origin: [-10, 0, -10],      // (0,0) UV maps here
 *   size: [20, 20],             // 20×20 world units → full texture
 *   axis: "xz",
 *   amplitude: 3,
 * })
 * ```
 */
declare class FlowmapForce implements ParticleUpdateModule {
    static readonly type = "update.flowmap_force";
    readonly kind: "particle_update";
    readonly type = "update.flowmap_force";
    readonly id?: string;
    texture: THREE.Texture;
    origin: [number, number, number];
    size: [number, number];
    axis: FlowmapAxis;
    amplitude: number;
    private _uOrigin;
    private _uInvSize;
    private _uAmplitude;
    constructor(params: FlowmapForceParams);
    contributeUpdateTSL(ctx: UpdateContext): void;
    toJSON(): ModuleJSON;
    static fromJSON(_data: ModuleJSON): FlowmapForce;
}

type DepthCollisionMode = "kill" | "stop" | "bounce";
type DepthCollisionNormal = "depth-gradient" | "camera";
interface DepthCollisionParams {
    /**
     * A depth texture containing the current frame's scene depth. Caller is responsible for
     * rendering the scene into a render target whose `depthTexture` is this texture once per
     * frame BEFORE the `Manager.tick()` call. The module reads [0..1] values from it and
     * compares against each particle's projected NDC depth.
     */
    depthTexture: THREE.Texture;
    /** Camera used to render the depth pass. Matrices auto-sync from it in `beforeUpdate`. */
    camera: THREE.Camera;
    /**
     * How to respond when a particle is behind scene geometry.
     * - `"kill"`: set `alive = 0`, particle is immediately retired.
     * - `"stop"`: zero the velocity — particle freezes where it collided.
     * - `"bounce"` (default): reflect velocity using the surface normal, scaled by `restitution`
     *   (normal component) and `friction` (tangential component).
     */
    mode?: DepthCollisionMode;
    /**
     * How to derive the surface normal for `"bounce"`.
     * - `"depth-gradient"` (default): reconstruct per-particle from the depth texture using
     *   two finite-difference samples. Accurate for any surface orientation — rain splashes
     *   upward off the top of boxes, sideways off walls, etc.
     * - `"camera"`: assume the surface faces the camera. Cheap (3 fewer texture samples) but
     *   wrong for surfaces angled away from the camera.
     */
    normal?: DepthCollisionNormal;
    /** Bounce normal-component energy retention (0 = stick, 1 = perfect bounce). Default 0.5. */
    restitution?: number;
    /** Bounce tangential-component retention (1 = frictionless slide). Default 0.9. */
    friction?: number;
    /**
     * Tolerance in NDC-depth units for the behind-surface test. Positive values make the test
     * stricter (particle must be clearly behind). Tune up if Z-fighting causes false positives
     * on coplanar geometry. Default 0.0005.
     */
    thickness?: number;
    id?: string;
}
/**
 * Makes particles collide with rendered scene geometry by reading a depth texture.
 *
 * Flow each frame:
 *  1. Caller renders the scene's depth into `depthTexture` (a separate depth-only render pass).
 *  2. `beforeUpdate(camera)` syncs matrices and viewport size into uniforms.
 *  3. Inside the update kernel, each particle projects its world position to clip space, reads
 *     the depth-texture at the resulting UV, and compares particle-NDC-Z to sample-NDC-Z.
 *     A particle behind the sampled depth has gone into geometry → respond per `mode`.
 *
 * For `"bounce"` mode with `normal: "depth-gradient"` (the default), the module takes two
 * extra samples offset by one pixel in X and Y, unprojects each to world space, and takes
 * the cross product of the deltas — giving a surface normal correct for any orientation
 * (horizontal tops splash UP, walls bounce sideways). The `"camera"` normal mode skips those
 * samples for speed but only looks right on camera-facing surfaces.
 */
declare class DepthCollision implements ParticleUpdateModule {
    static readonly type = "update.depth_collision";
    readonly kind: "particle_update";
    readonly type = "update.depth_collision";
    readonly id?: string;
    mode: DepthCollisionMode;
    normal: DepthCollisionNormal;
    restitution: number;
    friction: number;
    thickness: number;
    camera: THREE.Camera;
    depthTexture: THREE.Texture;
    private _uViewProj;
    private _uInvViewProj;
    private _uCameraForward;
    private _uTexelSize;
    private _uRestitution;
    private _uFriction;
    private _uThickness;
    private _tmpDir;
    private _tmpMat;
    constructor(params: DepthCollisionParams);
    beforeUpdate(_dt: number, _camera?: THREE.Camera): void;
    contributeUpdateTSL(ctx: UpdateContext): void;
    /**
     * Reconstruct world-space surface normal at the sampled depth pixel by unprojecting three
     * points (center + one pixel in X + one pixel in Y) and taking the cross product. Ensures
     * the normal faces the camera (flips if not).
     */
    private _reconstructNormal;
    toJSON(): ModuleJSON;
    static fromJSON(_data: ModuleJSON): DepthCollision;
}

type SdfCollisionMode = "kill" | "stop" | "bounce";
interface SdfCollisionParams {
    /**
     * Signed-distance function evaluated per particle. Return value < 0 means inside (collided),
     * > 0 means outside. Typically composed from `sdfSphere`/`sdfBox`/`sdfPlane` + union/
     * intersect/subtract helpers exported from `plume`.
     */
    sdf: SdfFn;
    /**
     * How to respond on collision.
     * - `"kill"`: set `alive = 0`, retiring the particle.
     * - `"stop"`: zero the velocity.
     * - `"bounce"` (default): reflect velocity about the SDF gradient (the surface normal),
     *   scaled by `restitution` / `friction`. Position is pushed out to the surface to
     *   prevent stick-through on the next frame.
     */
    mode?: SdfCollisionMode;
    /** Bounce normal-component energy retention. Default 0.5. */
    restitution?: number;
    /** Bounce tangential-component retention. Default 0.9. */
    friction?: number;
    /** Particles with SDF value below this threshold count as collided. Default 0.02. */
    thickness?: number;
    /** Epsilon for finite-difference gradient — smaller is more accurate but noisier. Default 0.01. */
    gradientEpsilon?: number;
    id?: string;
}
/**
 * Analytic collision against an arbitrary signed-distance field. Unlike `DepthCollision`,
 * this works for every particle regardless of camera — no depth pre-pass, no screen-space
 * limits. Cost: up to 5 SDF evaluations per particle per frame in `"bounce"` mode (one for
 * the hit test, four for the gradient-based normal via Mikael Hvidtfeldt Christensen's
 * tetrahedron trick).
 *
 * Use for magical barriers, force fields, procedural colliders, or anything where a closed-
 * form distance is known. Compose primitives via `sdfUnion`/`sdfIntersect`/`sdfSubtract`.
 */
declare class SdfCollision implements ParticleUpdateModule {
    static readonly type = "update.sdf_collision";
    readonly kind: "particle_update";
    readonly type = "update.sdf_collision";
    readonly id?: string;
    sdf: SdfFn;
    mode: SdfCollisionMode;
    restitution: number;
    friction: number;
    thickness: number;
    gradientEpsilon: number;
    private _uRestitution;
    private _uFriction;
    private _uThickness;
    private _uEps;
    constructor(params: SdfCollisionParams);
    contributeUpdateTSL(ctx: UpdateContext): void;
    /**
     * SDF gradient via Christensen's tetrahedron offsets — 4 SDF evaluations instead of 6
     * for central differences, with identical accuracy at typical epsilons.
     */
    private _gradientNormal;
    toJSON(): ModuleJSON;
    static fromJSON(_data: ModuleJSON): SdfCollision;
}

type SpriteBlendMode = "additive" | "alpha" | "normal";
/**
 * How a sprite's quad is oriented. Axes for `ground` / `wall` / `upright` are the effect's
 * own space (Y up), so a rotated or scaled system carries its sprites with it.
 * - `"camera"` (default): always faces the camera. `rotation` spins it on screen.
 * - `"upright"`: faces the camera but stays vertical, turning only about Y. `rotation` is
 *   ignored, since spinning it would tip it over.
 * - `"ground"`: flat, facing +Y. `rotation` spins it about Y.
 * - `"wall"`: vertical, facing `facingAngle`. `rotation` spins it in its own plane.
 */
type SpriteOrientation = "camera" | "upright" | "ground" | "wall";
/**
 * Sprite-sheet animation config. The provided texture is treated as a `cols × rows` grid of
 * frames. Each particle advances through frames during its lifetime according to `mode`:
 * - `"lifetime"` (default): frame = floor(age/lifetime × totalFrames), clamped to last frame.
 * - `"loop"`: frame = floor(age × fps) mod totalFrames.
 */
interface SpriteAnimationParams {
    cols: number;
    rows: number;
    /** Playback mode. Default "lifetime". */
    mode?: "lifetime" | "loop";
    /** Frames per second for loop mode. Ignored in lifetime mode. Default 24. */
    fps?: number;
    /**
     * Sample-sheet key in the `textures` map to grid-animate. Default "base". Only that one
     * texture's UVs are remapped; other textures keep raw UV (handy for masks etc).
     */
    texture?: string;
}
interface SpriteRendererParams {
    blending?: SpriteBlendMode;
    /**
     * Texture input. Pass a single `Texture` (gets the key `"base"`) or a map of named
     * textures for multi-texture materials. The named map is what `colorNode` receives in
     * `ctx.textures`.
     */
    textures?: TextureInput;
    /**
     * @deprecated since R16. Use `textures` instead — this is just sugar that maps to
     * `textures: { base: tex }` for backward compat.
     */
    texture?: THREE.Texture;
    /**
     * Custom fragment shader. Replaces the default
     *   `texSample.rgb * particle.color.rgb, texSample.a * particle.color.a * opacity`
     * computation. The callback receives a {@link ColorNodeContext} with particle state, UV,
     * the textures map, and emitter time. Return any TSL `Node<"vec4">`.
     */
    colorNode?: ColorNodeFn;
    opacity?: number;
    depthWrite?: boolean;
    depthTest?: boolean;
    renderOrder?: number;
    id?: string;
    textureRef?: string;
    /** Optional sprite-sheet animation. When set, the named texture is treated as a frame grid. */
    animation?: SpriteAnimationParams;
    /** Quad orientation. Default `"camera"`. See {@link SpriteOrientation}. */
    orientation?: SpriteOrientation;
    /**
     * Degrees about Y that a `"wall"` sprite faces. 0 faces +Z, 90 faces +X. Ignored by the
     * other orientations. Default 0.
     */
    facingAngle?: number;
}
/**
 * Instanced billboard sprite renderer on `MeshBasicNodeMaterial` + TSL + `THREE.InstancedMesh`.
 * Per-particle data is read from GPU storage via `storage.X.element(instanceIndex)` inside
 * the TSL vertex/fragment functions. Dead particles zero-scale to a degenerate quad.
 *
 * For custom shading (dissolve, distortion, scrolling textures, multi-tex blends) supply a
 * `colorNode` callback — full TSL is at your disposal with the per-particle state already
 * loaded via `ctx.particle`.
 */
declare class SpriteRenderer implements RenderModule {
    static readonly type = "render.sprite";
    readonly kind: "render";
    readonly type = "render.sprite";
    readonly id?: string;
    blending: SpriteBlendMode;
    opacity: number;
    depthWrite: boolean;
    depthTest: boolean;
    renderOrder: number;
    textureRef?: string;
    animation?: SpriteAnimationParams;
    orientation: SpriteOrientation;
    facingAngle: number;
    readonly object3D: THREE.Group;
    private _mesh?;
    private _geometry?;
    private _material?;
    private _textures;
    private _colorNode?;
    private _setOpacity;
    private _uTime;
    constructor(params?: SpriteRendererParams);
    init(storage: ParticleStorage, capacity: number, opts?: RenderInitOptions): void;
    private _resolveBlending;
    updateRender(liveCount: number, ctx: RenderContext): void;
    dispose(): void;
    toJSON(): ModuleJSON;
    static fromJSON(data: ModuleJSON): SpriteRenderer;
}

interface MeshRendererParams {
    /** Geometry instanced per particle. */
    geometry: THREE.BufferGeometry;
    /**
     * Material applied to every instance. MUST be a `NodeMaterial` (MeshBasicNodeMaterial,
     * MeshStandardNodeMaterial, etc.).
     *
     * The renderer needs to override `positionNode` / `normalNode` to apply per-particle
     * world-space transforms. To preserve user-supplied vertex deformation, the renderer
     * COMPOSES with the previous values when present: if you set `material.positionNode`
     * before passing it in, your custom local-space position is read first and then placed +
     * rotated by the particle transform. Same applies for `normalNode`. This means a custom
     * standard material with vertex animation, displacement, etc. works unchanged through the
     * renderer — your shading is intact, plus per-particle motion.
     *
     * If omitted, a default unlit white material is used.
     */
    material?: NodeMaterial;
    renderOrder?: number;
    id?: string;
}
/**
 * Mesh particle renderer — each particle draws an instance of `geometry` with its own
 * 3-axis rotation derived from the slot index (deterministic hash), combined with the
 * per-particle angle (stored) and angular velocity (stored, integrated each frame).
 *
 * The rotation axis is constant per slot — meaning a given ring-buffer slot always tumbles
 * around the same axis regardless of which particle currently occupies it. Across slots, the
 * axis is pseudorandom, giving an organic tumble spread when many particles spawn at once.
 *
 * Normal rotation is applied via `normalNode` override so lighting on `MeshStandardNodeMaterial`
 * etc. is correct under arbitrary rotation. Dead particles collapse to zero scale.
 */
declare class MeshRenderer implements RenderModule {
    static readonly type = "render.mesh";
    readonly kind: "render";
    readonly type = "render.mesh";
    readonly id?: string;
    readonly object3D: THREE.Group;
    private _geometry;
    private _material;
    private _mesh?;
    private _renderOrder;
    private _ownsMaterial;
    constructor(params: MeshRendererParams);
    init(storage: ParticleStorage, capacity: number): void;
    updateRender(liveCount: number, _ctx: RenderContext): void;
    dispose(): void;
    toJSON(): ModuleJSON;
    static fromJSON(_data: ModuleJSON): MeshRenderer;
}

type RibbonBlendMode = "additive" | "alpha" | "normal";
interface RibbonLayerParams {
    /** Full strip width in world units. Defaults to the renderer `width`. */
    width?: number;
    /** Alpha multiplier for this layer. Defaults to the renderer `opacity`. */
    opacity?: number;
    /** HDR RGB multiplier for this layer. Defaults to white. */
    color?: ColorTuple;
}
interface RibbonRendererParams {
    /** Number of history points retained per particle (ribbon length). Default 32. */
    historyLength?: number;
    /** Ribbon full width at the head (world units). Tapers to 0 at the tail by default. */
    width?: number;
    /** Blend mode. Default "additive". */
    blending?: RibbonBlendMode;
    /** Global opacity multiplier. */
    opacity?: number;
    /** Explicit three.js renderOrder for sorting. */
    renderOrder?: number;
    /** Whether ribbons depth-test against scene geometry. Default true. */
    depthTest?: boolean;
    /** Whether ribbons write depth. Default false. */
    depthWrite?: boolean;
    /** Camera-facing billboard strip. Default true. */
    faceCamera?: boolean;
    /** Maximum history writes per second. `0` or undefined records every tick. */
    sampleRate?: number;
    /** Minimum followed-target movement before recording another sample. Default 0. */
    minDistance?: number;
    /** Seconds a captured history point remains visible. Undefined = history-index based. */
    sampleLifetime?: number;
    /** Stop recording new samples after this emitter time. Useful for authored swing windows. */
    sampleUntil?: number;
    /** Full-width multiplier over trail age, where 0 = newest/head and 1 = oldest/tail. */
    widthOverLife?: Curve1D;
    /** Alpha multiplier over trail age, where 0 = newest/head and 1 = oldest/tail. */
    alphaOverLife?: Curve1D;
    /** Color multiplier over trail age, where 0 = newest/head and 1 = oldest/tail. */
    colorOverLife?: Gradient;
    /** Additive glow layers sharing the same trail history but using separate widths/colors. */
    layers?: RibbonLayerParams[];
    /**
     * Texture inputs. Pass a single `Texture` (gets the key `"base"`) or a multi-texture map
     * for layered shading. The first one supplied becomes the default-shader base sample.
     *
     * UV semantics in the fragment: `uv.x` runs 0..1 along the ribbon length (0 = newest /
     * head, 1 = oldest / tail), `uv.y` runs 0..1 across the strip width (0 = -side, 1 = +side).
     * Combine with `time` in `colorNode` to scroll texture along the trail (lightning bolts,
     * energy beams, glowing magic).
     */
    textures?: TextureInput;
    /**
     * Custom fragment shader — replaces the default `vColor.rgb, vColor.a` computation before
     * ribbon masks, trail curves, and layer colors are applied.
     */
    colorNode?: ColorNodeFn;
    id?: string;
}
/**
 * Per-particle trail/ribbon renderer. Each particle leaves a history of positions over the
 * last N samples; the ribbon is drawn as a camera-facing triangle strip through those points.
 *
 * Socket-following trails use a single live particle pinned by `FollowPosition`, while this
 * renderer records that particle into a fixed-size GPU history buffer with optional sample
 * rate, minimum-distance gating, lifetime-based fades, and multi-layer additive glow.
 */
declare class RibbonRenderer implements RenderModule {
    static readonly type = "render.ribbon";
    readonly kind: "render";
    readonly type = "render.ribbon";
    readonly id?: string;
    readonly object3D: THREE.Group;
    readonly historyLength: number;
    width: number;
    opacity: number;
    sampleRate: number;
    minDistance: number;
    sampleLifetime?: number;
    sampleUntil?: number;
    private _blending;
    private _renderOrder;
    private _depthTest;
    private _depthWrite;
    private _faceCamera;
    private _textures;
    private _colorNode?;
    private _widthOverLife?;
    private _alphaOverLife?;
    private _colorOverLife?;
    private _hasCustomLayers;
    private _layers;
    private _capacity;
    private _history?;
    private _writeKernel?;
    private _uHead;
    private _uSampleLifetime;
    private _uTime;
    private _head;
    private _sampleAccum;
    private _geometry?;
    private _lastSamplePosition;
    private _pendingFollowPosition;
    private _hasLastSamplePosition;
    private _hasPendingFollowPosition;
    constructor(params?: RibbonRendererParams);
    init(storage: ParticleStorage, capacity: number): void;
    reset(): void;
    setFollowPosition(position: THREE.Vector3): void;
    postUpdate(renderer: WebGPURenderer, liveCount: number, deltaTime: number, emitterTime: number): void;
    updateRender(liveCount: number, ctx: RenderContext): void;
    dispose(): void;
    toJSON(): ModuleJSON;
    static fromJSON(data: ModuleJSON): RibbonRenderer;
    private _shouldRecordThisTick;
    private _passesMinDistance;
    private _buildGeometry;
    private _buildWriteKernel;
    private _buildMaterial;
    private _resolveBlending;
}

type BeamBlendMode = "additive" | "alpha" | "normal";
interface BeamRendererParams {
    /** Beam half-width at its thickest. World units. Default 0.05. */
    width?: number;
    /** Blend mode. Default "additive". */
    blending?: BeamBlendMode;
    /** Global opacity. Default 1. */
    opacity?: number;
    /** three.js render order. Default 0. */
    renderOrder?: number;
    /**
     * If true, beam tapers from full width at the head (current position) to 0 at the tail
     * (spawn position). If false, uniform width. Default true.
     */
    taperToTail?: boolean;
    /**
     * Texture inputs. Pass a single `Texture` (key `"base"`) or a multi-texture map. UV
     * semantics in the fragment: `uv.x` = 0..1 along the beam (0 = tail/spawn, 1 = head/
     * current); `uv.y` = 0..1 across the beam width.
     */
    textures?: TextureInput;
    /**
     * Custom fragment shader. The renderer always multiplies the user's returned alpha by
     * `taper * opacity` so the beam still cleanly fades from a custom shader.
     */
    colorNode?: ColorNodeFn;
    id?: string;
}
/**
 * Per-particle beam renderer — draws a camera-facing quad between each particle's spawn
 * position and its current position. Width tapers from head to tail by default.
 *
 * Uses `initialVelocity` + `age` to reconstruct the spawn position: `spawn = pos - vel * age`
 * — works cleanly for ballistic particles (just gravity/drag). For particles with strong
 * non-ballistic forces (turbulence, curl noise) the tail lags the actual path; for those,
 * use `RibbonRenderer` which traces the real path via a history buffer.
 *
 * Texture-driven beams: supply `textures.base` (e.g. a horizontal lightning gradient) and
 * scroll the UV in `colorNode` for animated energy effects.
 */
declare class BeamRenderer implements RenderModule {
    static readonly type = "render.beam";
    readonly kind: "render";
    readonly type = "render.beam";
    readonly id?: string;
    readonly object3D: THREE.Group;
    width: number;
    opacity: number;
    private _blending;
    private _renderOrder;
    private _taper;
    private _textures;
    private _colorNode?;
    private _uWidth;
    private _uOpacity;
    private _uTime;
    private _geometry?;
    private _material?;
    private _mesh?;
    constructor(params?: BeamRendererParams);
    init(storage: ParticleStorage, capacity: number): void;
    updateRender(liveCount: number, ctx: RenderContext): void;
    dispose(): void;
    toJSON(): ModuleJSON;
    static fromJSON(data: ModuleJSON): BeamRenderer;
    private _buildGeometry;
    private _buildMaterial;
    private _resolveBlending;
}

interface LightEmissionParams {
    /** How many PointLights to maintain for this emitter. Keep small — lights are expensive. Default 4. */
    lightCount?: number;
    /** Color applied to each light. */
    color?: THREE.ColorRepresentation;
    /** Light intensity multiplier. */
    intensity?: number;
    /** Light range (in world units). */
    distance?: number;
    /** Quadratic attenuation. Default 2 (physical). */
    decay?: number;
    id?: string;
}
/**
 * Renders *with* an emitter as a set of CPU-side `THREE.PointLight`s that track the first N
 * live particles. Driving lights from a GPU storage buffer requires a round-trip:
 *
 *  1. Each frame `updateRender` submits a staging buffer readback for `posAlive` of the first
 *     `lightCount` slots.
 *  2. When the async readback resolves (1–2 frames of latency), the lights' positions are
 *     updated. Until then they hold the prior values — visually unnoticeable.
 *
 * Lights are added as children of `this.object3D`, so they're inserted into the scene when
 * the System is spawned and removed when it retires. Dead particles ⇒ zero-intensity lights.
 *
 * This module is deliberately simple — no per-light color variation, no flicker driven by
 * particle age. Extend later once the base pipeline proves out.
 */
declare class LightEmission implements RenderModule {
    static readonly type = "render.light_emission";
    readonly kind: "render";
    readonly type = "render.light_emission";
    readonly id?: string;
    readonly object3D: THREE.Group;
    lightCount: number;
    intensity: number;
    private _storage?;
    private _lights;
    private _readback?;
    private _readbackPending;
    private _intensityBase;
    private _color;
    private _distance;
    private _decay;
    constructor(params?: LightEmissionParams);
    init(storage: ParticleStorage): void;
    postUpdate(renderer: WebGPURenderer, liveCount: number): void;
    updateRender(liveCount: number, ctx: RenderContext): void;
    dispose(): void;
    toJSON(): ModuleJSON;
    static fromJSON(data: ModuleJSON): LightEmission;
}

/**
 * Prefab input — either a plain `SystemDef` (simple case) or a factory function that returns
 * a fresh `SystemDef` per invocation. Prefer the factory form: it ensures each new pooled
 * System instance gets its own renderer + module instances instead of sharing state with
 * sibling Systems (which breaks multi-spawn because renderers are stateful).
 */
type SystemDefInput = SystemDef | (() => SystemDef);
interface ManagerOptions {
    /** WebGPURenderer — required for GPU compute dispatch. */
    renderer: WebGPURenderer;
    /** Scene (or any Object3D) to which active systems are added. */
    scene: THREE.Object3D;
    /** Default camera passed to renderers (can be overridden per-tick). */
    camera?: THREE.Camera;
    /** Maximum number of concurrent active systems. Excess spawns are rejected. */
    maxActive?: number;
    /** Maximum number of inactive systems retained per prefab id for reuse. */
    maxPoolPer?: number;
    /** Global intensity multiplier applied to every system (0..1). */
    globalIntensity?: number;
    /**
     * If set, `Manager.tick(dt)` discretizes into integer steps of exactly `fixedTimestep`
     * seconds, using an internal accumulator to catch up. Identical inputs ⇒ identical output
     * regardless of the real-time delta — required for replays, deterministic tests, and the
     * editor's live preview.
     *
     * Leave unset for variable-timestep operation (default; passes `deltaTime` straight through).
     */
    fixedTimestep?: number;
    /**
     * Upper bound on accumulator size (in seconds) when `fixedTimestep` is set. Prevents the
     * "spiral of death" if the tab backgrounds for a long time and resumes with a huge
     * deltaTime. Anything beyond this is discarded. Default 0.25s.
     */
    maxAccumulatedTime?: number;
}
/**
 * Level-of-detail config attached to an active system. The Manager computes distance from
 * the camera each tick and scales intensity / toggles visibility accordingly:
 *
 * - `bounds`: radius of the bounding sphere centered at the system's world position, used
 *   for frustum culling. If unset, frustum culling is skipped for this system.
 * - `farFadeStart` + `maxDistance`: linear intensity ramp from 1.0 at `farFadeStart` down
 *   to 0.0 at `maxDistance`. Past `maxDistance` intensity stays at 0, which stops new
 *   particles from spawning — the system drains naturally as existing particles expire.
 *
 * Leaving `lod` unset preserves today's always-full-intensity, always-visible behavior.
 */
interface SystemCulling {
    /** Bounding-sphere radius at system origin for frustum culling. If unset, no frustum test. */
    bounds?: number;
    /** Distance at which the intensity fade begins. Default = `maxDistance` (no fade, hard cutoff). */
    farFadeStart?: number;
    /** Distance at/past which intensity reaches 0 and no new particles spawn. */
    maxDistance?: number;
}
type FollowSpace = "world" | "local";
interface FollowTarget {
    /**
     * Coordinate space of the returned position. `"world"` means `getPosition` already returns
     * a world-space socket point. `"local"` means the point is local to `parent` (or `scene`).
     * Default `"world"`.
     */
    space?: FollowSpace;
    /**
     * Write the current socket position into `out` and optionally return it. Reusing `out`
     * keeps the Manager path allocation-free.
     */
    getPosition(out: THREE.Vector3): THREE.Vector3Like | void;
}
interface SpawnOptions {
    position?: THREE.Vector3Like;
    quaternion?: THREE.QuaternionLike;
    scale?: THREE.Vector3Like | number;
    intensity?: number;
    parent?: THREE.Object3D;
    follow?: FollowTarget;
    /** Distance-based LOD + frustum culling config. See {@link SystemCulling}. */
    lod?: SystemCulling;
}
/**
 * Central VFX orchestrator. Holds prefab defs (registered by id), spawns pooled System instances
 * on demand, and drives them each tick. Mirrors chrome-runners' VFXManager shape for three.js.
 */
declare class Manager {
    renderer: WebGPURenderer;
    scene: THREE.Object3D;
    camera?: THREE.Camera;
    maxActive: number;
    maxPoolPer: number;
    globalIntensity: number;
    fixedTimestep?: number;
    maxAccumulatedTime: number;
    private _prefabs;
    private _pool;
    private _active;
    private _accum;
    private _frustum;
    private _frustumMatrix;
    private _cullSphere;
    private _cameraWorldPos;
    private _systemWorldPos;
    private _followWorldPos;
    private _batchBuffer;
    constructor(options: ManagerOptions);
    /**
     * Register a prefab by id. Accepts either a plain `SystemDef` or a factory `() => SystemDef`.
     * Factories are called once per newly-created System instance, giving each pooled System
     * its own renderer/module instances (required for correct multi-spawn rendering).
     */
    register(id: string, def: SystemDefInput): void;
    /**
     * Remove a prefab registration and dispose any inactive pooled instances for it.
     * Active instances are left alone; call `clear()` first when replacing a live preview.
     */
    unregister(id: string): void;
    /**
     * Preload pooled instances of a prefab for hot spawning — also warms their compute
     * pipelines so the first real spawn doesn't stall. Respects `maxPoolPer`; if `count` is
     * higher, the pool is capped and the rest are discarded. Call this for prefabs you plan
     * to spawn in bursts (e.g. a wave of explosions) so the user doesn't see a compile hitch.
     */
    preload(id: string, count?: number): Promise<void>;
    /**
     * Pre-compile registered prefabs' compute kernels AND render pipelines against the
     * renderer. Call once after registering prefabs (and ideally before first user interaction)
     * so that the first real spawn doesn't stall on WGSL → MSL/HLSL translation. Heavy emitters
     * (especially `sortByDepth: true`) can otherwise cost multiple seconds on first play.
     *
     * Pass `ids` to warm only those prefabs (e.g. the ones a level uses); the default is every
     * registered prefab. Throws if an id isn't registered.
     *
     * Two pipeline classes to warm:
     *  1. Compute kernels (spawn/update/sort) — dispatched via `Emitter.warmup`.
     *  2. Render materials (sprite/mesh/ribbon) — compiled via `renderer.compileAsync(scene)`.
     *     We attach each warmed System's object3D to the scene temporarily so its materials
     *     are walked and pre-compiled, then detach afterward.
     */
    warmup(ids?: Iterable<string>): Promise<void>;
    private _createSystem;
    has(id: string): boolean;
    /** Spawn a registered prefab. Returns the System or null if at capacity / unknown id. */
    spawn(id: string, options?: SpawnOptions): System | null;
    /**
     * Advance all active systems. Call once per frame before renderer.render().
     *
     * If `fixedTimestep` is set on construction, this accumulates `deltaTime` and dispatches
     * as many whole fixed-length steps as the accumulator allows — guaranteeing deterministic
     * output across framerate variation. Any remainder stays in the accumulator for next call.
     * If `fixedTimestep` is unset, the call delegates to `_stepOnce(deltaTime, ...)` as-is.
     */
    tick(deltaTime: number, camera?: THREE.Camera): void;
    /** Reset the fixed-timestep accumulator. Call after seeking/scrubbing to avoid step backlog. */
    resetClock(): void;
    private _stepOnce;
    /** Hard-stop every active system and return them to the pool. */
    clear(): void;
    /** Dispose every system (pool + active) and release GPU resources. */
    dispose(): void;
    private _getPool;
    private _syncFollow;
}

/** Versioned top-level system blob. */
interface SystemJSON {
    /** Format version. Bumped on breaking changes. */
    version: 1;
    name?: string;
    duration?: number;
    loop?: boolean;
    emitters: EmitterJSON[];
}
interface EmitterJSON {
    name?: string;
    capacity: number;
    seed?: number;
    duration?: number;
    loop?: boolean;
    events?: EmitterEventConfig;
    sortByDepth?: boolean;
    spawn: ModuleJSON[];
    init: ModuleJSON[];
    update: ModuleJSON[];
    render: ModuleJSON;
}
/** Serialize a System *definition* — operates on SystemDef, not a live System instance. */
declare function systemDefToJSON(def: SystemDef): SystemJSON;
declare function emitterDefToJSON(def: EmitterDef): EmitterJSON;
/** Deserialize into a SystemDef (module instances are rebuilt via the registry). */
declare function systemDefFromJSON(json: SystemJSON): SystemDef;
declare function emitterDefFromJSON(json: EmitterJSON): EmitterDef;

/**
 * Fluent authoring API — sugar on top of `SystemDef` / `EmitterDef` and the module classes.
 *
 * Two entry points:
 *  - `system(name?)` → `SystemBuilder` for defining a full VFX system.
 *  - `emitter(name?)` → `EmitterBuilder` for defining one emitter in isolation.
 *
 * Both builders are chainable; call `.build()` to produce a plain `SystemDef` / `EmitterDef`.
 * Nothing is bundled — the builder just collects modules in call order and hands them off to
 * the same structures the class-based API uses. JSON serialization, the registry, everything
 * downstream still works unchanged.
 *
 * Example:
 * ```ts
 * const def = system("smoke")
 *   .duration(2)
 *   .emitter("puff", (e) =>
 *     e.capacity(128)
 *       .spawnRate(25)
 *       .lifetime({ min: 1.8, max: 2.8 })
 *       .position({ shape: { kind: "sphere", radius: 0.08 } })
 *       .velocity({ shape: { kind: "cone", angle: 0.18 * Math.PI }, speed: { min: 0.3, max: 1 } })
 *       .size({ min: 0.35, max: 0.7 })
 *       .color({ min: [0.65, 0.65, 0.68], max: [0.85, 0.85, 0.9] }, { alpha: 0.35 })
 *       .integrate()
 *       .drag(0.4)
 *       .gravity([0, 0.5, 0])
 *       .sizeOverLife([[0, 0.8], [0.5, 1.4], [1, 2.0]])
 *       .alphaOverLife([[0, 0], [0.2, 1], [1, 0]])
 *       .lifetimeTick()
 *       .renderSprite({ blending: "alpha", opacity: 0.9, depthWrite: false }),
 *   )
 *   .build();
 * ```
 */

/** Accepts a plain number, a `{min, max}` range, or a full `ScalarInput`. */
type ScalarLike = number | {
    min: number;
    max: number;
} | ScalarInput;
/** Accepts a tuple, a min/max range of tuples, or a full `Vec3Input`. */
type Vec3Like = Vec3Tuple | {
    min: Vec3Tuple;
    max: Vec3Tuple;
} | Vec3Input;
/** Accepts a 3-tuple, a min/max range, or a full `ColorInput`. */
type ColorLike = ColorTuple | {
    min: ColorTuple;
    max: ColorTuple;
} | ColorInput;
/**
 * Curve input. Accepts:
 *  - an existing `Curve1D`
 *  - a plain number (becomes a constant)
 *  - an array of `[t, v]` pairs (e.g. `[[0, 0.5], [1, 1]]`)
 *  - an array of `{t, v}` keyframes
 */
type CurveLike = Curve1D | number | [number, number][] | CurveKeyframe[];
/** Gradient input. Accepts an existing `Gradient` or an array of stops. */
type GradientLike = Gradient | GradientStop[];
type TrailGradientLike = Gradient | Array<GradientStop | [number, ColorTuple | ColorRGBATuple]>;
type TrailRibbonParams = Omit<RibbonRendererParams, "historyLength" | "sampleRate" | "minDistance" | "sampleLifetime" | "sampleUntil" | "widthOverLife" | "alphaOverLife" | "colorOverLife">;
declare function toScalarInput(input: ScalarLike): ScalarInput;
declare function toVec3Input(input: Vec3Like): Vec3Input;
declare function toColorInput(input: ColorLike): ColorInput;
declare function toCurve(input: CurveLike): Curve1D;
declare function toGradient(input: GradientLike): Gradient;
declare class EmitterBuilder {
    private _name?;
    private _capacity;
    private _duration?;
    private _loop?;
    private _seed?;
    private _sortByDepth;
    private _events?;
    private _spawn;
    private _init;
    private _update;
    private _render?;
    constructor(name?: string);
    name(value: string): this;
    capacity(value: number): this;
    duration(seconds: number): this;
    loop(value?: boolean): this;
    seed(value: number): this;
    sortByDepth(value?: boolean): this;
    emitEvents(config?: EmitterEventConfig): this;
    spawnRate(rate: number): this;
    spawnBurst(bursts: SpawnBurstEntry | SpawnBurstEntry[]): this;
    spawnFromEvents(source: Emitter | string, perEvent?: number, maxEventsPerFrame?: number): this;
    lifetime(input: ScalarLike): this;
    position(params: {
        shape: EmissionShape;
        worldSpace?: boolean;
        offset?: [number, number, number];
    }): this;
    velocity(params: {
        shape: EmissionShape;
        speed: ScalarLike;
        worldSpace?: boolean;
    }): this;
    size(input: ScalarLike): this;
    rotation(input: ScalarLike, opts?: {
        angularVelocity?: ScalarLike;
    }): this;
    color(color: ColorLike, opts?: {
        alpha?: ScalarLike;
    }): this;
    fromMesh(params: InitFromMeshParams): this;
    integrate(): this;
    lifetimeTick(): this;
    gravity(acceleration?: Vec3Tuple | number): this;
    drag(coefficient: number): this;
    colorOverLife(gradient: GradientLike): this;
    sizeOverLife(curve: CurveLike): this;
    alphaOverLife(curve: CurveLike): this;
    velocityOverLife(curve: CurveLike): this;
    followPosition(): this;
    turbulence(params: TurbulenceForceParams): this;
    curlNoise(params: CurlNoiseForceParams): this;
    vortex(params: VortexForceParams): this;
    pointAttractor(params: PointAttractorParams): this;
    scaleBySpeed(params: ScaleBySpeedParams): this;
    planeCollision(params?: PlaneCollisionParams): this;
    sphereCollision(params: SphereCollisionParams): this;
    depthCollision(params: DepthCollisionParams): this;
    sdfCollision(params: SdfCollisionParams): this;
    flowmapForce(params: FlowmapForceParams): this;
    limitVelocity(params: LimitVelocityParams | number): this;
    renderSprite(params?: SpriteRendererParams): this;
    renderMesh(params: MeshRendererParams): this;
    renderRibbon(params?: RibbonRendererParams): this;
    renderBeam(params?: BeamRendererParams): this;
    renderLight(params?: LightEmissionParams): this;
    /** Attach a pre-constructed render module instance (e.g. one you already configured by hand). */
    renderWith(module: RenderModule): this;
    build(): EmitterDef;
}
declare class TrailBuilder {
    private _name?;
    private _capacity;
    private _sampleRate;
    private _minDistance;
    private _lifetime;
    private _widthOverLife;
    private _alphaOverLife;
    private _colorOverLife;
    private _renderParams;
    constructor(name?: string);
    name(value: string): this;
    capacity(value: number): this;
    sampleRate(value: number): this;
    minDistance(value: number): this;
    lifetime(seconds: number): this;
    widthOverLife(curve: CurveLike): this;
    alphaOverLife(curve: CurveLike): this;
    colorOverLife(gradient: TrailGradientLike): this;
    renderRibbon(params?: TrailRibbonParams & {
        layers?: RibbonLayerParams[];
    }): this;
    build(systemDuration?: number): EmitterDef;
}
declare class SystemBuilder {
    private _name?;
    private _duration?;
    private _loop?;
    private _emitters;
    private _trailFactories;
    constructor(name?: string);
    name(value: string): this;
    duration(seconds: number): this;
    loop(value?: boolean): this;
    /**
     * Add an emitter. Two forms:
     *  1. `.emitter("name", (e) => e.capacity(...).spawnRate(...)...)` — callback form; builder
     *     is scoped to the callback and `.build()` is called for you.
     *  2. `.emitter(alreadyBuiltEmitterBuilder)` or `.emitter(emitterDef)` — pass-through for
     *     composing pre-built emitters.
     */
    emitter(name: string, build: (e: EmitterBuilder) => EmitterBuilder): this;
    emitter(build: (e: EmitterBuilder) => EmitterBuilder): this;
    emitter(builder: EmitterBuilder): this;
    emitter(def: EmitterDef): this;
    trail(name: string, build: (trail: TrailBuilder) => TrailBuilder): this;
    trail(build: (trail: TrailBuilder) => TrailBuilder): this;
    build(): SystemDef;
}
declare function system(name?: string): SystemBuilder;
declare function emitter(name?: string): EmitterBuilder;

/**
 * Shader dump / debug helpers.
 *
 * Three.js exposes `renderer.debug.getShaderAsync(scene, camera, object)` for render
 * pipelines. For compute pipelines it doesn't have a public getter — but the generated
 * WGSL is cached on `renderer._nodes.getForCompute(kernel).computeShader` after first
 * dispatch (which is what three's own backend reads from). We surface both behind a
 * single `dumpShaders()` entry point.
 *
 * Usage:
 * ```ts
 * const dump = await dumpShaders(renderer, system, { camera });
 * console.log(dump.markdown());
 * // or download it:
 * new Blob([dump.markdown()], { type: "text/markdown" });
 * ```
 */

interface EmitterShaderDump {
    /** Emitter name (or `"<anon>"`). */
    name: string;
    /** Generated WGSL for the spawn compute kernel. */
    spawn: string | null;
    /** Generated WGSL for the update compute kernel. */
    update: string | null;
    /** Generated WGSL for the sort-key compute kernel. Only present when `sortByDepth`. */
    sort: string | null;
    /** Generated WGSL for the event-reset compute kernel. Only present when `events.onDeath`. */
    resetEvents: string | null;
    /** Render pipeline vertex + fragment shaders. `null` when no draw object found. */
    render: {
        vertex: string | null;
        fragment: string | null;
    } | null;
}
interface ShaderDump {
    emitters: EmitterShaderDump[];
    /** Pretty-printed markdown — good for console.log, saving to file, or displaying in UI. */
    markdown(): string;
}
interface DumpOptions {
    /** Camera passed to `renderer.debug.getShaderAsync`. Required for render shaders. */
    camera?: THREE.Camera;
    /** Scene containing the emitter's render meshes. Defaults to a fresh scene holding the emitter. */
    scene?: THREE.Scene;
}
/**
 * Extract every shader associated with a `System` or a single `Emitter`. Kernels must have
 * been dispatched at least once (via `Emitter.warmup()` or a normal frame) before their
 * WGSL is cached — call `Manager.warmup()` first for reliable output.
 */
declare function dumpShaders(renderer: WebGPURenderer, target: System | Emitter, options?: DumpOptions): Promise<ShaderDump>;

/** Procedurally generated soft circle texture (radial gradient). Cached. */
declare function softCircleTexture(size?: number): THREE.Texture;
/** Sharp circle (hard disc). */
declare function circleTexture(size?: number): THREE.Texture;
/** Directional streak (useful for sparks/tracers). 4:1 aspect ratio. */
declare function streakTexture(width?: number, height?: number): THREE.Texture;
declare function disposeTextureCache(): void;

export { AlphaOverLife, type AlphaOverLifeParams, type BeamBlendMode, BeamRenderer, type BeamRendererParams, ColorInput, type ColorLike, ColorNodeFn, ColorOverLife, type ColorOverLifeParams, ColorRGBATuple, ColorTuple, CurlNoiseForce, type CurlNoiseForceParams, Curve1D, type CurveKeyframe, type CurveLike, DepthCollision, type DepthCollisionMode, type DepthCollisionNormal, type DepthCollisionParams, Drag, type DragParams, type DumpOptions, EmissionShape, Emitter, EmitterBuilder, EmitterContext, EmitterDef, EmitterEventConfig, type EmitterJSON, type EmitterShaderDump, EmitterSpawnModule, type FlowmapAxis, FlowmapForce, type FlowmapForceParams, FollowPosition, type FollowPositionParams, type FollowSpace, type FollowTarget, Gradient, type GradientLike, type GradientStop, Gravity, type GravityParams, InitColor, type InitColorParams, InitFromMesh, type InitFromMeshFill, type InitFromMeshParams, InitLifetime, type InitLifetimeParams, InitPosition, type InitPositionParams, InitRotation, type InitRotationParams, InitSize, type InitSizeParams, InitVelocity, type InitVelocityParams, LifetimeTick, LightEmission, type LightEmissionParams, LimitVelocity, type LimitVelocityParams, Manager, type ManagerOptions, MeshRenderer, type MeshRendererParams, Module, ModuleFactory, ModuleJSON, ParticleSpawnModule, ParticleStorage, ParticleUpdateModule, PlaneCollision, type PlaneCollisionParams, PointAttractor, type PointAttractorFalloff, type PointAttractorParams, RNG, RenderContext, RenderModule, type RibbonBlendMode, type RibbonLayerParams, RibbonRenderer, type RibbonRendererParams, ScalarInput, type ScalarLike, ScaleBySpeed, type ScaleBySpeedParams, SdfCollision, type SdfCollisionMode, type SdfCollisionParams, type SdfFn, type ShaderDump, SizeOverLife, type SizeOverLifeParams, SpawnBurst, type SpawnBurstEntry, type SpawnBurstParams, SpawnFromEvents, type SpawnFromEventsParams, SpawnInitContext, type SpawnOptions, SpawnRate, type SpawnRateParams, SphereCollision, type SphereCollisionParams, type SpriteAnimationParams, type SpriteBlendMode, type SpriteOrientation, SpriteRenderer, type SpriteRendererParams, System, SystemBuilder, type SystemCulling, SystemDef, type SystemJSON, TextureInput, TrailBuilder, type TrailGradientLike, type TrailRibbonParams, TurbulenceForce, type TurbulenceForceParams, UpdateContext, Vec3Input, type Vec3Like, Vec3Tuple, VelocityIntegrator, VelocityOverLife, type VelocityOverLifeParams, VortexForce, type VortexForceParams, circleTexture, disposeTextureCache, dumpShaders, emitter, emitterDefFromJSON, emitterDefToJSON, getModuleFactory, listRegisteredModules, moduleFromJSON, registerModule, sampleColor, sampleScalar, sampleVec3, sdfBox, sdfIntersect, sdfPlane, sdfSphere, sdfSubtract, sdfUnion, softCircleTexture, streakTexture, system, systemDefFromJSON, systemDefToJSON, toColorInput, toCurve, toGradient, toScalarInput, toVec3Input, unregisterModule };
