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
 * and dissolve the cloud. Particle RGB multiplies the shaded colour, so ColorOverLife tints.
 * Use alpha blending.
 */

import { cos, float, length, max, mix, pow, screenUV, sin, step, vec2, vec3, vec4 } from "three/tsl";
import type { Node } from "three/webgpu";
import type { ColorNodeContext, ColorNodeFn } from "three-plume";
import * as THREE from "three";
import { getTexture } from "./textures.js";

export const CLOUD_NOISE_TEXTURE_KEY = "cloudNoise";
const CLOUD_NOISE_TEXTURE_URL = "/textures/voronoi_08_512.png";

/** The Mapping rotation drivers are `frame / n` at the Blender scene's 24 fps. */
const BLENDER_FPS = 24;
const SHADOW_COLOR = vec3(0.7423, 0.8577, 1.0);
const LIGHT_COLOR = vec3(1, 1, 1);
const SHADOW_TO_LIGHT_AT = 0.082;
const CLOUDS_CUTOUT = 0.05;
const IMPACT_CUTOUT = 0.3;

type Float = Node<"float">;
type Vec2 = Node<"vec2">;

export function getCloudNoiseTexture(): THREE.Texture {
  return getTexture(CLOUD_NOISE_TEXTURE_URL);
}

export function cloudsColorNode(): ColorNodeFn {
  return (ctx) => {
    const noise = cloudNoise(ctx);
    const density = ctx.particle.color.a.mul(sphereGradient(ctx.uv)).mul(noise).clamp(0, 1);
    return shadeCloud(ctx, density, step(CLOUDS_CUTOUT, density));
  };
}

export function impactCloudColorNode(): ColorNodeFn {
  return (ctx) => {
    const noise = cloudNoise(ctx);
    const g = sphereGradient(ctx.uv);
    const ring = g.mul(float(1).sub(g));
    const rim = pow(max(pow(ring, 2.5).div(0.5).clamp(0, 1), 1e-6), 0.6).clamp(0, 1);
    const body = screenBlend(ring.mul(noise), rim);
    const density = ctx.particle.color.a.mul(body).clamp(0, 1);
    return shadeCloud(ctx, density, step(IMPACT_CUTOUT, body));
  };
}

function cloudNoise(ctx: ColorNodeContext): Float {
  const tex = ctx.textures[CLOUD_NOISE_TEXTURE_KEY];
  const frame = ctx.particle.age.mul(BLENDER_FPS);
  const centred = ctx.uv.sub(0.5);
  const sample = (scale: number, framesPerRadian: number) =>
    tex.sample(rotateScaled(centred, scale, frame.div(framesPerRadian))).r;
  const a = sample(0.8, 50).mul(sample(0.5, 100)).mul(2.5);
  const b = sample(0.2, 75).mul(sample(0.4, 200)).mul(2.5);
  return a.mul(b).mul(2.5);
}

function shadeCloud(ctx: ColorNodeContext, density: Float, cutout: Float): Node<"vec4"> {
  const windowY = float(1).sub(screenUV.y);
  const shade = softLight(density, windowY.div(1.5).clamp(0, 1));
  const rgb = mix(SHADOW_COLOR, LIGHT_COLOR, step(SHADOW_TO_LIGHT_AT, shade));
  return vec4(rgb.mul(ctx.particle.color.rgb), cutout);
}

/** Blender Mapping node (Point): scale, then rotate about Z. */
function rotateScaled(v: Vec2, scale: number, angle: Float): Vec2 {
  const s = v.mul(scale);
  const c = cos(angle);
  const n = sin(angle);
  return vec2(s.x.mul(c).sub(s.y.mul(n)), s.x.mul(n).add(s.y.mul(c)));
}

/** Blender spherical Gradient Texture over UV remapped to -1..1. */
function sphereGradient(uv: Vec2): Float {
  return max(float(0.999999).sub(length(uv.mul(2).sub(1))), 0);
}

function softLight(a: Float, b: Float): Float {
  const inv = float(1).sub(a);
  const scr = float(1).sub(float(1).sub(b).mul(inv));
  return inv.mul(b).mul(a).add(a.mul(scr));
}

function screenBlend(a: Float, b: Float): Float {
  return float(1).sub(float(1).sub(a).mul(float(1).sub(b)));
}
