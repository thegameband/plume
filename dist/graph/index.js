import { system, Curve1D, sdfPlane, sdfBox, sdfSphere, Gradient } from '../chunk-3YJ3NTIL.js';
import * as THREE3 from 'three';
import { vec3, step, float, pow, max, mix, screenUV, vec4, length, vec2, smoothstep, mx_noise_float, Fn, positionLocal, time, cos, sin } from 'three/tsl';
import { MeshBasicNodeMaterial, MeshStandardNodeMaterial } from 'three/webgpu';

// src/graph/nodes.ts
function fadeCurve(fadeIn, fadeOut) {
  const start = Math.max(0, Math.min(1, fadeIn));
  const end = 1 - Math.max(0, Math.min(1, fadeOut));
  if (start >= end) {
    return {
      kind: "curve1d",
      keys: [
        { t: 0, v: 1 },
        { t: 1, v: 1 }
      ]
    };
  }
  return {
    kind: "curve1d",
    keys: [
      { t: 0, v: 0 },
      { t: start, v: 1 },
      { t: end, v: 1 },
      { t: 1, v: 0 }
    ]
  };
}
function migrateParams(type, params) {
  if (type === "update.alpha_over_life" && !("curve" in params)) {
    const { fadeIn, fadeOut, ...rest } = params;
    return {
      ...rest,
      curve: fadeCurve(
        typeof fadeIn === "number" ? fadeIn : 0.1,
        typeof fadeOut === "number" ? fadeOut : 0.3
      ),
      clampToOne: true
    };
  }
  return params;
}
var CAT_COLORS = {
  emitter: "#2c5b8c",
  spawn: "#8c5b2c",
  init: "#2c8c5b",
  update: "#5b2c8c",
  render: "#8c2c5b"
};
var NODE_SPECS = [
  // ─────────────────────────────────────────────────────────────────────────
  // Emitter root — exactly one per graph (compiler enforces).
  // ─────────────────────────────────────────────────────────────────────────
  {
    type: "emitter",
    category: "emitter",
    label: "Emitter",
    accent: CAT_COLORS.emitter,
    fields: [
      { kind: "number", key: "capacity", label: "Capacity", min: 16, max: 4096, step: 16 },
      { kind: "number", key: "duration", label: "Duration (s)", min: 0.05, max: 30, step: 0.05 },
      { kind: "vec3", key: "spawnOrigin", label: "Spawn origin", step: 0.1 },
      { kind: "boolean", key: "loop", label: "Loop on its own duration" }
    ],
    defaults: { capacity: 256, duration: 2, spawnOrigin: [0, 0.5, 0], loop: true }
  },
  // ─────────────────────────────────────────────────────────────────────────
  // Spawn (CPU-side: how many particles per tick)
  // ─────────────────────────────────────────────────────────────────────────
  {
    type: "spawn.rate",
    category: "spawn",
    label: "SpawnRate",
    accent: CAT_COLORS.spawn,
    fields: [{ kind: "number", key: "rate", label: "Rate (per sec)", min: 0, max: 2e3, step: 1 }],
    defaults: { rate: 50 }
  },
  {
    type: "spawn.burst",
    category: "spawn",
    label: "SpawnBurst",
    accent: CAT_COLORS.spawn,
    fields: [
      { kind: "number", key: "time", label: "Time (s)", min: 0, max: 30, step: 0.05 },
      { kind: "number", key: "count", label: "Count", min: 1, max: 4096, step: 1 }
    ],
    defaults: { time: 0, count: 100 }
  },
  {
    type: "spawn.from_events",
    category: "spawn",
    label: "SpawnFromEvents",
    accent: CAT_COLORS.spawn,
    fields: [
      { kind: "emitter-ref", key: "source", label: "Source emitter" },
      { kind: "number", key: "perEvent", label: "Per event", min: 1, max: 1024, step: 1 },
      {
        kind: "number",
        key: "maxEventsPerFrame",
        label: "Max events / frame",
        min: 1,
        max: 1024,
        step: 1
      },
      { kind: "boolean", key: "inheritVelocity", label: "Inherit velocity from event" }
    ],
    defaults: {
      source: { kind: "emitter-ref", nodeId: void 0 },
      perEvent: 6,
      maxEventsPerFrame: 64,
      inheritVelocity: false
    }
  },
  // ─────────────────────────────────────────────────────────────────────────
  // Init (per-new-particle TSL)
  // ─────────────────────────────────────────────────────────────────────────
  {
    type: "init.lifetime",
    category: "init",
    label: "InitLifetime",
    accent: CAT_COLORS.init,
    fields: [
      { kind: "range", key: "lifetime", label: "Lifetime (s)", min: 0.1, max: 30, step: 0.05 }
    ],
    defaults: { lifetime: [1, 2] }
  },
  {
    type: "init.position",
    category: "init",
    label: "InitPosition",
    accent: CAT_COLORS.init,
    fields: [
      { kind: "shape", key: "shape", label: "Shape" },
      { kind: "vec3", key: "offset", label: "Offset (X, Y, Z)", step: 0.01 },
      { kind: "boolean", key: "worldSpace", label: "World space" }
    ],
    defaults: {
      shape: { kind: "sphere", radius: 0.3, thickness: 1 },
      offset: [0, 0, 0],
      worldSpace: false
    }
  },
  {
    type: "init.velocity",
    category: "init",
    label: "InitVelocity",
    accent: CAT_COLORS.init,
    fields: [
      { kind: "shape", key: "shape", label: "Shape" },
      { kind: "range", key: "speed", label: "Speed", min: 0, max: 50, step: 0.1 },
      { kind: "boolean", key: "worldSpace", label: "World space" }
    ],
    defaults: {
      shape: { kind: "cone", angle: 0.3 },
      speed: [1, 3],
      worldSpace: false
    }
  },
  {
    type: "init.size",
    category: "init",
    label: "InitSize",
    accent: CAT_COLORS.init,
    fields: [{ kind: "range", key: "size", label: "Size", min: 0.01, max: 5, step: 0.01 }],
    defaults: { size: [0.1, 0.3] }
  },
  {
    type: "init.color",
    category: "init",
    label: "InitColor",
    accent: CAT_COLORS.init,
    fields: [
      { kind: "color", key: "color", label: "Color (or min)" },
      { kind: "color", key: "colorMax", label: "Color max (optional)" },
      { kind: "select", key: "mode", label: "Mode", options: ["solid", "random range"] },
      { kind: "number", key: "alpha", label: "Alpha", min: 0, max: 1, step: 0.01 }
    ],
    defaults: { color: [1, 1, 1], colorMax: [1, 1, 1], mode: "solid", alpha: 1 }
  },
  {
    type: "init.rotation",
    category: "init",
    label: "InitRotation",
    accent: CAT_COLORS.init,
    fields: [
      { kind: "range", key: "rotation", label: "Rotation (rad)", min: 0, max: 6.283, step: 0.05 },
      {
        kind: "range",
        key: "angularVelocity",
        label: "Angular velocity (rad/s)",
        min: -20,
        max: 20,
        step: 0.05
      }
    ],
    defaults: { rotation: [0, 6.283], angularVelocity: [0, 0] }
  },
  {
    type: "init.from_mesh",
    category: "init",
    label: "InitFromMesh",
    accent: CAT_COLORS.init,
    fields: [
      { kind: "geometry", key: "geometry", label: "Source geometry" },
      { kind: "select", key: "fill", label: "Fill mode", options: ["surface", "volume"] },
      { kind: "boolean", key: "worldSpace", label: "World space" },
      {
        kind: "number",
        key: "volumeSampleCount",
        label: "Volume samples (volume mode)",
        min: 256,
        max: 8192,
        step: 256
      }
    ],
    defaults: {
      geometry: {
        kind: "geometry",
        preset: "sphere",
        radius: 0.5,
        widthSegments: 32,
        heightSegments: 16
      },
      fill: "surface",
      worldSpace: false,
      volumeSampleCount: 2048
    }
  },
  // ─────────────────────────────────────────────────────────────────────────
  // Update (per-live-particle TSL each frame)
  // ─────────────────────────────────────────────────────────────────────────
  {
    type: "update.integrate",
    category: "update",
    label: "VelocityIntegrator",
    accent: CAT_COLORS.update,
    fields: [],
    defaults: {}
  },
  {
    type: "update.gravity",
    category: "update",
    label: "Gravity",
    accent: CAT_COLORS.update,
    fields: [{ kind: "vec3", key: "acceleration", label: "Acceleration", step: 0.1 }],
    defaults: { acceleration: [0, -9.81, 0] }
  },
  {
    type: "update.drag",
    category: "update",
    label: "Drag",
    accent: CAT_COLORS.update,
    fields: [
      { kind: "number", key: "coefficient", label: "Coefficient", min: 0, max: 10, step: 0.05 }
    ],
    defaults: { coefficient: 0.5 }
  },
  {
    type: "update.alpha_over_life",
    category: "update",
    label: "AlphaOverLife",
    accent: CAT_COLORS.update,
    fields: [
      { kind: "curve", key: "curve", label: "Alpha over life" },
      // Off lets shaders that read alpha as a parameter (e.g. clouds' Opacity Control)
      // be overdriven; plain alpha-blended shaders misbehave above 1.
      { kind: "boolean", key: "clampToOne", label: "Clamp values to 1" }
    ],
    defaults: { curve: fadeCurve(0.1, 0.3), clampToOne: true }
  },
  {
    type: "update.size_over_life",
    category: "update",
    label: "SizeOverLife",
    accent: CAT_COLORS.update,
    fields: [{ kind: "curve", key: "curve", label: "Scale over life" }],
    defaults: {
      curve: {
        kind: "curve1d",
        keys: [
          { t: 0, v: 1 },
          { t: 1, v: 0.5 }
        ]
      }
    }
  },
  {
    type: "update.velocity_over_life",
    category: "update",
    label: "VelocityOverLife",
    accent: CAT_COLORS.update,
    fields: [{ kind: "curve", key: "curve", label: "Speed multiplier" }],
    defaults: {
      curve: {
        kind: "curve1d",
        keys: [
          { t: 0, v: 1 },
          { t: 1, v: 0 }
        ]
      }
    }
  },
  {
    type: "update.color_over_life",
    category: "update",
    label: "ColorOverLife",
    accent: CAT_COLORS.update,
    fields: [{ kind: "gradient", key: "gradient", label: "Colour over life" }],
    defaults: {
      gradient: {
        kind: "gradient",
        stops: [
          { t: 0, color: [1, 1, 1, 1] },
          { t: 1, color: [1, 0.4, 0.1, 0] }
        ]
      }
    }
  },
  {
    type: "update.curl_noise",
    category: "update",
    label: "CurlNoiseForce",
    accent: CAT_COLORS.update,
    fields: [
      { kind: "number", key: "amplitude", label: "Amplitude (u/s\xB2)", min: 0, max: 50, step: 0.1 },
      { kind: "number", key: "frequency", label: "Frequency", min: 0.01, max: 10, step: 0.01 },
      { kind: "number", key: "speed", label: "Speed", min: 0, max: 5, step: 0.05 }
    ],
    defaults: { amplitude: 2, frequency: 1, speed: 0.5 }
  },
  {
    type: "update.turbulence",
    category: "update",
    label: "TurbulenceForce",
    accent: CAT_COLORS.update,
    fields: [
      { kind: "number", key: "amplitude", label: "Amplitude (u/s\xB2)", min: 0, max: 50, step: 0.1 },
      { kind: "number", key: "frequency", label: "Frequency", min: 0.01, max: 10, step: 0.01 },
      { kind: "number", key: "speed", label: "Speed", min: 0, max: 5, step: 0.05 },
      { kind: "number", key: "octaves", label: "Octaves", min: 1, max: 6, step: 1 }
    ],
    defaults: { amplitude: 2, frequency: 1, speed: 0.5, octaves: 3 }
  },
  {
    type: "update.vortex",
    category: "update",
    label: "VortexForce",
    accent: CAT_COLORS.update,
    fields: [
      { kind: "vec3", key: "axis", label: "Axis", step: 0.1 },
      { kind: "vec3", key: "origin", label: "Origin", step: 0.1 },
      { kind: "number", key: "strength", label: "Strength (u/s\xB2)", min: -50, max: 50, step: 0.1 },
      { kind: "boolean", key: "worldSpace", label: "World space" }
    ],
    defaults: { axis: [0, 1, 0], origin: [0, 0, 0], strength: 5, worldSpace: false }
  },
  {
    type: "update.point_attractor",
    category: "update",
    label: "PointAttractor",
    accent: CAT_COLORS.update,
    fields: [
      { kind: "vec3", key: "position", label: "Position", step: 0.1 },
      { kind: "number", key: "strength", label: "Strength (u/s\xB2)", min: -50, max: 50, step: 0.1 },
      { kind: "number", key: "radius", label: "Radius", min: 0.01, max: 50, step: 0.05 },
      {
        kind: "select",
        key: "falloff",
        label: "Falloff",
        options: ["none", "linear", "inverse", "inverseSquared"]
      },
      { kind: "boolean", key: "worldSpace", label: "World space" }
    ],
    defaults: {
      position: [0, 0, 0],
      strength: 5,
      radius: 2,
      falloff: "inverseSquared",
      worldSpace: false
    }
  },
  {
    type: "update.limit_velocity",
    category: "update",
    label: "LimitVelocity",
    accent: CAT_COLORS.update,
    fields: [
      { kind: "number", key: "maxSpeed", label: "Max speed (u/s)", min: 0, max: 100, step: 0.1 },
      { kind: "number", key: "damping", label: "Damping", min: 0, max: 1, step: 0.01 }
    ],
    defaults: { maxSpeed: 10, damping: 1 }
  },
  {
    type: "update.scale_by_speed",
    category: "update",
    label: "ScaleBySpeed",
    accent: CAT_COLORS.update,
    fields: [
      { kind: "number", key: "minSpeed", label: "Min speed", min: 0, max: 50, step: 0.05 },
      { kind: "number", key: "maxSpeed", label: "Max speed", min: 0, max: 50, step: 0.05 },
      { kind: "number", key: "minScale", label: "Min scale", min: 0, max: 5, step: 0.05 },
      { kind: "number", key: "maxScale", label: "Max scale", min: 0, max: 5, step: 0.05 }
    ],
    defaults: { minSpeed: 0, maxSpeed: 5, minScale: 1, maxScale: 2 }
  },
  {
    type: "update.plane_collision",
    category: "update",
    label: "PlaneCollision",
    accent: CAT_COLORS.update,
    fields: [
      { kind: "vec3", key: "normal", label: "Normal", step: 0.1 },
      { kind: "vec3", key: "point", label: "Point on plane", step: 0.1 },
      { kind: "number", key: "restitution", label: "Restitution", min: 0, max: 1, step: 0.01 },
      { kind: "number", key: "friction", label: "Friction", min: 0, max: 1, step: 0.01 },
      { kind: "boolean", key: "worldSpace", label: "World space" }
    ],
    defaults: {
      normal: [0, 1, 0],
      point: [0, 0, 0],
      restitution: 0.5,
      friction: 0.9,
      worldSpace: false
    }
  },
  {
    type: "update.sdf_collision",
    category: "update",
    label: "SDFCollision",
    accent: CAT_COLORS.update,
    fields: [
      { kind: "sdf", key: "sdf", label: "Surface" },
      { kind: "select", key: "mode", label: "Mode", options: ["bounce", "stop", "kill"] },
      { kind: "number", key: "restitution", label: "Restitution", min: 0, max: 1, step: 0.01 },
      { kind: "number", key: "friction", label: "Friction", min: 0, max: 1, step: 0.01 },
      { kind: "number", key: "thickness", label: "Thickness", min: 0, max: 0.5, step: 5e-3 },
      {
        kind: "number",
        key: "gradientEpsilon",
        label: "Gradient \u03B5",
        min: 1e-3,
        max: 0.1,
        step: 1e-3
      }
    ],
    defaults: {
      sdf: { kind: "sdf", preset: "sphere", center: [0, 0, 0], radius: 1 },
      mode: "bounce",
      restitution: 0.5,
      friction: 0.9,
      thickness: 0.02,
      gradientEpsilon: 0.01
    }
  },
  {
    type: "update.depth_collision",
    category: "update",
    label: "DepthCollision",
    accent: CAT_COLORS.update,
    fields: [
      { kind: "select", key: "mode", label: "Mode", options: ["bounce", "stop", "kill"] },
      {
        kind: "select",
        key: "normal",
        label: "Surface normal",
        options: ["depth-gradient", "camera"]
      },
      { kind: "number", key: "restitution", label: "Restitution", min: 0, max: 1, step: 0.01 },
      { kind: "number", key: "friction", label: "Friction", min: 0, max: 1, step: 0.01 },
      {
        kind: "number",
        key: "thickness",
        label: "Thickness (NDC)",
        min: 0,
        max: 0.01,
        step: 1e-4
      }
    ],
    defaults: {
      mode: "bounce",
      normal: "depth-gradient",
      restitution: 0.5,
      friction: 0.9,
      thickness: 5e-4
    }
  },
  {
    type: "update.flowmap_force",
    category: "update",
    label: "FlowmapForce",
    accent: CAT_COLORS.update,
    fields: [
      { kind: "texture", key: "texture", label: "Flowmap (RG-encoded)" },
      { kind: "vec3", key: "origin", label: "Origin", step: 0.1 },
      { kind: "range", key: "size", label: "Size (w \xD7 h)", min: 0.1, max: 100, step: 0.1 },
      { kind: "select", key: "axis", label: "Axis", options: ["xz", "xy", "yz"] },
      { kind: "number", key: "amplitude", label: "Amplitude", min: 0, max: 50, step: 0.1 }
    ],
    defaults: { origin: [0, 0, 0], size: [4, 4], axis: "xz", amplitude: 1 }
  },
  {
    type: "update.sphere_collision",
    category: "update",
    label: "SphereCollision",
    accent: CAT_COLORS.update,
    fields: [
      { kind: "vec3", key: "center", label: "Center", step: 0.1 },
      { kind: "number", key: "radius", label: "Radius", min: 0.01, max: 50, step: 0.05 },
      { kind: "select", key: "side", label: "Bounce side", options: ["outside", "inside"] },
      { kind: "number", key: "restitution", label: "Restitution", min: 0, max: 1, step: 0.01 },
      { kind: "number", key: "friction", label: "Friction", min: 0, max: 1, step: 0.01 },
      { kind: "boolean", key: "worldSpace", label: "World space" }
    ],
    defaults: {
      center: [0, 0, 0],
      radius: 1,
      side: "outside",
      restitution: 0.5,
      friction: 0.9,
      worldSpace: false
    }
  },
  // ─────────────────────────────────────────────────────────────────────────
  // Render — exactly one per emitter (compiler enforces).
  // ─────────────────────────────────────────────────────────────────────────
  {
    type: "render.sprite",
    category: "render",
    label: "SpriteRenderer",
    accent: CAT_COLORS.render,
    fields: [
      { kind: "texture", key: "texture", label: "Sprite texture", optional: true },
      {
        kind: "select",
        key: "shader",
        label: "Shader",
        options: [
          "soft",
          "hard",
          "fire",
          "smoke",
          "spark",
          "texture_additive",
          "texture_luma_alpha",
          "clouds",
          "impact_cloud"
        ]
      },
      {
        kind: "select",
        key: "blending",
        label: "Blending",
        options: ["additive", "alpha", "normal"]
      },
      {
        kind: "select",
        key: "orientation",
        label: "Orientation",
        options: ["camera", "upright", "ground", "wall"]
      },
      {
        kind: "number",
        key: "facingAngle",
        label: "Facing angle (deg about Y)",
        min: -360,
        max: 360,
        step: 5,
        showWhen: { key: "orientation", oneOf: ["wall"] }
      },
      { kind: "number", key: "opacity", label: "Opacity", min: 0, max: 1, step: 0.01 },
      { kind: "boolean", key: "depthTest", label: "Depth test" },
      { kind: "boolean", key: "depthWrite", label: "Depth write" },
      { kind: "number", key: "renderOrder", label: "Render order", min: -100, max: 100, step: 1 }
    ],
    defaults: {
      shader: "soft",
      blending: "additive",
      orientation: "camera",
      facingAngle: 0,
      opacity: 1,
      depthTest: true,
      depthWrite: false,
      renderOrder: 0
    }
  },
  {
    type: "render.ribbon",
    category: "render",
    label: "RibbonRenderer",
    accent: CAT_COLORS.render,
    fields: [
      { kind: "texture", key: "texture", label: "Ribbon texture", optional: true },
      {
        kind: "select",
        key: "shader",
        label: "Shader",
        options: [
          "soft",
          "hard",
          "fire",
          "smoke",
          "spark",
          "texture_additive",
          "texture_luma_alpha"
        ]
      },
      { kind: "number", key: "width", label: "Width (head)", min: 1e-3, max: 5, step: 5e-3 },
      { kind: "number", key: "historyLength", label: "History length", min: 4, max: 256, step: 1 },
      {
        kind: "select",
        key: "blending",
        label: "Blending",
        options: ["additive", "alpha", "normal"]
      },
      { kind: "number", key: "opacity", label: "Opacity", min: 0, max: 1, step: 0.01 },
      { kind: "number", key: "renderOrder", label: "Render order", min: -100, max: 100, step: 1 }
    ],
    defaults: {
      shader: "soft",
      width: 0.05,
      historyLength: 32,
      blending: "additive",
      opacity: 1,
      renderOrder: 0
    }
  },
  {
    type: "render.beam",
    category: "render",
    label: "BeamRenderer",
    accent: CAT_COLORS.render,
    fields: [
      { kind: "texture", key: "texture", label: "Beam texture", optional: true },
      {
        kind: "select",
        key: "shader",
        label: "Shader",
        options: [
          "soft",
          "hard",
          "fire",
          "smoke",
          "spark",
          "texture_additive",
          "texture_luma_alpha"
        ]
      },
      { kind: "number", key: "width", label: "Width (head)", min: 1e-3, max: 5, step: 5e-3 },
      { kind: "select", key: "taper", label: "Taper", options: ["to-tail", "uniform"] },
      {
        kind: "select",
        key: "blending",
        label: "Blending",
        options: ["additive", "alpha", "normal"]
      },
      { kind: "number", key: "opacity", label: "Opacity", min: 0, max: 1, step: 0.01 },
      { kind: "number", key: "renderOrder", label: "Render order", min: -100, max: 100, step: 1 }
    ],
    defaults: {
      shader: "soft",
      width: 0.05,
      taper: "to-tail",
      blending: "additive",
      opacity: 1,
      renderOrder: 0
    }
  },
  {
    type: "render.mesh",
    category: "render",
    label: "MeshRenderer",
    accent: CAT_COLORS.render,
    fields: [
      { kind: "geometry", key: "geometry", label: "Instanced geometry" },
      {
        kind: "select",
        key: "material",
        label: "Material",
        options: ["pbr", "magma", "emissive"]
      },
      { kind: "color", key: "color", label: "Color" },
      { kind: "number", key: "metalness", label: "Metalness (PBR)", min: 0, max: 1, step: 0.05 },
      { kind: "number", key: "roughness", label: "Roughness (PBR)", min: 0, max: 1, step: 0.05 },
      { kind: "number", key: "renderOrder", label: "Render order", min: -100, max: 100, step: 1 }
    ],
    defaults: {
      geometry: { kind: "geometry", preset: "box", width: 0.1, height: 0.1, depth: 0.1 },
      material: "pbr",
      color: [1, 1, 1],
      metalness: 0.1,
      roughness: 0.4,
      renderOrder: 0
    }
  },
  {
    type: "render.light",
    category: "render",
    label: "LightEmission",
    accent: CAT_COLORS.render,
    fields: [
      { kind: "number", key: "lightCount", label: "Light count", min: 1, max: 16, step: 1 },
      { kind: "color", key: "color", label: "Color" },
      { kind: "number", key: "intensity", label: "Intensity", min: 0, max: 50, step: 0.1 },
      { kind: "number", key: "distance", label: "Distance", min: 0, max: 50, step: 0.1 },
      { kind: "number", key: "decay", label: "Decay", min: 0, max: 5, step: 0.1 }
    ],
    defaults: { lightCount: 4, color: [1, 0.85, 0.6], intensity: 1, distance: 5, decay: 2 }
  }
];
var INDEX = new Map(NODE_SPECS.map((s) => [s.type, s]));
function getSpec(type) {
  const s = INDEX.get(type);
  if (!s) throw new Error(`plume-editor: unknown node type "${type}"`);
  return s;
}
function specsByCategory(category) {
  return NODE_SPECS.filter((s) => s.category === category);
}
var cache = /* @__PURE__ */ new Map();
function getTexture(dataUrl) {
  let tex = cache.get(dataUrl);
  if (tex) return tex;
  const img = new Image();
  tex = new THREE3.Texture(img);
  tex.colorSpace = THREE3.SRGBColorSpace;
  tex.minFilter = THREE3.LinearMipmapLinearFilter;
  tex.magFilter = THREE3.LinearFilter;
  tex.wrapS = THREE3.RepeatWrapping;
  tex.wrapT = THREE3.RepeatWrapping;
  img.onload = () => {
    if (tex) tex.needsUpdate = true;
  };
  img.src = dataUrl;
  cache.set(dataUrl, tex);
  return tex;
}
var CLOUD_NOISE_TEXTURE_KEY = "cloudNoise";
var DEFAULT_CLOUD_NOISE_URL = "/textures/voronoi_08_512.png";
var BLENDER_FPS = 24;
var SHADOW_COLOR = vec3(0.7423, 0.8577, 1);
var LIGHT_COLOR = vec3(1, 1, 1);
var SHADOW_TO_LIGHT_AT = 0.082;
var CLOUDS_CUTOUT = 0.05;
var IMPACT_CUTOUT_REST = 0.3;
var IMPACT_CUTOUT_OPEN = 0.2;
function getCloudNoiseTexture(url = DEFAULT_CLOUD_NOISE_URL) {
  return getTexture(url);
}
function cloudsColorNode() {
  return (ctx) => {
    const noise = cloudNoise(ctx);
    const density = ctx.particle.color.a.mul(sphereGradient(ctx.uv)).mul(noise).clamp(0, 1);
    return shadeCloud(ctx, density, step(CLOUDS_CUTOUT, density));
  };
}
function impactCloudColorNode() {
  return (ctx) => {
    const noise = cloudNoise(ctx);
    const g = sphereGradient(ctx.uv);
    const ring = g.mul(float(1).sub(g));
    const rim = pow(max(pow(ring, 2.5).div(0.5).clamp(0, 1), 1e-6), 0.6).clamp(0, 1);
    const body = screenBlend(ring.mul(noise), rim);
    const alpha = ctx.particle.color.a;
    const density = alpha.mul(body).clamp(0, 1);
    const threshold = mix(float(IMPACT_CUTOUT_REST), float(IMPACT_CUTOUT_OPEN), alpha.clamp(0, 1));
    return shadeCloud(ctx, density, step(threshold, body));
  };
}
function cloudNoise(ctx) {
  const tex = ctx.textures[CLOUD_NOISE_TEXTURE_KEY];
  const frame = ctx.particle.age.mul(BLENDER_FPS);
  const centred = ctx.uv.sub(0.5);
  const sample = (scale, framesPerRadian) => tex.sample(rotateScaled(centred, scale, frame.div(framesPerRadian))).r;
  const a = sample(0.8, 50).mul(sample(0.5, 100)).mul(2.5);
  const b = sample(0.2, 75).mul(sample(0.4, 200)).mul(2.5);
  return a.mul(b).mul(2.5);
}
function shadeCloud(ctx, density, cutout) {
  const windowY = float(1).sub(screenUV.y);
  const shade = softLight(density, windowY.div(1.5).clamp(0, 1));
  const rgb = mix(SHADOW_COLOR, LIGHT_COLOR, step(SHADOW_TO_LIGHT_AT, shade));
  return vec4(rgb.mul(ctx.particle.color.rgb), cutout);
}
function rotateScaled(v, scale, angle) {
  const s = v.mul(scale);
  const c = cos(angle);
  const n = sin(angle);
  return vec2(s.x.mul(c).sub(s.y.mul(n)), s.x.mul(n).add(s.y.mul(c)));
}
function sphereGradient(uv) {
  return max(float(0.999999).sub(length(uv.mul(2).sub(1))), 0);
}
function softLight(a, b) {
  const inv = float(1).sub(a);
  const scr = float(1).sub(float(1).sub(b).mul(inv));
  return inv.mul(b).mul(a).add(a.mul(scr));
}
function screenBlend(a, b) {
  return float(1).sub(float(1).sub(a).mul(float(1).sub(b)));
}
function buildSpriteColorNode(preset) {
  switch (preset) {
    case "hard":
      return void 0;
    case "clouds":
      return cloudsColorNode();
    case "impact_cloud":
      return impactCloudColorNode();
    case "texture_additive":
      return ({ uv, particle, textures }) => {
        const tex = textures.base;
        if (!tex) {
          return vec4(particle.color.rgb, particle.color.a);
        }
        const sampled = tex.sample(uv);
        return vec4(sampled.rgb.mul(particle.color.rgb), sampled.a.mul(particle.color.a));
      };
    case "texture_luma_alpha":
      return ({ uv, particle, textures }) => {
        const tex = textures.base;
        if (!tex) {
          return vec4(particle.color.rgb, particle.color.a);
        }
        const sampled = tex.sample(uv);
        const luma = sampled.r.mul(0.299).add(sampled.g.mul(0.587)).add(sampled.b.mul(0.114));
        return vec4(particle.color.rgb, particle.color.a.mul(luma));
      };
    case "soft":
      return ({ uv, particle }) => {
        const dist = uv.sub(vec2(0.5, 0.5)).length();
        const fall = float(1).sub(smoothstep(0.25, 0.5, dist));
        return vec4(particle.color.rgb, particle.color.a.mul(fall));
      };
    case "fire":
      return ({ uv, particle }) => {
        const u = uv.x.sub(0.5);
        const v = uv.y;
        const seed = particle.lifetime.mul(17.37).add(particle.size.mul(9.71)).add(particle.position.x.mul(4.13)).add(particle.position.z.mul(6.19));
        const baseFade = smoothstep(0, 0.08, v);
        const edgeNoise = mx_noise_float(vec3(u.mul(10), v.mul(13), seed.add(5)), 1, 0);
        const edgeBite = mix(float(0.72), float(1), edgeNoise.mul(0.5).add(0.5));
        const tongue = (seedOffset, widthBase, widthTip, centerBias, start, end) => {
          const localT = smoothstep(start, end, v).clamp(0, 1);
          const span = smoothstep(start, start + 0.12, v).mul(
            float(1).sub(smoothstep(end - 0.16, end, v))
          );
          const lean = mx_noise_float(vec3(v.mul(2.2), seed.add(seedOffset), 0), 1, 0).mul(0.22);
          const snake = mx_noise_float(
            vec3(v.mul(6.5), seed.add(seedOffset + 11), u.mul(0.7)),
            1,
            0
          ).mul(0.12);
          const center = float(centerBias).mul(localT).add(lean).add(snake);
          const widthNoise = mx_noise_float(vec3(v.mul(8), seed.add(seedOffset + 23), 0), 1, 0).mul(0.5).add(0.5);
          const width = mix(float(widthBase), float(widthTip), localT.pow(0.62)).mul(
            mix(float(0.72), float(1.18), widthNoise)
          );
          const dist = u.sub(center).abs();
          return float(1).sub(smoothstep(width.mul(0.72), width, dist)).mul(span);
        };
        const main = tongue(0, 0.28, 0.035, 0.02, 0, 0.98);
        const left = tongue(31, 0.18, 0.018, -0.28, 0.12, 0.9);
        const right = tongue(67, 0.16, 0.016, 0.27, 0.18, 0.84);
        const inner = tongue(101, 0.11, 0.012, -0.06, 0.02, 0.72);
        const silhouette = main.add(left).add(right).add(inner).clamp(0, 1).mul(baseFade).mul(edgeBite);
        const coreLine = float(1).sub(smoothstep(0, 0.085, u.abs())).mul(float(1).sub(smoothstep(0.22, 0.78, v)));
        const coreBloom = float(1).sub(smoothstep(0, 0.22, u.abs())).mul(float(1).sub(smoothstep(0, 0.62, v)));
        const core = coreLine.add(coreBloom.mul(0.45)).clamp(0, 1);
        const rgb = particle.color.rgb.add(vec3(1.8, 1.1, 0.4).mul(core));
        return vec4(rgb, particle.color.a.mul(silhouette));
      };
    case "smoke":
      return ({ uv, particle }) => {
        const center = uv.sub(vec2(0.5, 0.5));
        const dist = center.length();
        const seed = particle.lifetime.mul(7.123);
        const n1 = mx_noise_float(vec3(uv.x.mul(2.5), uv.y.mul(2.5), seed), 0.5, 0.5);
        const n2 = mx_noise_float(vec3(uv.x.mul(5), uv.y.mul(5), seed.add(2)), 0.25, 0.25);
        const noisyDist = dist.add(n1.mul(0.2)).sub(n2.mul(0.1));
        const fall = float(1).sub(smoothstep(0.2, 0.55, noisyDist));
        return vec4(particle.color.rgb, particle.color.a.mul(fall));
      };
    case "spark":
      return ({ uv, particle }) => {
        const c = uv.sub(vec2(0.5, 0.5));
        const horiz = float(1).sub(smoothstep(0.02, 0.3, c.x.abs())).mul(float(1).sub(smoothstep(0, 0.5, c.y.abs())));
        const vert = float(1).sub(smoothstep(0.02, 0.3, c.y.abs())).mul(float(1).sub(smoothstep(0, 0.5, c.x.abs())));
        const star = horiz.add(vert).clamp(0, 1);
        const core = float(1).sub(smoothstep(0, 0.08, c.length()));
        const alpha = star.add(core).clamp(0, 1);
        return vec4(particle.color.rgb, particle.color.a.mul(alpha));
      };
  }
}
function buildMeshMaterial(preset, color, metalness, roughness) {
  if (preset === "magma") {
    const mat = new MeshBasicNodeMaterial();
    mat.toneMapped = false;
    mat.colorNode = Fn(() => {
      const p = positionLocal.mul(2.2).add(vec3(time.mul(0.18), time.mul(0.13), time.mul(0.21)));
      const w = mx_noise_float(p, 1, 0).mul(0.55);
      const warped = p.add(vec3(w, w.mul(1.3), w.mul(0.8)));
      const n = mx_noise_float(warped, 1, 0).mul(0.5).add(0.5);
      const c1 = vec3(0.25, 0.03, 0);
      const c2 = vec3(2.5, 0.4, 0.05);
      const c3 = vec3(4.2, 1.6, 0.2);
      const c4 = vec3(6.5, 4.5, 1.2);
      const r1 = mix(c1, c2, smoothstep(0, 0.42, n));
      const r2 = mix(r1, c3, smoothstep(0.42, 0.72, n));
      return mix(r2, c4, smoothstep(0.72, 0.95, n));
    })();
    return mat;
  }
  if (preset === "emissive") {
    const mat = new MeshBasicNodeMaterial();
    mat.toneMapped = false;
    mat.color = new THREE3.Color(color[0], color[1], color[2]);
    return mat;
  }
  const m = new MeshStandardNodeMaterial();
  m.color = new THREE3.Color(color[0], color[1], color[2]);
  m.metalness = metalness;
  m.roughness = roughness;
  return m;
}

// src/graph/compile.ts
var CompileError = class extends Error {
};
function compileGraph(nodes, edges = [], context = {}) {
  const emitters = nodes.filter((n) => getSpec(n.data.type).category === "emitter");
  if (emitters.length === 0) {
    throw new CompileError("Graph needs at least one Emitter node.");
  }
  const adj = /* @__PURE__ */ new Map();
  for (const e of edges) {
    if (!adj.has(e.source)) adj.set(e.source, []);
    adj.get(e.source).push(e.target);
  }
  const byId = new Map(nodes.map((n) => [n.id, n]));
  function bfs(rootId) {
    const visited = /* @__PURE__ */ new Set();
    const queue = [rootId];
    const out = [];
    while (queue.length > 0) {
      const id = queue.shift();
      if (visited.has(id)) continue;
      visited.add(id);
      const node = byId.get(id);
      if (!node) continue;
      out.push(node);
      for (const next of adj.get(id) ?? []) if (!visited.has(next)) queue.push(next);
    }
    return out;
  }
  const eventSourceIds = /* @__PURE__ */ new Set();
  for (const n of nodes) {
    if (n.data.type !== "spawn.from_events") continue;
    const id = readEmitterRef(n.data.params, "source");
    if (id) eventSourceIds.add(id);
  }
  const allPlans = [];
  const reachableUnion = /* @__PURE__ */ new Set();
  let renderless = 0;
  for (const em of emitters) {
    const visited = bfs(em.id);
    const spawn = [];
    const init = [];
    const update = [];
    const renders = [];
    for (const n of visited) {
      const cat = getSpec(n.data.type).category;
      if (cat === "spawn") spawn.push(n);
      else if (cat === "init") init.push(n);
      else if (cat === "update") update.push(n);
      else if (cat === "render") renders.push(n);
    }
    if (renders.length === 0) {
      renderless++;
      continue;
    }
    if (renders.length > 1) {
      throw new CompileError(
        `Emitter "${em.id}" reaches ${renders.length} render modules. Disconnect extras.`
      );
    }
    allPlans.push({
      emitterNode: em,
      spawn,
      init,
      update,
      render: renders[0],
      name: emitterNameFromId(em.id)
    });
  }
  const plans = soloPlans(allPlans, context.soloEmitterId);
  for (const plan of plans) {
    for (const n of bfs(plan.emitterNode.id)) reachableUnion.add(n.id);
  }
  if (plans.length === 0) {
    throw new CompileError(
      emitters.length === 1 ? "The Emitter has no reachable render module \u2014 wire a SpriteRenderer in." : "No emitter has a reachable render module \u2014 wire a SpriteRenderer in."
    );
  }
  let builder = system(context.systemName ?? "editor_graph");
  if (context.replayOneShots !== false && !plans.every((p) => readBool(p.emitterNode.data.params, "loop", true))) {
    const replayAfter = Math.max(
      ...plans.map(
        (p) => readNumber(p.emitterNode.data.params, "duration", 2) + maxLifetime(p.init)
      )
    );
    builder = builder.duration(replayAfter).loop();
  }
  const built = new Set(plans.map((p) => p.emitterNode.id));
  for (const plan of plans) {
    plan.spawn = plan.spawn.filter((n) => {
      if (n.data.type !== "spawn.from_events") return true;
      const source = readEmitterRef(n.data.params, "source");
      return !source || built.has(source);
    });
  }
  for (const plan of plans) {
    const capacity = readNumber(plan.emitterNode.data.params, "capacity", 256);
    const duration = readNumber(plan.emitterNode.data.params, "duration", 2);
    const emitsEvents = eventSourceIds.has(plan.emitterNode.id);
    const looping = readBool(plan.emitterNode.data.params, "loop", true);
    builder = builder.emitter(plan.name, (e) => {
      e.capacity(capacity).duration(duration);
      if (looping) e.loop();
      if (emitsEvents) e.emitEvents({ onDeath: true });
      for (const n of plan.spawn) applyToBuilder(e, n, context);
      for (const n of plan.init) applyToBuilder(e, n, context);
      for (const n of plan.update) applyToBuilder(e, n, context);
      applyToBuilder(e, plan.render, context);
      return e;
    });
  }
  const def = builder.build();
  const totalReachable = reachableUnion.size;
  const skipped = nodes.length - totalReachable;
  const moduleCount = plans.reduce(
    (n, p) => n + p.spawn.length + p.init.length + p.update.length + 1,
    0
  );
  const emitterTag = plans.length === 1 ? "1 emitter" : `${plans.length} emitters`;
  const soloed = plans.length < allPlans.length;
  const summary = `${emitterTag}${soloed ? " (solo)" : ""} \xB7 ${moduleCount} modules${skipped > 0 ? ` \xB7 ${skipped} not previewed` : ""}${renderless > 0 ? ` \xB7 ${renderless} emitter${renderless === 1 ? "" : "s"} without a renderer` : ""}`;
  return { def, summary: `Compiled: ${summary}` };
}
function soloPlans(plans, soloId) {
  const byEmitter = new Map(plans.map((p) => [p.emitterNode.id, p]));
  if (!soloId || !byEmitter.has(soloId)) return plans;
  const keep = /* @__PURE__ */ new Set();
  const stack = [soloId];
  while (stack.length > 0) {
    const id = stack.pop();
    if (keep.has(id)) continue;
    keep.add(id);
    for (const n of byEmitter.get(id)?.spawn ?? []) {
      if (n.data.type !== "spawn.from_events") continue;
      const source = readEmitterRef(n.data.params, "source");
      if (source) stack.push(source);
    }
  }
  return plans.filter((p) => keep.has(p.emitterNode.id));
}
function emitterNameFromId(id) {
  return id.replace(/^emitter_/, "em_");
}
function applyToBuilder(e, node, context) {
  const p = node.data.params;
  switch (node.data.type) {
    // ── Spawn ──
    case "spawn.rate":
      e.spawnRate(readNumber(p, "rate", 50));
      break;
    case "spawn.burst":
      e.spawnBurst({ time: readNumber(p, "time", 0), count: readNumber(p, "count", 100) });
      break;
    case "spawn.from_events": {
      const ref = readEmitterRef(p, "source");
      if (!ref) {
        break;
      }
      e.spawnFromEvents(
        emitterNameFromId(ref),
        readNumber(p, "perEvent", 6),
        readNumber(p, "maxEventsPerFrame", 64)
      );
      break;
    }
    // ── Init ──
    case "init.lifetime": {
      const [min, max2] = readRange(p, "lifetime", [1, 2]);
      e.lifetime({ min, max: max2 });
      break;
    }
    case "init.position":
      e.position({
        shape: readShape(p, "shape", { kind: "sphere", radius: 0.3, thickness: 1 }),
        offset: readVec3(p, "offset", [0, 0, 0]),
        worldSpace: readBool(p, "worldSpace", false)
      });
      break;
    case "init.velocity": {
      const [smin, smax] = readRange(p, "speed", [1, 3]);
      e.velocity({
        shape: readShape(p, "shape", { kind: "cone", angle: 0.3 }),
        speed: { min: smin, max: smax },
        worldSpace: readBool(p, "worldSpace", false)
      });
      break;
    }
    case "init.size": {
      const [smin, smax] = readRange(p, "size", [0.1, 0.3]);
      e.size({ min: smin, max: smax });
      break;
    }
    case "init.color": {
      const mode = readSelect(p, "mode", ["solid", "random range"], "solid");
      const cmin = readVec3(p, "color", [1, 1, 1]);
      if (mode === "random range") {
        const cmax = readVec3(p, "colorMax", [1, 1, 1]);
        e.color({ min: cmin, max: cmax }, { alpha: readNumber(p, "alpha", 1) });
      } else {
        e.color(cmin, { alpha: readNumber(p, "alpha", 1) });
      }
      break;
    }
    case "init.rotation": {
      const [rmin, rmax] = readRange(p, "rotation", [0, Math.PI * 2]);
      const [avmin, avmax] = readRange(p, "angularVelocity", [0, 0]);
      const hasSpin = avmin !== 0 || avmax !== 0;
      e.rotation(
        { min: rmin, max: rmax },
        hasSpin ? { angularVelocity: { min: avmin, max: avmax } } : {}
      );
      break;
    }
    case "init.from_mesh": {
      const geom = buildGeometry(readGeometry(p, "geometry"));
      e.fromMesh({
        geometry: geom,
        fill: readSelect(p, "fill", ["surface", "volume"], "surface"),
        worldSpace: readBool(p, "worldSpace", false),
        volumeSampleCount: readNumber(p, "volumeSampleCount", 2048)
      });
      break;
    }
    // ── Update ──
    case "update.integrate":
      e.integrate();
      break;
    case "update.gravity":
      e.gravity(readVec3(p, "acceleration", [0, -9.81, 0]));
      break;
    case "update.drag":
      e.drag(readNumber(p, "coefficient", 0.5));
      break;
    case "update.alpha_over_life": {
      e.alphaOverLife(new Curve1D(alphaCurveKeys(p)));
      break;
    }
    case "update.size_over_life":
      e.sizeOverLife(
        readCurve(p, "curve", [
          { t: 0, v: 1 },
          { t: 1, v: 0.5 }
        ])
      );
      break;
    case "update.velocity_over_life":
      e.velocityOverLife(
        readCurve(p, "curve", [
          { t: 0, v: 1 },
          { t: 1, v: 0 }
        ])
      );
      break;
    case "update.color_over_life":
      e.colorOverLife(
        readGradient(p, "gradient", [
          { t: 0, color: [1, 1, 1, 1] },
          { t: 1, color: [1, 0.4, 0.1, 0] }
        ])
      );
      break;
    case "update.curl_noise":
      e.curlNoise({
        amplitude: readNumber(p, "amplitude", 2),
        frequency: readNumber(p, "frequency", 1),
        speed: readNumber(p, "speed", 0.5)
      });
      break;
    case "update.turbulence":
      e.turbulence({
        amplitude: readNumber(p, "amplitude", 2),
        frequency: readNumber(p, "frequency", 1),
        speed: readNumber(p, "speed", 0.5),
        octaves: readNumber(p, "octaves", 3)
      });
      break;
    case "update.vortex":
      e.vortex({
        axis: readVec3(p, "axis", [0, 1, 0]),
        origin: readVec3(p, "origin", [0, 0, 0]),
        strength: readNumber(p, "strength", 5),
        worldSpace: readBool(p, "worldSpace", false)
      });
      break;
    case "update.point_attractor":
      e.pointAttractor({
        position: readVec3(p, "position", [0, 0, 0]),
        strength: readNumber(p, "strength", 5),
        radius: readNumber(p, "radius", 2),
        falloff: readSelect(
          p,
          "falloff",
          ["none", "linear", "inverse", "inverseSquared"],
          "inverseSquared"
        ),
        worldSpace: readBool(p, "worldSpace", false)
      });
      break;
    case "update.limit_velocity":
      e.limitVelocity({
        maxSpeed: readNumber(p, "maxSpeed", 10),
        damping: readNumber(p, "damping", 1)
      });
      break;
    case "update.scale_by_speed":
      e.scaleBySpeed({
        minSpeed: readNumber(p, "minSpeed", 0),
        maxSpeed: readNumber(p, "maxSpeed", 5),
        minScale: readNumber(p, "minScale", 1),
        maxScale: readNumber(p, "maxScale", 2)
      });
      break;
    case "update.plane_collision":
      e.planeCollision({
        normal: readVec3(p, "normal", [0, 1, 0]),
        point: readVec3(p, "point", [0, 0, 0]),
        restitution: readNumber(p, "restitution", 0.5),
        friction: readNumber(p, "friction", 0.9),
        worldSpace: readBool(p, "worldSpace", false)
      });
      break;
    case "update.sphere_collision":
      e.sphereCollision({
        center: readVec3(p, "center", [0, 0, 0]),
        radius: readNumber(p, "radius", 1),
        outside: readSelect(p, "side", ["outside", "inside"], "outside") === "outside",
        restitution: readNumber(p, "restitution", 0.5),
        friction: readNumber(p, "friction", 0.9),
        worldSpace: readBool(p, "worldSpace", false)
      });
      break;
    case "update.sdf_collision":
      e.sdfCollision({
        sdf: buildSdf(readSdf(p, "sdf")),
        mode: readSelect(p, "mode", ["bounce", "stop", "kill"], "bounce"),
        restitution: readNumber(p, "restitution", 0.5),
        friction: readNumber(p, "friction", 0.9),
        thickness: readNumber(p, "thickness", 0.02),
        gradientEpsilon: readNumber(p, "gradientEpsilon", 0.01)
      });
      break;
    case "update.depth_collision":
      if (context.depthTexture && context.camera) {
        e.depthCollision({
          depthTexture: context.depthTexture,
          camera: context.camera,
          mode: readSelect(p, "mode", ["bounce", "stop", "kill"], "bounce"),
          normal: readSelect(
            p,
            "normal",
            ["depth-gradient", "camera"],
            "depth-gradient"
          ),
          restitution: readNumber(p, "restitution", 0.5),
          friction: readNumber(p, "friction", 0.9),
          thickness: readNumber(p, "thickness", 5e-4)
        });
      }
      break;
    case "update.flowmap_force": {
      const tex = readTexture(p, "texture");
      if (!tex) {
        break;
      }
      const sz = readRange(p, "size", [4, 4]);
      e.flowmapForce({
        texture: tex,
        origin: readVec3(p, "origin", [0, 0, 0]),
        size: sz,
        axis: readSelect(p, "axis", ["xz", "xy", "yz"], "xz"),
        amplitude: readNumber(p, "amplitude", 1)
      });
      break;
    }
    // ── Render ──
    case "render.sprite": {
      const tex = readTexture(p, "texture");
      const shader = readSelect(
        p,
        "shader",
        [
          "soft",
          "hard",
          "fire",
          "smoke",
          "spark",
          "texture_additive",
          "texture_luma_alpha",
          "clouds",
          "impact_cloud"
        ],
        "soft"
      );
      const isTextureShader = shader === "texture_additive" || shader === "texture_luma_alpha";
      const isCloudShader = shader === "clouds" || shader === "impact_cloud";
      const colorNode = isTextureShader || isCloudShader || !tex ? buildSpriteColorNode(shader) : void 0;
      const textures = isCloudShader ? { [CLOUD_NOISE_TEXTURE_KEY]: tex ?? getCloudNoiseTexture(context.cloudNoiseUrl) } : tex ? { base: tex } : void 0;
      e.renderSprite({
        blending: readSelect(p, "blending", ["additive", "alpha", "normal"], "additive"),
        opacity: readNumber(p, "opacity", 1),
        renderOrder: readNumber(p, "renderOrder", 0),
        orientation: readSelect(
          p,
          "orientation",
          ["camera", "upright", "ground", "wall"],
          "camera"
        ),
        facingAngle: readNumber(p, "facingAngle", 0),
        depthTest: readBool(p, "depthTest", true),
        depthWrite: readBool(p, "depthWrite", false),
        ...textures ? { textures } : {},
        ...colorNode ? { colorNode } : {}
      });
      break;
    }
    case "render.ribbon": {
      const tex = readTexture(p, "texture");
      const shader = readSelect(
        p,
        "shader",
        ["soft", "hard", "fire", "smoke", "spark", "texture_additive", "texture_luma_alpha"],
        "soft"
      );
      const isTextureShader = shader === "texture_additive" || shader === "texture_luma_alpha";
      const colorNode = isTextureShader || !tex ? buildSpriteColorNode(shader) : void 0;
      e.renderRibbon({
        width: readNumber(p, "width", 0.05),
        historyLength: readNumber(p, "historyLength", 32),
        blending: readSelect(p, "blending", ["additive", "alpha", "normal"], "additive"),
        opacity: readNumber(p, "opacity", 1),
        renderOrder: readNumber(p, "renderOrder", 0),
        ...tex ? { textures: { base: tex } } : {},
        ...colorNode ? { colorNode } : {}
      });
      break;
    }
    case "render.beam": {
      const tex = readTexture(p, "texture");
      const shader = readSelect(
        p,
        "shader",
        ["soft", "hard", "fire", "smoke", "spark", "texture_additive", "texture_luma_alpha"],
        "soft"
      );
      const isTextureShader = shader === "texture_additive" || shader === "texture_luma_alpha";
      const colorNode = isTextureShader || !tex ? buildSpriteColorNode(shader) : void 0;
      e.renderBeam({
        width: readNumber(p, "width", 0.05),
        taperToTail: readSelect(p, "taper", ["to-tail", "uniform"], "to-tail") === "to-tail",
        blending: readSelect(p, "blending", ["additive", "alpha", "normal"], "additive"),
        opacity: readNumber(p, "opacity", 1),
        renderOrder: readNumber(p, "renderOrder", 0),
        ...tex ? { textures: { base: tex } } : {},
        ...colorNode ? { colorNode } : {}
      });
      break;
    }
    case "render.mesh": {
      const c = readVec3(p, "color", [1, 1, 1]);
      const matPreset = readSelect(
        p,
        "material",
        ["pbr", "magma", "emissive"],
        "pbr"
      );
      const material = buildMeshMaterial(
        matPreset,
        c,
        readNumber(p, "metalness", 0.1),
        readNumber(p, "roughness", 0.4)
      );
      e.renderMesh({
        geometry: buildGeometry(readGeometry(p, "geometry")),
        material,
        renderOrder: readNumber(p, "renderOrder", 0)
      });
      break;
    }
    case "render.light": {
      const c = readVec3(p, "color", [1, 0.85, 0.6]);
      e.renderLight({
        lightCount: readNumber(p, "lightCount", 4),
        color: new THREE3.Color(c[0], c[1], c[2]),
        intensity: readNumber(p, "intensity", 1),
        distance: readNumber(p, "distance", 5),
        decay: readNumber(p, "decay", 2)
      });
      break;
    }
    case "emitter":
      throw new CompileError("Multiple Emitter nodes \u2014 graph must have exactly one.");
    default:
      throw new CompileError(`Compiler doesn't know node type "${node.data.type}" yet.`);
  }
}
function readNumber(p, key, fallback) {
  const v = p[key];
  return typeof v === "number" ? v : fallback;
}
function readRange(p, key, fallback) {
  const v = p[key];
  if (Array.isArray(v) && v.length === 2 && typeof v[0] === "number" && typeof v[1] === "number") {
    return [v[0], v[1]];
  }
  return fallback;
}
function readVec3(p, key, fallback) {
  const v = p[key];
  if (Array.isArray(v) && v.length === 3 && typeof v[0] === "number" && typeof v[1] === "number" && typeof v[2] === "number") {
    return [v[0], v[1], v[2]];
  }
  return fallback;
}
function readShape(p, key, fallback) {
  const v = p[key];
  if (v && typeof v === "object" && !Array.isArray(v) && "kind" in v) return v;
  return fallback;
}
function readSelect(p, key, options, fallback) {
  const v = p[key];
  return typeof v === "string" && options.includes(v) ? v : fallback;
}
function readBool(p, key, fallback) {
  const v = p[key];
  return typeof v === "boolean" ? v : fallback;
}
function clamp01(n) {
  return n < 0 ? 0 : n > 1 ? 1 : n;
}
function maxLifetime(init) {
  const node = init.find((n) => n.data.type === "init.lifetime");
  return node ? readRange(node.data.params, "lifetime", [1, 2])[1] : 5;
}
function alphaCurveKeys(p) {
  const keys = readCurve(p, "curve", fadeCurve(0.1, 0.3).keys).keyframes;
  if (p["clampToOne"] === false) return keys;
  return keys.map((k) => ({ t: k.t, v: clamp01(k.v) }));
}
function readCurve(p, key, fallbackKeys) {
  const v = p[key];
  if (v && typeof v === "object" && !Array.isArray(v) && "kind" in v && v.kind === "curve1d" && Array.isArray(v.keys) && v.keys.length > 0) {
    return new Curve1D(
      v.keys.map((k) => ({
        t: typeof k.t === "number" ? k.t : 0,
        v: typeof k.v === "number" ? k.v : 0
      }))
    );
  }
  return new Curve1D(fallbackKeys);
}
function readGeometry(p, key) {
  const v = p[key];
  if (v && typeof v === "object" && !Array.isArray(v) && "kind" in v && v.kind === "geometry") {
    return v;
  }
  return { kind: "geometry", preset: "sphere", radius: 0.5, widthSegments: 32, heightSegments: 16 };
}
function readEmitterRef(p, key) {
  const v = p[key];
  if (v && typeof v === "object" && !Array.isArray(v) && "kind" in v && v.kind === "emitter-ref" && typeof v.nodeId === "string") {
    return v.nodeId;
  }
  return void 0;
}
function readSdf(p, key) {
  const v = p[key];
  if (v && typeof v === "object" && !Array.isArray(v) && "kind" in v && v.kind === "sdf") {
    return v;
  }
  return { kind: "sdf", preset: "sphere", center: [0, 0, 0], radius: 1 };
}
function buildGeometry(g) {
  switch (g.preset) {
    case "sphere":
      return new THREE3.SphereGeometry(g.radius, g.widthSegments, g.heightSegments);
    case "box":
      return new THREE3.BoxGeometry(g.width, g.height, g.depth);
    case "torus":
      return new THREE3.TorusGeometry(g.radius, g.tube, g.radialSegments, g.tubularSegments);
    case "cone":
      return new THREE3.ConeGeometry(g.radius, g.height, g.radialSegments);
    case "cylinder":
      return new THREE3.CylinderGeometry(g.radiusTop, g.radiusBottom, g.height, g.radialSegments);
    case "plane":
      return new THREE3.PlaneGeometry(g.width, g.height);
  }
}
function buildSdf(s) {
  switch (s.preset) {
    case "sphere":
      return sdfSphere(s.center, s.radius);
    case "box":
      return sdfBox(s.center, s.halfSize);
    case "plane":
      return sdfPlane(s.point, s.normal);
  }
}
function readTexture(p, key) {
  const v = p[key];
  if (v && typeof v === "object" && !Array.isArray(v) && "kind" in v && v.kind === "texture" && typeof v.dataUrl === "string") {
    return getTexture(v.dataUrl);
  }
  return void 0;
}
function readGradient(p, key, fallbackStops) {
  const v = p[key];
  if (v && typeof v === "object" && !Array.isArray(v) && "kind" in v && v.kind === "gradient" && Array.isArray(v.stops) && v.stops.length > 0) {
    return new Gradient(
      v.stops.map((s) => ({
        t: typeof s.t === "number" ? s.t : 0,
        color: Array.isArray(s.color) && s.color.length === 4 ? [s.color[0], s.color[1], s.color[2], s.color[3]] : [1, 1, 1, 1]
      }))
    );
  }
  return new Gradient(fallbackStops);
}

// src/graph/document.ts
var GRAPH_FORMAT_VERSION = 1;
function parseGraphDocument(raw) {
  if (!raw || typeof raw !== "object") throw new Error("Not a graph file.");
  const obj = raw;
  if (obj.version !== GRAPH_FORMAT_VERSION) {
    throw new Error(`Unsupported graph version ${obj.version} (expected ${GRAPH_FORMAT_VERSION}).`);
  }
  if (!Array.isArray(obj.nodes) || !Array.isArray(obj.edges)) {
    throw new Error("Graph missing nodes/edges arrays.");
  }
  const nodes = obj.nodes.map((node, idx) => {
    if (!node || typeof node.id !== "string" || typeof node.type !== "string" || !node.position || typeof node.position.x !== "number" || typeof node.position.y !== "number") {
      throw new Error(`Node #${idx} is malformed.`);
    }
    getSpec(node.type);
    return {
      id: node.id,
      type: node.type,
      position: { x: node.position.x, y: node.position.y },
      params: migrateParams(node.type, node.params ?? {})
    };
  });
  const edges = obj.edges.map((edge, idx) => {
    if (!edge || typeof edge.id !== "string" || typeof edge.source !== "string" || typeof edge.target !== "string") {
      throw new Error(`Edge #${idx} is malformed.`);
    }
    return { id: edge.id, source: edge.source, target: edge.target };
  });
  return {
    version: GRAPH_FORMAT_VERSION,
    ...typeof obj.name === "string" ? { name: obj.name } : {},
    nodes,
    edges
  };
}
function compileGraphDocument(doc, context = {}) {
  const nodes = doc.nodes.map((n) => ({
    id: n.id,
    position: n.position,
    data: { type: n.type, params: n.params }
  }));
  const edges = doc.edges;
  return compileGraph(nodes, edges, { systemName: doc.name, ...context });
}

export { CLOUD_NOISE_TEXTURE_KEY, CompileError, DEFAULT_CLOUD_NOISE_URL, GRAPH_FORMAT_VERSION, NODE_SPECS, alphaCurveKeys, buildMeshMaterial, buildSpriteColorNode, cloudsColorNode, compileGraph, compileGraphDocument, fadeCurve, getCloudNoiseTexture, getSpec, getTexture, impactCloudColorNode, migrateParams, parseGraphDocument, specsByCategory };
//# sourceMappingURL=index.js.map
//# sourceMappingURL=index.js.map