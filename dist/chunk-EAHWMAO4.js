import * as THREE14 from 'three';
import { vec3, length, abs, max, min, dot, instancedArray, vec4, uniform, hash, float, If, texture, vec2, mx_fractal_noise_vec3, mx_noise_vec3, cross, clamp, normalize, Fn, instanceIndex, uint, modelViewMatrix, cos, sin, positionLocal, cameraProjectionMatrix, uv, spritesheetUV, varying, attribute, cameraPosition, atomicStore, atomicLoad, atomicAdd, normalLocal, uniformArray, sqrt } from 'three/tsl';
import { MeshBasicNodeMaterial } from 'three/webgpu';
import { BitonicSort } from 'three/examples/jsm/gpgpu/BitonicSort.js';

// src/math/rng.ts
var RNG = class {
  state;
  constructor(seed = 2654435769) {
    this.state = seed >>> 0 || 1;
  }
  reseed(seed) {
    this.state = seed >>> 0 || 1;
  }
  /** Raw 32-bit unsigned integer from the stream. */
  u32() {
    this.state = this.state + 1831565813 >>> 0;
    let t = this.state;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return (t ^ t >>> 14) >>> 0;
  }
  /** Uniform float in [0, 1). */
  next() {
    return this.u32() / 4294967296;
  }
  /** Uniform float in [min, max). */
  range(min2, max3) {
    return min2 + this.next() * (max3 - min2);
  }
  /** Uniform integer in [min, max). */
  rangeInt(min2, max3) {
    return min2 + Math.floor(this.next() * (max3 - min2)) | 0;
  }
  /** Uniform unit vector on sphere. */
  unitSphere(out) {
    const u = this.next() * 2 - 1;
    const theta = this.next() * Math.PI * 2;
    const r = Math.sqrt(1 - u * u);
    out[0] = r * Math.cos(theta);
    out[1] = u;
    out[2] = r * Math.sin(theta);
    return out;
  }
};
var sharedRNG = new RNG(Date.now() & 2147483647);
var Curve1D = class _Curve1D {
  keyframes;
  constructor(keyframes) {
    if (keyframes.length === 0) throw new Error("Curve1D requires at least one keyframe");
    const sorted = [...keyframes].sort((a, b) => a.t - b.t);
    this.keyframes = sorted;
  }
  static constant(value) {
    return new _Curve1D([{ t: 0, v: value }]);
  }
  static linear(from, to) {
    return new _Curve1D([
      { t: 0, v: from },
      { t: 1, v: to }
    ]);
  }
  sample(t) {
    const keys = this.keyframes;
    if (t <= keys[0].t) return keys[0].v;
    const last = keys[keys.length - 1];
    if (t >= last.t) return last.v;
    for (let i = 1; i < keys.length; i++) {
      const b = keys[i];
      if (t <= b.t) {
        const a = keys[i - 1];
        const span = b.t - a.t;
        if (span <= 0) return b.v;
        const f = (t - a.t) / span;
        return a.v + (b.v - a.v) * f;
      }
    }
    return last.v;
  }
  /** Bake to a Float32Array for GPU texture upload. */
  bake(samples = 256) {
    const out = new Float32Array(samples);
    const denom = samples - 1;
    for (let i = 0; i < samples; i++) out[i] = this.sample(i / denom);
    return out;
  }
  toJSON() {
    return { keyframes: this.keyframes };
  }
  static fromJSON(data) {
    return new _Curve1D(data.keyframes);
  }
  /**
   * Lazily bake the curve to a 1×N R32F DataTexture for GPU sampling.
   * Cached per-instance; reused across kernel rebuilds.
   */
  _texture;
  getTexture(samples = 256) {
    if (this._texture) return this._texture;
    const data = this.bake(samples);
    const tex = new THREE14.DataTexture(data, samples, 1, THREE14.RedFormat, THREE14.FloatType);
    tex.minFilter = THREE14.LinearFilter;
    tex.magFilter = THREE14.LinearFilter;
    tex.wrapS = THREE14.ClampToEdgeWrapping;
    tex.wrapT = THREE14.ClampToEdgeWrapping;
    tex.generateMipmaps = false;
    tex.needsUpdate = true;
    this._texture = tex;
    return tex;
  }
};
var Gradient = class _Gradient {
  stops;
  constructor(stops) {
    if (stops.length === 0) throw new Error("Gradient requires at least one stop");
    this.stops = [...stops].sort((a, b) => a.t - b.t);
  }
  static constant(rgba) {
    return new _Gradient([{ t: 0, color: rgba }]);
  }
  static linear(from, to) {
    return new _Gradient([
      { t: 0, color: from },
      { t: 1, color: to }
    ]);
  }
  sample(t, out) {
    const stops = this.stops;
    if (t <= stops[0].t) {
      const c = stops[0].color;
      out[0] = c[0];
      out[1] = c[1];
      out[2] = c[2];
      out[3] = c[3];
      return out;
    }
    const last = stops[stops.length - 1];
    if (t >= last.t) {
      out[0] = last.color[0];
      out[1] = last.color[1];
      out[2] = last.color[2];
      out[3] = last.color[3];
      return out;
    }
    for (let i = 1; i < stops.length; i++) {
      const b = stops[i];
      if (t <= b.t) {
        const a = stops[i - 1];
        const span = b.t - a.t;
        const f = span <= 0 ? 0 : (t - a.t) / span;
        out[0] = a.color[0] + (b.color[0] - a.color[0]) * f;
        out[1] = a.color[1] + (b.color[1] - a.color[1]) * f;
        out[2] = a.color[2] + (b.color[2] - a.color[2]) * f;
        out[3] = a.color[3] + (b.color[3] - a.color[3]) * f;
        return out;
      }
    }
    out[0] = last.color[0];
    out[1] = last.color[1];
    out[2] = last.color[2];
    out[3] = last.color[3];
    return out;
  }
  /** Bake to a Float32Array RGBA buffer (length = samples * 4). */
  bake(samples = 256) {
    const out = new Float32Array(samples * 4);
    const tmp = [0, 0, 0, 0];
    const denom = samples - 1;
    for (let i = 0; i < samples; i++) {
      this.sample(i / denom, tmp);
      out[i * 4] = tmp[0];
      out[i * 4 + 1] = tmp[1];
      out[i * 4 + 2] = tmp[2];
      out[i * 4 + 3] = tmp[3];
    }
    return out;
  }
  toJSON() {
    return { stops: this.stops };
  }
  static fromJSON(data) {
    return new _Gradient(data.stops);
  }
  /** Lazily bake to a 1×N RGBA32F DataTexture for GPU sampling. */
  _texture;
  getTexture(samples = 256) {
    if (this._texture) return this._texture;
    const data = this.bake(samples);
    const tex = new THREE14.DataTexture(data, samples, 1, THREE14.RGBAFormat, THREE14.FloatType);
    tex.minFilter = THREE14.LinearFilter;
    tex.magFilter = THREE14.LinearFilter;
    tex.wrapS = THREE14.ClampToEdgeWrapping;
    tex.wrapT = THREE14.ClampToEdgeWrapping;
    tex.generateMipmaps = false;
    tex.needsUpdate = true;
    this._texture = tex;
    return tex;
  }
};

// src/math/shapes.ts
function samplePosition(shape, rng, out) {
  switch (shape.kind) {
    case "point":
      out[0] = 0;
      out[1] = 0;
      out[2] = 0;
      return out;
    case "sphere": {
      rng.unitSphere(out);
      const thickness = shape.thickness ?? 0;
      const rInner = shape.radius * (1 - thickness);
      const r = rInner + (shape.radius - rInner) * Math.cbrt(rng.next());
      out[0] *= r;
      out[1] *= r;
      out[2] *= r;
      return out;
    }
    case "box": {
      out[0] = (rng.next() - 0.5) * shape.size[0];
      out[1] = (rng.next() - 0.5) * shape.size[1];
      out[2] = (rng.next() - 0.5) * shape.size[2];
      return out;
    }
    case "cone": {
      const r = (shape.radius ?? 0) * Math.sqrt(rng.next());
      const theta = rng.next() * Math.PI * 2;
      out[0] = Math.cos(theta) * r;
      out[1] = 0;
      out[2] = Math.sin(theta) * r;
      return out;
    }
    case "ring": {
      const thickness = shape.thickness ?? 0;
      const rInner = shape.radius * (1 - thickness);
      const r = rInner + (shape.radius - rInner) * rng.next();
      const theta = rng.next() * Math.PI * 2;
      out[0] = Math.cos(theta) * r;
      out[1] = 0;
      out[2] = Math.sin(theta) * r;
      return out;
    }
    case "disc": {
      const thickness = shape.thickness ?? 1;
      const rInner = shape.radius * (1 - thickness);
      const r = Math.sqrt(
        rInner * rInner + rng.next() * (shape.radius * shape.radius - rInner * rInner)
      );
      const theta = rng.next() * Math.PI * 2;
      out[0] = Math.cos(theta) * r;
      out[1] = 0;
      out[2] = Math.sin(theta) * r;
      return out;
    }
  }
}
function sampleDirection(shape, rng, out) {
  switch (shape.kind) {
    case "point":
      out[0] = 0;
      out[1] = 1;
      out[2] = 0;
      return out;
    case "sphere":
      rng.unitSphere(out);
      return out;
    case "cone": {
      const cosMin = Math.cos(shape.angle);
      const cosTheta = cosMin + (1 - cosMin) * rng.next();
      const sinTheta = Math.sqrt(Math.max(0, 1 - cosTheta * cosTheta));
      const phi = rng.next() * Math.PI * 2;
      out[0] = Math.cos(phi) * sinTheta;
      out[1] = cosTheta;
      out[2] = Math.sin(phi) * sinTheta;
      return out;
    }
    case "box":
    case "ring":
    case "disc": {
      rng.unitSphere(out);
      return out;
    }
  }
}

// src/math/sample.ts
function sampleScalar(input, rng) {
  switch (input.kind) {
    case "constant":
      return input.value;
    case "range":
      return rng.range(input.min, input.max);
    case "list":
      return input.values[rng.rangeInt(0, input.values.length)];
  }
}
function sampleVec3(input, rng, out) {
  switch (input.kind) {
    case "constant":
      out[0] = input.value[0];
      out[1] = input.value[1];
      out[2] = input.value[2];
      return out;
    case "range":
      out[0] = rng.range(input.min[0], input.max[0]);
      out[1] = rng.range(input.min[1], input.max[1]);
      out[2] = rng.range(input.min[2], input.max[2]);
      return out;
  }
}
function sampleColor(input, rng, out) {
  switch (input.kind) {
    case "constant":
      out[0] = input.value[0];
      out[1] = input.value[1];
      out[2] = input.value[2];
      return out;
    case "range":
      out[0] = rng.range(input.min[0], input.max[0]);
      out[1] = rng.range(input.min[1], input.max[1]);
      out[2] = rng.range(input.min[2], input.max[2]);
      return out;
    case "list": {
      const c = input.values[rng.rangeInt(0, input.values.length)];
      out[0] = c[0];
      out[1] = c[1];
      out[2] = c[2];
      return out;
    }
  }
}
function sdfSphere(center, radius) {
  const c = vec3(center[0], center[1], center[2]);
  return (p) => length(p.sub(c)).sub(radius);
}
function sdfBox(center, halfSize) {
  const c = vec3(center[0], center[1], center[2]);
  const h = vec3(halfSize[0], halfSize[1], halfSize[2]);
  return (p) => {
    const q = abs(p.sub(c)).sub(h);
    const outside = length(max(q, vec3(0, 0, 0)));
    const inside = min(max(q.x, max(q.y, q.z)), 0);
    return outside.add(inside);
  };
}
function sdfPlane(point, normal) {
  const p0 = vec3(point[0], point[1], point[2]);
  const n = vec3(normal[0], normal[1], normal[2]);
  return (p) => dot(p.sub(p0), n);
}
function sdfUnion(a, b) {
  return (p) => min(a(p), b(p));
}
function sdfIntersect(a, b) {
  return (p) => max(a(p), b(p));
}
function sdfSubtract(a, b) {
  return (p) => max(a(p), b(p).negate());
}
var ParticleBuffer = class {
  capacity;
  storage;
  constructor(capacity) {
    this.capacity = capacity;
    this.storage = {
      posAlive: instancedArray(capacity, "vec4"),
      velAge: instancedArray(capacity, "vec4"),
      color: instancedArray(capacity, "vec4"),
      initialColor: instancedArray(capacity, "vec4"),
      initVelSize: instancedArray(capacity, "vec4"),
      traits: instancedArray(capacity, "vec4")
    };
  }
};
function rmwX(buf, i, value) {
  const current = buf.element(i).toVar();
  buf.element(i).assign(current.setX(value));
}
function rmwY(buf, i, value) {
  const current = buf.element(i).toVar();
  buf.element(i).assign(current.setY(value));
}
function rmwZ(buf, i, value) {
  const current = buf.element(i).toVar();
  buf.element(i).assign(current.setZ(value));
}
function rmwW(buf, i, value) {
  const current = buf.element(i).toVar();
  buf.element(i).assign(current.setW(value));
}
function rmwXYZ(buf, i, value) {
  const current = buf.element(i).toVar();
  buf.element(i).assign(vec4(value, current.w));
}
var attr = {
  // Vec3 attributes packed with a scalar in .w
  position: {
    read: (s, i) => s.posAlive.element(i).xyz,
    write: (s, i, v) => rmwXYZ(s.posAlive, i, v)
  },
  velocity: {
    read: (s, i) => s.velAge.element(i).xyz,
    write: (s, i, v) => rmwXYZ(s.velAge, i, v)
  },
  initialVelocity: {
    read: (s, i) => s.initVelSize.element(i).xyz,
    write: (s, i, v) => rmwXYZ(s.initVelSize, i, v)
  },
  // Scalars packed as the w of a vec3+1
  alive: {
    read: (s, i) => s.posAlive.element(i).w,
    write: (s, i, v) => rmwW(s.posAlive, i, v)
  },
  age: {
    read: (s, i) => s.velAge.element(i).w,
    write: (s, i, v) => rmwW(s.velAge, i, v)
  },
  initialSize: {
    read: (s, i) => s.initVelSize.element(i).w,
    write: (s, i, v) => rmwW(s.initVelSize, i, v)
  },
  // Scalars packed into the `traits` vec4
  size: {
    read: (s, i) => s.traits.element(i).x,
    write: (s, i, v) => rmwX(s.traits, i, v)
  },
  rotation: {
    read: (s, i) => s.traits.element(i).y,
    write: (s, i, v) => rmwY(s.traits, i, v)
  },
  angularVelocity: {
    read: (s, i) => s.traits.element(i).z,
    write: (s, i, v) => rmwZ(s.traits, i, v)
  },
  lifetime: {
    read: (s, i) => s.traits.element(i).w,
    write: (s, i, v) => rmwW(s.traits, i, v)
  },
  // Vec4 attributes — direct storage access, no packing
  color: {
    read: (s, i) => s.color.element(i),
    write: (s, i, v) => {
      s.color.element(i).assign(v);
    }
  },
  initialColor: {
    read: (s, i) => s.initialColor.element(i),
    write: (s, i, v) => {
      s.initialColor.element(i).assign(v);
    }
  }
};

// src/modules/registry.ts
var factories = /* @__PURE__ */ new Map();
function registerModule(factory) {
  factories.set(factory.type, factory);
}
function unregisterModule(type) {
  factories.delete(type);
}
function getModuleFactory(type) {
  return factories.get(type);
}
function listRegisteredModules() {
  return [...factories.keys()].sort();
}
function moduleFromJSON(data) {
  const factory = factories.get(data.type);
  if (!factory) {
    throw new Error(
      `plume: unknown module type "${data.type}". Known: ${[...factories.keys()].join(", ")}`
    );
  }
  return factory.fromJSON(data);
}

// src/modules/spawn/spawn-rate.ts
var SpawnRate = class _SpawnRate {
  static type = "spawn.rate";
  kind = "emitter_spawn";
  type = _SpawnRate.type;
  id;
  rate;
  _accumulator = 0;
  constructor(params) {
    this.rate = params.rate;
    this.id = params.id;
  }
  reset() {
    this._accumulator = 0;
  }
  requestSpawn(ctx) {
    if (this.rate <= 0) return 0;
    this._accumulator += this.rate * ctx.deltaTime * ctx.intensity;
    const whole = Math.floor(this._accumulator);
    this._accumulator -= whole;
    return whole;
  }
  toJSON() {
    return { type: _SpawnRate.type, id: this.id, rate: this.rate };
  }
  static fromJSON(data) {
    return new _SpawnRate({
      rate: Number(data["rate"] ?? 0),
      id: data.id
    });
  }
};
registerModule(SpawnRate);

// src/modules/spawn/spawn-burst.ts
var SpawnBurst = class _SpawnBurst {
  static type = "spawn.burst";
  kind = "emitter_spawn";
  type = _SpawnBurst.type;
  id;
  bursts;
  _fired = [];
  constructor(params) {
    this.bursts = params.bursts.map((b) => ({
      time: b.time,
      count: b.count,
      cycle: b.cycle ?? 0,
      repeats: b.repeats ?? (b.cycle && b.cycle > 0 ? Infinity : 1)
    }));
    this._fired = new Array(this.bursts.length).fill(0);
    this.id = params.id;
  }
  reset() {
    this._fired.fill(0);
  }
  requestSpawn(ctx) {
    let total = 0;
    const t = ctx.emitterTime;
    for (let i = 0; i < this.bursts.length; i++) {
      const b = this.bursts[i];
      const fired = this._fired[i];
      const repeats = b.repeats ?? Infinity;
      if (fired >= repeats) continue;
      let triggersSoFar;
      if (b.cycle && b.cycle > 0) {
        triggersSoFar = t >= b.time ? Math.floor((t - b.time) / b.cycle) + 1 : 0;
      } else {
        triggersSoFar = t >= b.time ? 1 : 0;
      }
      triggersSoFar = Math.min(triggersSoFar, repeats);
      const newTriggers = triggersSoFar - fired;
      if (newTriggers > 0) {
        total += newTriggers * Math.round(b.count * ctx.intensity);
        this._fired[i] = triggersSoFar;
      }
    }
    return total;
  }
  toJSON() {
    return {
      type: _SpawnBurst.type,
      id: this.id,
      bursts: this.bursts.map((b) => ({ ...b }))
    };
  }
  static fromJSON(data) {
    return new _SpawnBurst({
      bursts: data["bursts"] ?? [],
      id: data.id
    });
  }
};
registerModule(SpawnBurst);

// src/modules/spawn/spawn-from-events.ts
var SpawnFromEvents = class _SpawnFromEvents {
  static type = "spawn.from_events";
  kind = "emitter_spawn";
  type = _SpawnFromEvents.type;
  id;
  /** Resolved at construction time when an `Emitter` instance is passed, or
   *  filled in by `System` after construction when only a name was given. */
  source;
  /** When `source` was given as a string, this is the deferred name kept
   *  around for the System to resolve. Cleared once resolved. */
  pendingSourceName;
  perEvent;
  maxEventsPerFrame;
  inheritVelocity;
  constructor(params) {
    if (typeof params.source === "string") {
      this.pendingSourceName = params.source;
    } else {
      this.source = params.source;
    }
    this.perEvent = params.perEvent ?? 1;
    this.maxEventsPerFrame = params.maxEventsPerFrame ?? 64;
    this.inheritVelocity = params.inheritVelocity ?? false;
    this.id = params.id;
  }
  /** Called by `System` once every emitter is constructed. Looks up the
   *  source by name and finishes wiring this module. */
  resolveSource(emitters) {
    if (!this.pendingSourceName) return;
    const found = emitters.find((em) => em.name === this.pendingSourceName);
    if (!found) {
      throw new Error(
        `SpawnFromEvents: no emitter named "${this.pendingSourceName}" in this System.`
      );
    }
    this.source = found;
    this.pendingSourceName = void 0;
  }
  requestSpawn(_ctx) {
    return this.maxEventsPerFrame * this.perEvent;
  }
  toJSON() {
    return {
      type: _SpawnFromEvents.type,
      id: this.id,
      perEvent: this.perEvent,
      maxEventsPerFrame: this.maxEventsPerFrame,
      inheritVelocity: this.inheritVelocity
    };
  }
  static fromJSON(_data) {
    throw new Error(
      "SpawnFromEvents cannot be deserialized without a source Emitter reference. Construct manually."
    );
  }
};
registerModule(SpawnFromEvents);
var TWO_PI = Math.PI * 2;
function scalarInputTSL(input, seed, offset = 0) {
  switch (input.kind) {
    case "constant":
      return float(input.value);
    case "range": {
      const h = hash(seed.add(offset));
      return float(input.min).add(float(input.max - input.min).mul(h));
    }
    case "list": {
      const values = input.values.length > 0 ? input.values : [0];
      const arr = uniformArray(values, "float");
      const h = hash(seed.add(offset));
      const idx = h.mul(values.length).floor().toInt();
      return arr.element(idx);
    }
  }
}
function colorInputRgbTSL(input, seed, offset = 0) {
  switch (input.kind) {
    case "constant":
      return vec3(input.value[0], input.value[1], input.value[2]);
    case "range": {
      const hr = hash(seed.add(offset));
      const hg = hash(seed.add(offset + 1));
      const hb = hash(seed.add(offset + 2));
      const min2 = vec3(input.min[0], input.min[1], input.min[2]);
      const max3 = vec3(input.max[0], input.max[1], input.max[2]);
      return min2.add(max3.sub(min2).mul(vec3(hr, hg, hb)));
    }
    case "list": {
      const values = input.values.length > 0 ? input.values : [[1, 1, 1]];
      const vecs = values.map((c) => new THREE14.Vector3(c[0], c[1], c[2]));
      const arr = uniformArray(vecs, "vec3");
      const h = hash(seed.add(offset));
      const idx = h.mul(values.length).floor().toInt();
      return arr.element(idx);
    }
  }
}
function samplePositionTSL(shape, seed, offset = 0) {
  switch (shape.kind) {
    case "point":
      return vec3(0, 0, 0);
    case "sphere": {
      const rx = hash(seed.add(offset)).sub(0.5);
      const ry = hash(seed.add(offset + 1)).sub(0.5);
      const rz = hash(seed.add(offset + 2)).sub(0.5);
      const dir = vec3(rx, ry, rz).normalize();
      const thickness = shape.thickness ?? 0;
      const rInner = shape.radius * (1 - thickness);
      const rCubic = hash(seed.add(offset + 3)).pow(float(1 / 3));
      const r = float(rInner).add(float(shape.radius - rInner).mul(rCubic));
      return dir.mul(r);
    }
    case "box": {
      const hx = hash(seed.add(offset)).sub(0.5);
      const hy = hash(seed.add(offset + 1)).sub(0.5);
      const hz = hash(seed.add(offset + 2)).sub(0.5);
      return vec3(hx.mul(shape.size[0]), hy.mul(shape.size[1]), hz.mul(shape.size[2]));
    }
    case "cone": {
      const radius = shape.radius ?? 0;
      const rFrac = sqrt(hash(seed.add(offset)));
      const theta = hash(seed.add(offset + 1)).mul(TWO_PI);
      const r = rFrac.mul(radius);
      return vec3(cos(theta).mul(r), 0, sin(theta).mul(r));
    }
    case "ring": {
      const thickness = shape.thickness ?? 0;
      const rInner = shape.radius * (1 - thickness);
      const r = float(rInner).add(float(shape.radius - rInner).mul(hash(seed.add(offset))));
      const theta = hash(seed.add(offset + 1)).mul(TWO_PI);
      return vec3(cos(theta).mul(r), 0, sin(theta).mul(r));
    }
    case "disc": {
      const thickness = shape.thickness ?? 1;
      const rInner = shape.radius * (1 - thickness);
      const t = hash(seed.add(offset));
      const r = sqrt(
        float(rInner * rInner).add(float(shape.radius * shape.radius - rInner * rInner).mul(t))
      );
      const theta = hash(seed.add(offset + 1)).mul(TWO_PI);
      return vec3(cos(theta).mul(r), 0, sin(theta).mul(r));
    }
  }
}
function sampleDirectionTSL(shape, seed, offset = 0) {
  switch (shape.kind) {
    case "point":
      return vec3(0, 1, 0);
    case "cone": {
      const cosMin = Math.cos(shape.angle);
      const cosTheta = float(cosMin).add(float(1 - cosMin).mul(hash(seed.add(offset))));
      const sinTheta = sqrt(float(1).sub(cosTheta.mul(cosTheta)));
      const phi = hash(seed.add(offset + 1)).mul(TWO_PI);
      return vec3(cos(phi).mul(sinTheta), cosTheta, sin(phi).mul(sinTheta));
    }
    case "sphere":
    case "box":
    case "ring":
    case "disc":
    default: {
      const rx = hash(seed.add(offset)).sub(0.5);
      const ry = hash(seed.add(offset + 1)).sub(0.5);
      const rz = hash(seed.add(offset + 2)).sub(0.5);
      return vec3(rx, ry, rz).normalize();
    }
  }
}

// src/modules/init/init-lifetime.ts
var InitLifetime = class _InitLifetime {
  static type = "init.lifetime";
  kind = "particle_spawn";
  type = _InitLifetime.type;
  id;
  lifetime;
  constructor(params) {
    this.lifetime = params.lifetime;
    this.id = params.id;
  }
  contributeSpawnTSL(ctx) {
    const life = scalarInputTSL(this.lifetime, ctx.seed, 10);
    attr.lifetime.write(ctx.storage, ctx.slot, life);
  }
  toJSON() {
    return { type: _InitLifetime.type, id: this.id, lifetime: this.lifetime };
  }
  static fromJSON(data) {
    return new _InitLifetime({
      lifetime: data["lifetime"],
      id: data.id
    });
  }
};
registerModule(InitLifetime);
var InitPosition = class _InitPosition {
  static type = "init.position";
  kind = "particle_spawn";
  type = _InitPosition.type;
  id;
  shape;
  worldSpace;
  offset;
  constructor(params) {
    this.shape = params.shape;
    this.worldSpace = params.worldSpace ?? true;
    this.offset = params.offset ?? [0, 0, 0];
    this.id = params.id;
  }
  contributeSpawnTSL(ctx) {
    const sampled = samplePositionTSL(this.shape, ctx.seed, 20);
    const [ox, oy, oz] = this.offset;
    const localPos = ox === 0 && oy === 0 && oz === 0 ? sampled : sampled.add(vec3(ox, oy, oz));
    const worldPos = this.worldSpace ? ctx.worldMatrix.mul(vec4(localPos, 1)).xyz : localPos;
    attr.position.write(ctx.storage, ctx.slot, worldPos);
  }
  toJSON() {
    return {
      type: _InitPosition.type,
      id: this.id,
      shape: this.shape,
      worldSpace: this.worldSpace,
      offset: this.offset
    };
  }
  static fromJSON(data) {
    return new _InitPosition({
      shape: data["shape"],
      worldSpace: data["worldSpace"],
      offset: data["offset"],
      id: data.id
    });
  }
};
registerModule(InitPosition);
var InitVelocity = class _InitVelocity {
  static type = "init.velocity";
  kind = "particle_spawn";
  type = _InitVelocity.type;
  id;
  shape;
  speed;
  worldSpace;
  constructor(params) {
    this.shape = params.shape;
    this.speed = params.speed;
    this.worldSpace = params.worldSpace ?? true;
    this.id = params.id;
  }
  contributeSpawnTSL(ctx) {
    const localDir = sampleDirectionTSL(this.shape, ctx.seed, 30);
    const speed = scalarInputTSL(this.speed, ctx.seed, 40);
    const localVel = localDir.mul(speed);
    const worldVel = this.worldSpace ? ctx.worldMatrix.mul(vec4(localVel, 0)).xyz : localVel;
    attr.velocity.write(ctx.storage, ctx.slot, worldVel);
  }
  toJSON() {
    return {
      type: _InitVelocity.type,
      id: this.id,
      shape: this.shape,
      speed: this.speed,
      worldSpace: this.worldSpace
    };
  }
  static fromJSON(data) {
    return new _InitVelocity({
      shape: data["shape"],
      speed: data["speed"],
      worldSpace: data["worldSpace"],
      id: data.id
    });
  }
};
registerModule(InitVelocity);
var InitColor = class _InitColor {
  static type = "init.color";
  kind = "particle_spawn";
  type = _InitColor.type;
  id;
  color;
  alpha;
  constructor(params) {
    this.color = params.color;
    this.alpha = params.alpha ?? { kind: "constant", value: 1 };
    this.id = params.id;
  }
  contributeSpawnTSL(ctx) {
    const rgb = colorInputRgbTSL(this.color, ctx.seed, 50);
    const alpha = scalarInputTSL(this.alpha, ctx.seed, 60);
    ctx.storage.color.element(ctx.slot).assign(vec4(rgb, alpha));
  }
  toJSON() {
    return {
      type: _InitColor.type,
      id: this.id,
      color: this.color,
      alpha: this.alpha
    };
  }
  static fromJSON(data) {
    return new _InitColor({
      color: data["color"],
      alpha: data["alpha"],
      id: data.id
    });
  }
};
registerModule(InitColor);

// src/modules/init/init-size.ts
var InitSize = class _InitSize {
  static type = "init.size";
  kind = "particle_spawn";
  type = _InitSize.type;
  id;
  size;
  constructor(params) {
    this.size = params.size;
    this.id = params.id;
  }
  contributeSpawnTSL(ctx) {
    const size = scalarInputTSL(this.size, ctx.seed, 70);
    attr.size.write(ctx.storage, ctx.slot, size);
  }
  toJSON() {
    return { type: _InitSize.type, id: this.id, size: this.size };
  }
  static fromJSON(data) {
    return new _InitSize({ size: data["size"], id: data.id });
  }
};
registerModule(InitSize);

// src/modules/init/init-rotation.ts
var InitRotation = class _InitRotation {
  static type = "init.rotation";
  kind = "particle_spawn";
  type = _InitRotation.type;
  id;
  rotation;
  angularVelocity;
  constructor(params) {
    this.rotation = params.rotation ?? { kind: "constant", value: 0 };
    this.angularVelocity = params.angularVelocity ?? { kind: "constant", value: 0 };
    this.id = params.id;
  }
  contributeSpawnTSL(ctx) {
    attr.rotation.write(ctx.storage, ctx.slot, scalarInputTSL(this.rotation, ctx.seed, 80));
    attr.angularVelocity.write(
      ctx.storage,
      ctx.slot,
      scalarInputTSL(this.angularVelocity, ctx.seed, 82)
    );
  }
  toJSON() {
    return {
      type: _InitRotation.type,
      id: this.id,
      rotation: this.rotation,
      angularVelocity: this.angularVelocity
    };
  }
  static fromJSON(data) {
    return new _InitRotation({
      rotation: data["rotation"],
      angularVelocity: data["angularVelocity"],
      id: data.id
    });
  }
};
registerModule(InitRotation);
var InitFromMesh = class _InitFromMesh {
  static type = "init.from_mesh";
  kind = "particle_spawn";
  type = _InitFromMesh.type;
  id;
  worldSpace;
  fill;
  // Surface-mode buffers (null for volume).
  _triCount = 0;
  _triVerts;
  _triCdf;
  // Volume-mode buffer (null for surface).
  _volumePointCount = 0;
  _volumePoints;
  _uMeshMatrix;
  constructor(params) {
    this.worldSpace = params.worldSpace ?? true;
    this.fill = params.fill ?? "surface";
    this.id = params.id;
    this._uMeshMatrix = uniform(params.matrix?.clone() ?? new THREE14.Matrix4());
    if (this.fill === "surface") {
      const { verts, cdf } = buildTriangleCdf(params.geometry);
      this._triCount = cdf.length;
      this._triVerts = instancedArray(verts, "float");
      this._triCdf = instancedArray(cdf, "float");
    } else {
      const count = Math.max(16, params.volumeSampleCount ?? 2048);
      const points = getCachedVolumeSamples(params.geometry, count);
      this._volumePointCount = points.length / 3;
      this._volumePoints = instancedArray(points, "float");
    }
  }
  contributeSpawnTSL(ctx) {
    const localPos = this.fill === "surface" ? this._sampleSurface(ctx) : this._sampleVolume(ctx);
    const meshWorldPos = this._uMeshMatrix.mul(vec4(localPos, 1)).xyz;
    const finalPos = this.worldSpace ? ctx.worldMatrix.mul(vec4(meshWorldPos, 1)).xyz : meshWorldPos;
    attr.position.write(ctx.storage, ctx.slot, finalPos);
  }
  _sampleSurface(ctx) {
    const cdf = this._triCdf;
    const verts = this._triVerts;
    const nTris = this._triCount;
    const r0 = hash(ctx.seed.add(1001));
    const r1 = hash(ctx.seed.add(1002));
    const r2 = hash(ctx.seed.add(1003));
    const lo = float(0).toVar();
    const hi = float(nTris - 1).toVar();
    const steps = Math.ceil(Math.log2(nTris + 1));
    for (let s = 0; s < steps; s++) {
      const mid = lo.add(hi).mul(0.5).floor().toVar();
      const midVal = cdf.element(mid.toInt());
      If(midVal.lessThan(r0), () => {
        lo.assign(mid.add(1));
      }).Else(() => {
        hi.assign(mid);
      });
    }
    const triIdx = lo.toInt().toVar();
    const base = triIdx.mul(9).toVar();
    const a = vec3(verts.element(base), verts.element(base.add(1)), verts.element(base.add(2)));
    const b = vec3(
      verts.element(base.add(3)),
      verts.element(base.add(4)),
      verts.element(base.add(5))
    );
    const c = vec3(
      verts.element(base.add(6)),
      verts.element(base.add(7)),
      verts.element(base.add(8))
    );
    const uCoord = r1.toVar();
    const vCoord = r2.toVar();
    If(uCoord.add(vCoord).greaterThan(1), () => {
      uCoord.assign(float(1).sub(uCoord));
      vCoord.assign(float(1).sub(vCoord));
    });
    const wCoord = float(1).sub(uCoord).sub(vCoord);
    return a.mul(wCoord).add(b.mul(uCoord)).add(c.mul(vCoord));
  }
  _sampleVolume(ctx) {
    const points = this._volumePoints;
    const count = this._volumePointCount;
    const r = hash(ctx.seed.add(2001));
    const idx = r.mul(count).floor().toInt().toVar();
    const base = idx.mul(3);
    return vec3(points.element(base), points.element(base.add(1)), points.element(base.add(2)));
  }
  toJSON() {
    return {
      type: _InitFromMesh.type,
      id: this.id,
      worldSpace: this.worldSpace,
      fill: this.fill
      // Geometry + matrix aren't serialized — caller must re-supply on fromJSON.
    };
  }
  static fromJSON(_data) {
    throw new Error("InitFromMesh cannot be deserialized without a geometry reference.");
  }
};
registerModule(InitFromMesh);
function buildTriangleCdf(geometry) {
  const posAttr = geometry.getAttribute("position");
  if (!posAttr || !(posAttr instanceof THREE14.BufferAttribute)) {
    throw new Error("plume: InitFromMesh requires a geometry with a 'position' BufferAttribute");
  }
  const indexAttr = geometry.getIndex();
  const triCount = indexAttr ? Math.floor(indexAttr.count / 3) : Math.floor(posAttr.count / 3);
  if (triCount === 0) {
    throw new Error("plume: InitFromMesh geometry has no triangles");
  }
  const verts = new Float32Array(triCount * 9);
  const areas = new Float32Array(triCount);
  const pa = new THREE14.Vector3();
  const pb = new THREE14.Vector3();
  const pc = new THREE14.Vector3();
  const ab = new THREE14.Vector3();
  const ac = new THREE14.Vector3();
  const cross6 = new THREE14.Vector3();
  for (let i = 0; i < triCount; i++) {
    const [ia, ib, ic] = indexAttr ? [indexAttr.getX(i * 3), indexAttr.getX(i * 3 + 1), indexAttr.getX(i * 3 + 2)] : [i * 3, i * 3 + 1, i * 3 + 2];
    pa.fromBufferAttribute(posAttr, ia);
    pb.fromBufferAttribute(posAttr, ib);
    pc.fromBufferAttribute(posAttr, ic);
    verts[i * 9 + 0] = pa.x;
    verts[i * 9 + 1] = pa.y;
    verts[i * 9 + 2] = pa.z;
    verts[i * 9 + 3] = pb.x;
    verts[i * 9 + 4] = pb.y;
    verts[i * 9 + 5] = pb.z;
    verts[i * 9 + 6] = pc.x;
    verts[i * 9 + 7] = pc.y;
    verts[i * 9 + 8] = pc.z;
    ab.subVectors(pb, pa);
    ac.subVectors(pc, pa);
    cross6.crossVectors(ab, ac);
    areas[i] = cross6.length() * 0.5;
  }
  let total = 0;
  for (let i = 0; i < triCount; i++) total += areas[i];
  const cdf = new Float32Array(triCount);
  let running = 0;
  const safeTotal = total > 0 ? total : 1;
  for (let i = 0; i < triCount; i++) {
    running += areas[i];
    cdf[i] = running / safeTotal;
  }
  cdf[triCount - 1] = 1;
  return { verts, cdf };
}
var volumeSampleCache = /* @__PURE__ */ new WeakMap();
function getCachedVolumeSamples(geometry, count) {
  let byCount = volumeSampleCache.get(geometry);
  if (!byCount) {
    byCount = /* @__PURE__ */ new Map();
    volumeSampleCache.set(geometry, byCount);
  }
  let points = byCount.get(count);
  if (!points) {
    points = buildVolumeSamplePoints(geometry, count);
    byCount.set(count, points);
  }
  return points;
}
function buildVolumeSamplePoints(geometry, count) {
  const posAttr = geometry.getAttribute("position");
  if (!posAttr || !(posAttr instanceof THREE14.BufferAttribute)) {
    throw new Error("plume: InitFromMesh volume mode requires a 'position' BufferAttribute");
  }
  const tmpMesh = new THREE14.Mesh(geometry, new THREE14.MeshBasicMaterial({ side: THREE14.DoubleSide }));
  tmpMesh.updateMatrixWorld(true);
  geometry.computeBoundingBox();
  const bbox = geometry.boundingBox;
  if (!bbox) throw new Error("plume: InitFromMesh volume mode \u2014 failed to compute bounding box");
  const min2 = bbox.min;
  const max3 = bbox.max;
  const out = new Float32Array(count * 3);
  const candidate = new THREE14.Vector3();
  const rayDir = new THREE14.Vector3(1, 1e-4, 2e-4).normalize();
  const raycaster = new THREE14.Raycaster();
  raycaster.near = 0;
  raycaster.far = Infinity;
  const maxAttempts = 64;
  let filled = 0;
  let totalAttempts = 0;
  const maxTotal = count * maxAttempts;
  while (filled < count && totalAttempts < maxTotal) {
    totalAttempts++;
    candidate.set(
      min2.x + Math.random() * (max3.x - min2.x),
      min2.y + Math.random() * (max3.y - min2.y),
      min2.z + Math.random() * (max3.z - min2.z)
    );
    raycaster.set(candidate, rayDir);
    const hits = raycaster.intersectObject(tmpMesh, false);
    if (hits.length % 2 === 1) {
      out[filled * 3 + 0] = candidate.x;
      out[filled * 3 + 1] = candidate.y;
      out[filled * 3 + 2] = candidate.z;
      filled++;
    }
  }
  if (filled === 0) {
    console.warn(
      "plume: InitFromMesh volume sampling found 0 interior points \u2014 mesh may be open/non-manifold. Falling back to bounding-box samples."
    );
    for (let i = 0; i < count; i++) {
      out[i * 3 + 0] = min2.x + Math.random() * (max3.x - min2.x);
      out[i * 3 + 1] = min2.y + Math.random() * (max3.y - min2.y);
      out[i * 3 + 2] = min2.z + Math.random() * (max3.z - min2.z);
    }
    return out;
  }
  if (filled < count) {
    for (let i = filled; i < count; i++) {
      const src = i % filled;
      out[i * 3 + 0] = out[src * 3 + 0];
      out[i * 3 + 1] = out[src * 3 + 1];
      out[i * 3 + 2] = out[src * 3 + 2];
    }
  }
  return out;
}

// src/modules/update/lifetime-tick.ts
var LifetimeTick = class _LifetimeTick {
  static type = "update.lifetime_tick";
  kind = "particle_update";
  type = _LifetimeTick.type;
  id;
  constructor(params = {}) {
    this.id = params.id;
  }
  contributeUpdateTSL(_ctx) {
  }
  toJSON() {
    return { type: _LifetimeTick.type, id: this.id };
  }
  static fromJSON(data) {
    return new _LifetimeTick({ id: data.id });
  }
};
registerModule(LifetimeTick);

// src/modules/update/velocity-integrator.ts
var VelocityIntegrator = class _VelocityIntegrator {
  static type = "update.velocity_integrator";
  kind = "particle_update";
  type = _VelocityIntegrator.type;
  id;
  constructor(params = {}) {
    this.id = params.id;
  }
  contributeUpdateTSL(ctx) {
    const vel = attr.velocity.read(ctx.storage, ctx.i);
    const pos = attr.position.read(ctx.storage, ctx.i);
    attr.position.write(ctx.storage, ctx.i, pos.add(vel.mul(ctx.dt)));
    const ang = attr.angularVelocity.read(ctx.storage, ctx.i);
    const rot = attr.rotation.read(ctx.storage, ctx.i);
    attr.rotation.write(ctx.storage, ctx.i, rot.add(ang.mul(ctx.dt)));
  }
  toJSON() {
    return { type: _VelocityIntegrator.type, id: this.id };
  }
  static fromJSON(data) {
    return new _VelocityIntegrator({ id: data.id });
  }
};
registerModule(VelocityIntegrator);
var Gravity = class _Gravity {
  static type = "update.gravity";
  kind = "particle_update";
  type = _Gravity.type;
  id;
  acceleration;
  _uAccel;
  constructor(params = {}) {
    this.acceleration = params.acceleration ?? [0, -9.81, 0];
    this.id = params.id;
    this._uAccel = uniform(
      new THREE14.Vector3(this.acceleration[0], this.acceleration[1], this.acceleration[2])
    );
  }
  /** Change acceleration at runtime without rebuilding the kernel. */
  setAcceleration(x, y, z) {
    this.acceleration = [x, y, z];
    this._uAccel.value.set(x, y, z);
  }
  contributeUpdateTSL(ctx) {
    const vel = attr.velocity.read(ctx.storage, ctx.i);
    attr.velocity.write(ctx.storage, ctx.i, vel.add(this._uAccel.mul(ctx.dt)));
  }
  toJSON() {
    return { type: _Gravity.type, id: this.id, acceleration: this.acceleration };
  }
  static fromJSON(data) {
    return new _Gravity({
      acceleration: data["acceleration"],
      id: data.id
    });
  }
};
registerModule(Gravity);
var Drag = class _Drag {
  static type = "update.drag";
  kind = "particle_update";
  type = _Drag.type;
  id;
  coefficient;
  _uCoef;
  constructor(params) {
    this.coefficient = params.coefficient;
    this.id = params.id;
    this._uCoef = uniform(this.coefficient);
  }
  setCoefficient(c) {
    this.coefficient = c;
    this._uCoef.value = c;
  }
  contributeUpdateTSL(ctx) {
    const vel = attr.velocity.read(ctx.storage, ctx.i);
    const factor = this._uCoef.mul(ctx.dt).negate().exp();
    attr.velocity.write(ctx.storage, ctx.i, vel.mul(factor));
  }
  toJSON() {
    return { type: _Drag.type, id: this.id, coefficient: this.coefficient };
  }
  static fromJSON(data) {
    return new _Drag({ coefficient: Number(data["coefficient"] ?? 0), id: data.id });
  }
};
registerModule(Drag);
var ColorOverLife = class _ColorOverLife {
  static type = "update.color_over_life";
  kind = "particle_update";
  applyOnSpawn = true;
  type = _ColorOverLife.type;
  id;
  gradient;
  constructor(params) {
    this.gradient = params.gradient;
    this.id = params.id;
  }
  contributeUpdateTSL(ctx) {
    const tex = this.gradient.getTexture();
    const texNode = texture(tex);
    const age = attr.age.read(ctx.storage, ctx.i);
    const life = attr.lifetime.read(ctx.storage, ctx.i);
    const t = age.div(life).clamp(0, 1);
    const gradRgba = texNode.sample(vec2(t, 0.5));
    const initial = ctx.storage.initialColor.element(ctx.i);
    ctx.storage.color.element(ctx.i).assign(initial.mul(gradRgba));
  }
  toJSON() {
    return { type: _ColorOverLife.type, id: this.id, gradient: this.gradient.toJSON() };
  }
  static fromJSON(data) {
    return new _ColorOverLife({
      gradient: Gradient.fromJSON(data["gradient"]),
      id: data.id
    });
  }
};
registerModule(ColorOverLife);
var SizeOverLife = class _SizeOverLife {
  static type = "update.size_over_life";
  kind = "particle_update";
  applyOnSpawn = true;
  type = _SizeOverLife.type;
  id;
  curve;
  constructor(params) {
    this.curve = params.curve;
    this.id = params.id;
  }
  contributeUpdateTSL(ctx) {
    const texNode = texture(this.curve.getTexture());
    const age = attr.age.read(ctx.storage, ctx.i);
    const life = attr.lifetime.read(ctx.storage, ctx.i);
    const t = age.div(life).clamp(0, 1);
    const curveValue = texNode.sample(vec2(t, 0.5)).r;
    const initial = attr.initialSize.read(ctx.storage, ctx.i);
    attr.size.write(ctx.storage, ctx.i, initial.mul(curveValue));
  }
  toJSON() {
    return { type: _SizeOverLife.type, id: this.id, curve: this.curve.toJSON() };
  }
  static fromJSON(data) {
    return new _SizeOverLife({
      curve: Curve1D.fromJSON(data["curve"]),
      id: data.id
    });
  }
};
registerModule(SizeOverLife);
var AlphaOverLife = class _AlphaOverLife {
  static type = "update.alpha_over_life";
  kind = "particle_update";
  applyOnSpawn = true;
  type = _AlphaOverLife.type;
  id;
  curve;
  constructor(params) {
    this.curve = params.curve;
    this.id = params.id;
  }
  contributeUpdateTSL(ctx) {
    const texNode = texture(this.curve.getTexture());
    const age = attr.age.read(ctx.storage, ctx.i);
    const life = attr.lifetime.read(ctx.storage, ctx.i);
    const t = age.div(life).clamp(0, 1);
    const curveValue = texNode.sample(vec2(t, 0.5)).r;
    const current = ctx.storage.color.element(ctx.i);
    const initial = ctx.storage.initialColor.element(ctx.i);
    ctx.storage.color.element(ctx.i).assign(vec4(current.rgb, initial.a.mul(curveValue)));
  }
  toJSON() {
    return { type: _AlphaOverLife.type, id: this.id, curve: this.curve.toJSON() };
  }
  static fromJSON(data) {
    return new _AlphaOverLife({
      curve: Curve1D.fromJSON(data["curve"]),
      id: data.id
    });
  }
};
registerModule(AlphaOverLife);
var VelocityOverLife = class _VelocityOverLife {
  static type = "update.velocity_over_life";
  kind = "particle_update";
  applyOnSpawn = true;
  type = _VelocityOverLife.type;
  id;
  curve;
  constructor(params) {
    this.curve = params.curve;
    this.id = params.id;
  }
  contributeUpdateTSL(ctx) {
    const texNode = texture(this.curve.getTexture());
    const age = attr.age.read(ctx.storage, ctx.i);
    const life = attr.lifetime.read(ctx.storage, ctx.i);
    const t = age.div(life).clamp(0, 1);
    const curveValue = texNode.sample(vec2(t, 0.5)).r;
    const initial = attr.initialVelocity.read(ctx.storage, ctx.i);
    attr.velocity.write(ctx.storage, ctx.i, initial.mul(curveValue));
  }
  toJSON() {
    return { type: _VelocityOverLife.type, id: this.id, curve: this.curve.toJSON() };
  }
  static fromJSON(data) {
    return new _VelocityOverLife({
      curve: Curve1D.fromJSON(data["curve"]),
      id: data.id
    });
  }
};
registerModule(VelocityOverLife);
var FollowPosition = class _FollowPosition {
  static type = "update.follow_position";
  kind = "particle_update";
  type = _FollowPosition.type;
  id;
  _uPosition;
  _uHasFollow;
  constructor(params = {}) {
    this.id = params.id;
    this._uPosition = uniform(new THREE14.Vector3());
    this._uHasFollow = uniform(0);
  }
  setFollowPosition(position, hasFollow) {
    this._uPosition.value.copy(position);
    this._uHasFollow.value = hasFollow ? 1 : 0;
  }
  contributeUpdateTSL(ctx) {
    const systemOrigin = ctx.worldMatrix.mul(vec4(0, 0, 0, 1)).xyz;
    const target = this._uHasFollow.greaterThan(0.5).select(this._uPosition, systemOrigin);
    attr.position.write(ctx.storage, ctx.i, target);
  }
  toJSON() {
    return { type: _FollowPosition.type, id: this.id };
  }
  static fromJSON(data) {
    return new _FollowPosition({ id: data.id });
  }
};
registerModule(FollowPosition);
var TurbulenceForce = class _TurbulenceForce {
  static type = "update.turbulence_force";
  kind = "particle_update";
  type = _TurbulenceForce.type;
  id;
  amplitude;
  frequency;
  speed;
  octaves;
  _uAmp;
  _uFreq;
  _uSpeed;
  constructor(params) {
    this.amplitude = params.amplitude;
    this.frequency = params.frequency;
    this.speed = params.speed ?? 0.5;
    this.octaves = params.octaves ?? 1;
    this.id = params.id;
    this._uAmp = uniform(this.amplitude);
    this._uFreq = uniform(this.frequency);
    this._uSpeed = uniform(this.speed);
  }
  contributeUpdateTSL(ctx) {
    const pos = attr.position.read(ctx.storage, ctx.i);
    const time = ctx.emitterTime.mul(this._uSpeed);
    const p0 = pos.mul(this._uFreq).add(vec3(time, 0, 0));
    const p1 = pos.mul(this._uFreq).add(vec3(17.1, 13.9, 43.7).add(vec3(0, time, 0)));
    const p2 = pos.mul(this._uFreq).add(vec3(79.3, 53.2, 31.4).add(vec3(0, 0, time)));
    const n0 = mx_fractal_noise_vec3(p0);
    const n1 = mx_fractal_noise_vec3(p1);
    const n2 = mx_fractal_noise_vec3(p2);
    const force = vec3(n0.x, n1.y, n2.z).mul(this._uAmp);
    const vel = attr.velocity.read(ctx.storage, ctx.i);
    attr.velocity.write(ctx.storage, ctx.i, vel.add(force.mul(ctx.dt)));
  }
  toJSON() {
    return {
      type: _TurbulenceForce.type,
      id: this.id,
      amplitude: this.amplitude,
      frequency: this.frequency,
      speed: this.speed,
      octaves: this.octaves
    };
  }
  static fromJSON(data) {
    return new _TurbulenceForce({
      amplitude: Number(data["amplitude"] ?? 0),
      frequency: Number(data["frequency"] ?? 1),
      speed: data["speed"],
      octaves: data["octaves"],
      id: data.id
    });
  }
};
registerModule(TurbulenceForce);
var CurlNoiseForce = class _CurlNoiseForce {
  static type = "update.curl_noise_force";
  kind = "particle_update";
  type = _CurlNoiseForce.type;
  id;
  amplitude;
  frequency;
  speed;
  _uAmp;
  _uFreq;
  _uSpeed;
  constructor(params) {
    this.amplitude = params.amplitude;
    this.frequency = params.frequency;
    this.speed = params.speed ?? 0.5;
    this.id = params.id;
    this._uAmp = uniform(this.amplitude);
    this._uFreq = uniform(this.frequency);
    this._uSpeed = uniform(this.speed);
  }
  contributeUpdateTSL(ctx) {
    const OFF_Y = vec3(31.416, 47.853, 53.089);
    const OFF_Z = vec3(83.517, 71.239, 19.841);
    const H = 0.01;
    const pos = attr.position.read(ctx.storage, ctx.i);
    const t = ctx.emitterTime.mul(this._uSpeed);
    const p = pos.mul(this._uFreq).add(vec3(t, t, t));
    const px = p;
    const py = p.add(OFF_Y);
    const pz = p.add(OFF_Z);
    const hx = vec3(H, 0, 0);
    const hy = vec3(0, H, 0);
    const hz = vec3(0, 0, H);
    const invH2 = 1 / (2 * H);
    const dPz_dy = mx_noise_vec3(pz.add(hy)).sub(mx_noise_vec3(pz.sub(hy))).mul(invH2);
    const dPy_dz = mx_noise_vec3(py.add(hz)).sub(mx_noise_vec3(py.sub(hz))).mul(invH2);
    const dPx_dz = mx_noise_vec3(px.add(hz)).sub(mx_noise_vec3(px.sub(hz))).mul(invH2);
    const dPz_dx = mx_noise_vec3(pz.add(hx)).sub(mx_noise_vec3(pz.sub(hx))).mul(invH2);
    const dPy_dx = mx_noise_vec3(py.add(hx)).sub(mx_noise_vec3(py.sub(hx))).mul(invH2);
    const dPx_dy = mx_noise_vec3(px.add(hy)).sub(mx_noise_vec3(px.sub(hy))).mul(invH2);
    const curl = vec3(dPz_dy.y.sub(dPy_dz.z), dPx_dz.z.sub(dPz_dx.x), dPy_dx.x.sub(dPx_dy.y));
    const force = curl.mul(this._uAmp);
    const vel = attr.velocity.read(ctx.storage, ctx.i);
    attr.velocity.write(ctx.storage, ctx.i, vel.add(force.mul(ctx.dt)));
  }
  toJSON() {
    return {
      type: _CurlNoiseForce.type,
      id: this.id,
      amplitude: this.amplitude,
      frequency: this.frequency,
      speed: this.speed
    };
  }
  static fromJSON(data) {
    return new _CurlNoiseForce({
      amplitude: Number(data["amplitude"] ?? 0),
      frequency: Number(data["frequency"] ?? 1),
      speed: data["speed"],
      id: data.id
    });
  }
};
registerModule(CurlNoiseForce);
var VortexForce = class _VortexForce {
  static type = "update.vortex_force";
  kind = "particle_update";
  type = _VortexForce.type;
  id;
  axis;
  origin;
  strength;
  worldSpace;
  _uAxis;
  _uOrigin;
  _uStrength;
  constructor(params) {
    this.axis = params.axis ?? [0, 1, 0];
    this.origin = params.origin ?? [0, 0, 0];
    this.strength = params.strength;
    this.worldSpace = params.worldSpace ?? false;
    this.id = params.id;
    const a = new THREE14.Vector3(this.axis[0], this.axis[1], this.axis[2]);
    if (a.lengthSq() > 0) a.normalize();
    else a.set(0, 1, 0);
    this._uAxis = uniform(a);
    this._uOrigin = uniform(
      new THREE14.Vector3(this.origin[0], this.origin[1], this.origin[2])
    );
    this._uStrength = uniform(this.strength);
  }
  contributeUpdateTSL(ctx) {
    const pos = attr.position.read(ctx.storage, ctx.i);
    const originWorld = this.worldSpace ? this._uOrigin : ctx.worldMatrix.mul(vec4(this._uOrigin, 1)).xyz;
    const radial = pos.sub(originWorld);
    const tangent = cross(this._uAxis, radial);
    const vel = attr.velocity.read(ctx.storage, ctx.i);
    attr.velocity.write(ctx.storage, ctx.i, vel.add(tangent.mul(this._uStrength).mul(ctx.dt)));
  }
  toJSON() {
    return {
      type: _VortexForce.type,
      id: this.id,
      axis: this.axis,
      origin: this.origin,
      strength: this.strength,
      worldSpace: this.worldSpace
    };
  }
  static fromJSON(data) {
    return new _VortexForce({
      axis: data["axis"],
      origin: data["origin"],
      strength: Number(data["strength"] ?? 0),
      worldSpace: data["worldSpace"],
      id: data.id
    });
  }
};
registerModule(VortexForce);
var PointAttractor = class _PointAttractor {
  static type = "update.point_attractor";
  kind = "particle_update";
  type = _PointAttractor.type;
  id;
  position;
  strength;
  radius;
  falloff;
  worldSpace;
  _uLocalPos;
  _uStrength;
  _uRadius;
  constructor(params) {
    this.position = params.position ?? [0, 0, 0];
    this.strength = params.strength;
    this.radius = params.radius;
    this.falloff = params.falloff ?? "linear";
    this.worldSpace = params.worldSpace ?? false;
    this.id = params.id;
    this._uLocalPos = uniform(
      new THREE14.Vector3(this.position[0], this.position[1], this.position[2])
    );
    this._uStrength = uniform(this.strength);
    this._uRadius = uniform(this.radius);
  }
  contributeUpdateTSL(ctx) {
    const pos = attr.position.read(ctx.storage, ctx.i).toVar();
    const targetLocal = this._uLocalPos;
    const targetWorld = this.worldSpace ? targetLocal : ctx.worldMatrix.mul(vec4(targetLocal, 1)).xyz;
    const toTarget = targetWorld.sub(pos).toVar();
    const dist = toTarget.length();
    If(dist.lessThan(this._uRadius).and(dist.greaterThan(1e-4)), () => {
      const normDist = dist.div(this._uRadius);
      let f;
      switch (this.falloff) {
        case "linear":
          f = float(1).sub(normDist);
          break;
        case "inverse":
          f = float(1).div(normDist).sub(1);
          break;
        case "inverseSquared":
          f = float(1).div(normDist.mul(normDist)).sub(1);
          break;
        case "none":
        default:
          f = float(1);
          break;
      }
      const dir = toTarget.div(dist);
      const force = dir.mul(this._uStrength).mul(f);
      const vel = attr.velocity.read(ctx.storage, ctx.i);
      attr.velocity.write(ctx.storage, ctx.i, vel.add(force.mul(ctx.dt)));
    });
  }
  toJSON() {
    return {
      type: _PointAttractor.type,
      id: this.id,
      position: this.position,
      strength: this.strength,
      radius: this.radius,
      falloff: this.falloff,
      worldSpace: this.worldSpace
    };
  }
  static fromJSON(data) {
    return new _PointAttractor({
      position: data["position"],
      strength: Number(data["strength"] ?? 0),
      radius: Number(data["radius"] ?? 1),
      falloff: data["falloff"],
      worldSpace: data["worldSpace"],
      id: data.id
    });
  }
};
registerModule(PointAttractor);
var ScaleBySpeed = class _ScaleBySpeed {
  static type = "update.scale_by_speed";
  kind = "particle_update";
  applyOnSpawn = true;
  type = _ScaleBySpeed.type;
  id;
  minSpeed;
  maxSpeed;
  minScale;
  maxScale;
  _uMinSpeed;
  _uMaxSpeed;
  _uMinScale;
  _uMaxScale;
  constructor(params) {
    this.minSpeed = params.minSpeed ?? 0;
    this.maxSpeed = params.maxSpeed;
    this.minScale = params.minScale ?? 1;
    this.maxScale = params.maxScale ?? 2;
    this.id = params.id;
    this._uMinSpeed = uniform(this.minSpeed);
    this._uMaxSpeed = uniform(this.maxSpeed);
    this._uMinScale = uniform(this.minScale);
    this._uMaxScale = uniform(this.maxScale);
  }
  contributeUpdateTSL(ctx) {
    const vel = attr.velocity.read(ctx.storage, ctx.i);
    const speed = length(vel);
    const span = this._uMaxSpeed.sub(this._uMinSpeed).max(1e-4);
    const t = clamp(speed.sub(this._uMinSpeed).div(span), 0, 1);
    const scaleFactor = this._uMinScale.add(this._uMaxScale.sub(this._uMinScale).mul(t));
    const baseSize = attr.initialSize.read(ctx.storage, ctx.i);
    attr.size.write(ctx.storage, ctx.i, baseSize.mul(scaleFactor));
  }
  toJSON() {
    return {
      type: _ScaleBySpeed.type,
      id: this.id,
      minSpeed: this.minSpeed,
      maxSpeed: this.maxSpeed,
      minScale: this.minScale,
      maxScale: this.maxScale
    };
  }
  static fromJSON(data) {
    return new _ScaleBySpeed({
      minSpeed: data["minSpeed"],
      maxSpeed: Number(data["maxSpeed"] ?? 1),
      minScale: data["minScale"],
      maxScale: data["maxScale"],
      id: data.id
    });
  }
};
registerModule(ScaleBySpeed);
var PlaneCollision = class _PlaneCollision {
  static type = "update.plane_collision";
  kind = "particle_update";
  type = _PlaneCollision.type;
  id;
  normal;
  point;
  restitution;
  friction;
  worldSpace;
  _uNormal;
  _uPoint;
  _uRestitution;
  _uFriction;
  constructor(params = {}) {
    this.normal = params.normal ?? [0, 1, 0];
    this.point = params.point ?? [0, 0, 0];
    this.restitution = params.restitution ?? 0.5;
    this.friction = params.friction ?? 0.9;
    this.worldSpace = params.worldSpace ?? false;
    this.id = params.id;
    const n = new THREE14.Vector3(this.normal[0], this.normal[1], this.normal[2]);
    if (n.lengthSq() > 0) n.normalize();
    else n.set(0, 1, 0);
    this._uNormal = uniform(n);
    this._uPoint = uniform(
      new THREE14.Vector3(this.point[0], this.point[1], this.point[2])
    );
    this._uRestitution = uniform(this.restitution);
    this._uFriction = uniform(this.friction);
  }
  contributeUpdateTSL(ctx) {
    const pos = attr.position.read(ctx.storage, ctx.i).toVar();
    const vel = attr.velocity.read(ctx.storage, ctx.i).toVar();
    const normal = this.worldSpace ? this._uNormal : ctx.worldMatrix.mul(vec4(this._uNormal, 0)).xyz;
    const planePoint = this.worldSpace ? this._uPoint : ctx.worldMatrix.mul(vec4(this._uPoint, 1)).xyz;
    const signedDist = dot(pos.sub(planePoint), normal);
    If(signedDist.lessThan(0), () => {
      pos.assign(pos.sub(normal.mul(signedDist)));
      const vn = dot(vel, normal);
      If(vn.lessThan(0), () => {
        const normalVel = normal.mul(vn);
        const tangentVel = vel.sub(normalVel);
        vel.assign(tangentVel.mul(this._uFriction).sub(normalVel.mul(this._uRestitution)));
      });
      attr.position.write(ctx.storage, ctx.i, pos);
      attr.velocity.write(ctx.storage, ctx.i, vel);
    });
  }
  toJSON() {
    return {
      type: _PlaneCollision.type,
      id: this.id,
      normal: this.normal,
      point: this.point,
      restitution: this.restitution,
      friction: this.friction,
      worldSpace: this.worldSpace
    };
  }
  static fromJSON(data) {
    return new _PlaneCollision({
      normal: data["normal"],
      point: data["point"],
      restitution: data["restitution"],
      friction: data["friction"],
      worldSpace: data["worldSpace"],
      id: data.id
    });
  }
};
registerModule(PlaneCollision);
var SphereCollision = class _SphereCollision {
  static type = "update.sphere_collision";
  kind = "particle_update";
  type = _SphereCollision.type;
  id;
  center;
  radius;
  outside;
  restitution;
  friction;
  worldSpace;
  _uCenter;
  _uRadius;
  _uRestitution;
  _uFriction;
  constructor(params) {
    this.center = params.center ?? [0, 0, 0];
    this.radius = params.radius;
    this.outside = params.outside ?? true;
    this.restitution = params.restitution ?? 0.5;
    this.friction = params.friction ?? 0.9;
    this.worldSpace = params.worldSpace ?? false;
    this.id = params.id;
    this._uCenter = uniform(
      new THREE14.Vector3(this.center[0], this.center[1], this.center[2])
    );
    this._uRadius = uniform(this.radius);
    this._uRestitution = uniform(this.restitution);
    this._uFriction = uniform(this.friction);
  }
  contributeUpdateTSL(ctx) {
    const pos = attr.position.read(ctx.storage, ctx.i).toVar();
    const vel = attr.velocity.read(ctx.storage, ctx.i).toVar();
    const center = this.worldSpace ? this._uCenter : ctx.worldMatrix.mul(vec4(this._uCenter, 1)).xyz;
    const offset = pos.sub(center);
    const dist = length(offset).max(1e-4);
    const normal = offset.div(dist);
    const penetrating = this.outside ? dist.lessThan(this._uRadius) : dist.greaterThan(this._uRadius);
    If(penetrating, () => {
      const surfaceNormal = this.outside ? normal : normal.negate();
      pos.assign(center.add(surfaceNormal.mul(this._uRadius)));
      const vn = dot(vel, surfaceNormal);
      If(vn.lessThan(0), () => {
        const normalVel = surfaceNormal.mul(vn);
        const tangentVel = vel.sub(normalVel);
        vel.assign(tangentVel.mul(this._uFriction).sub(normalVel.mul(this._uRestitution)));
      });
      attr.position.write(ctx.storage, ctx.i, pos);
      attr.velocity.write(ctx.storage, ctx.i, vel);
    });
  }
  toJSON() {
    return {
      type: _SphereCollision.type,
      id: this.id,
      center: this.center,
      radius: this.radius,
      outside: this.outside,
      restitution: this.restitution,
      friction: this.friction,
      worldSpace: this.worldSpace
    };
  }
  static fromJSON(data) {
    return new _SphereCollision({
      center: data["center"],
      radius: Number(data["radius"] ?? 1),
      outside: data["outside"],
      restitution: data["restitution"],
      friction: data["friction"],
      worldSpace: data["worldSpace"],
      id: data.id
    });
  }
};
registerModule(SphereCollision);
var LimitVelocity = class _LimitVelocity {
  static type = "update.limit_velocity";
  kind = "particle_update";
  type = _LimitVelocity.type;
  id;
  maxSpeed;
  damping;
  _uMax;
  _uDamping;
  constructor(params) {
    this.maxSpeed = params.maxSpeed;
    this.damping = params.damping ?? 1;
    this.id = params.id;
    this._uMax = uniform(this.maxSpeed);
    this._uDamping = uniform(this.damping);
  }
  contributeUpdateTSL(ctx) {
    const vel = attr.velocity.read(ctx.storage, ctx.i).toVar();
    const speed = length(vel);
    If(speed.greaterThan(this._uMax), () => {
      const targetSpeed = speed.add(this._uMax.sub(speed).mul(this._uDamping));
      const scale = targetSpeed.div(speed);
      attr.velocity.write(ctx.storage, ctx.i, vel.mul(scale));
    });
  }
  toJSON() {
    return {
      type: _LimitVelocity.type,
      id: this.id,
      maxSpeed: this.maxSpeed,
      damping: this.damping
    };
  }
  static fromJSON(data) {
    return new _LimitVelocity({
      maxSpeed: Number(data["maxSpeed"] ?? 1),
      damping: data["damping"],
      id: data.id
    });
  }
};
registerModule(LimitVelocity);
var FlowmapForce = class _FlowmapForce {
  static type = "update.flowmap_force";
  kind = "particle_update";
  type = _FlowmapForce.type;
  id;
  texture;
  origin;
  size;
  axis;
  amplitude;
  _uOrigin;
  _uInvSize;
  _uAmplitude;
  constructor(params) {
    this.texture = params.texture;
    this.origin = params.origin;
    this.size = params.size;
    this.axis = params.axis ?? "xz";
    this.amplitude = params.amplitude ?? 1;
    this.id = params.id;
    this._uOrigin = uniform(
      new THREE14.Vector3(this.origin[0], this.origin[1], this.origin[2])
    );
    this._uInvSize = uniform(
      new THREE14.Vector2(1 / Math.max(this.size[0], 1e-6), 1 / Math.max(this.size[1], 1e-6))
    );
    this._uAmplitude = uniform(this.amplitude);
  }
  contributeUpdateTSL(ctx) {
    const pos = attr.position.read(ctx.storage, ctx.i);
    const tex = texture(this.texture);
    const rel = pos.sub(this._uOrigin);
    let u;
    let v;
    let force;
    switch (this.axis) {
      case "xz": {
        u = rel.x.mul(this._uInvSize.x);
        v = rel.z.mul(this._uInvSize.y);
        const sample = tex.sample(vec2(u, v));
        const dir2 = vec2(sample.r.mul(2).sub(1), sample.g.mul(2).sub(1));
        force = vec3(dir2.x, 0, dir2.y);
        break;
      }
      case "xy": {
        u = rel.x.mul(this._uInvSize.x);
        v = rel.y.mul(this._uInvSize.y);
        const sample = tex.sample(vec2(u, v));
        const dir2 = vec2(sample.r.mul(2).sub(1), sample.g.mul(2).sub(1));
        force = vec3(dir2.x, dir2.y, 0);
        break;
      }
      case "yz": {
        u = rel.y.mul(this._uInvSize.x);
        v = rel.z.mul(this._uInvSize.y);
        const sample = tex.sample(vec2(u, v));
        const dir2 = vec2(sample.r.mul(2).sub(1), sample.g.mul(2).sub(1));
        force = vec3(0, dir2.x, dir2.y);
        break;
      }
    }
    const vel = attr.velocity.read(ctx.storage, ctx.i);
    attr.velocity.write(ctx.storage, ctx.i, vel.add(force.mul(this._uAmplitude).mul(ctx.dt)));
  }
  toJSON() {
    return {
      type: _FlowmapForce.type,
      id: this.id,
      origin: this.origin,
      size: this.size,
      axis: this.axis,
      amplitude: this.amplitude
      // texture isn't serializable — caller must re-supply on fromJSON.
    };
  }
  static fromJSON(_data) {
    throw new Error("FlowmapForce cannot be deserialized without a texture reference.");
  }
};
registerModule(FlowmapForce);
var DepthCollision = class _DepthCollision {
  static type = "update.depth_collision";
  kind = "particle_update";
  type = _DepthCollision.type;
  id;
  mode;
  normal;
  restitution;
  friction;
  thickness;
  camera;
  depthTexture;
  _uViewProj;
  _uInvViewProj;
  _uCameraForward;
  _uTexelSize;
  _uRestitution;
  _uFriction;
  _uThickness;
  _tmpDir = new THREE14.Vector3();
  _tmpMat = new THREE14.Matrix4();
  constructor(params) {
    this.depthTexture = params.depthTexture;
    this.camera = params.camera;
    this.mode = params.mode ?? "bounce";
    this.normal = params.normal ?? "depth-gradient";
    this.restitution = params.restitution ?? 0.5;
    this.friction = params.friction ?? 0.9;
    this.thickness = params.thickness ?? 5e-4;
    this.id = params.id;
    this._uViewProj = uniform(new THREE14.Matrix4());
    this._uInvViewProj = uniform(new THREE14.Matrix4());
    this._uCameraForward = uniform(new THREE14.Vector3(0, 0, -1));
    this._uTexelSize = uniform(new THREE14.Vector2(1 / 1920, 1 / 1080));
    this._uRestitution = uniform(this.restitution);
    this._uFriction = uniform(this.friction);
    this._uThickness = uniform(this.thickness);
  }
  beforeUpdate(_dt, _camera) {
    this.camera.updateMatrixWorld();
    this._uViewProj.value.multiplyMatrices(
      this.camera.projectionMatrix,
      this.camera.matrixWorldInverse
    );
    this._tmpMat.copy(this._uViewProj.value).invert();
    this._uInvViewProj.value.copy(this._tmpMat);
    this.camera.getWorldDirection(this._tmpDir);
    this._uCameraForward.value.copy(this._tmpDir);
    const img = this.depthTexture.image;
    const w = img?.width ?? 1920;
    const h = img?.height ?? 1080;
    this._uTexelSize.value.set(1 / Math.max(1, w), 1 / Math.max(1, h));
  }
  contributeUpdateTSL(ctx) {
    const pos = attr.position.read(ctx.storage, ctx.i);
    const depthTex = texture(this.depthTexture);
    const clipPos = this._uViewProj.mul(vec4(pos, 1));
    const ndcW = clipPos.w.max(1e-4);
    const ndcX = clipPos.x.div(ndcW);
    const ndcY = clipPos.y.div(ndcW);
    const ndcZ = clipPos.z.div(ndcW);
    const uvX = ndcX.mul(0.5).add(0.5);
    const uvY = ndcY.mul(-0.5).add(0.5);
    const sampleUv = vec2(uvX, uvY);
    const inBounds = uvX.greaterThan(0).and(uvX.lessThan(1)).and(uvY.greaterThan(0)).and(uvY.lessThan(1)).and(ndcZ.greaterThan(0)).and(ndcZ.lessThan(1));
    const sceneDepth = depthTex.sample(sampleUv).r;
    const collided = inBounds.and(ndcZ.greaterThan(sceneDepth.add(this._uThickness)));
    If(collided, () => {
      if (this.mode === "kill") {
        attr.alive.write(ctx.storage, ctx.i, float(0));
      } else if (this.mode === "stop") {
        attr.velocity.write(ctx.storage, ctx.i, vec3(0, 0, 0));
      } else {
        const vel = attr.velocity.read(ctx.storage, ctx.i);
        const n = this.normal === "depth-gradient" ? this._reconstructNormal(depthTex, sampleUv, sceneDepth) : this._uCameraForward.negate();
        const vDotN = dot(vel, n);
        const vNormal = n.mul(vDotN);
        const vTangent = vel.sub(vNormal);
        const reflected = vTangent.mul(this._uFriction).sub(vNormal.mul(this._uRestitution));
        attr.velocity.write(ctx.storage, ctx.i, reflected);
      }
    });
  }
  /**
   * Reconstruct world-space surface normal at the sampled depth pixel by unprojecting three
   * points (center + one pixel in X + one pixel in Y) and taking the cross product. Ensures
   * the normal faces the camera (flips if not).
   */
  _reconstructNormal(depthTex, centerUv, centerDepth) {
    const texel = this._uTexelSize;
    const invVP = this._uInvViewProj;
    const uvX = centerUv.x.add(texel.x);
    const uvY = centerUv.y.add(texel.y);
    const uvRight = vec2(uvX, centerUv.y);
    const uvDown = vec2(centerUv.x, uvY);
    const depthRight = depthTex.sample(uvRight).r;
    const depthDown = depthTex.sample(uvDown).r;
    const toWorld = (uv2, d) => {
      const ndc = vec4(uv2.x.mul(2).sub(1), uv2.y.mul(-2).add(1), d, 1);
      const world4 = invVP.mul(ndc);
      return world4.xyz.div(world4.w);
    };
    const p0 = toWorld(centerUv, centerDepth);
    const pR = toWorld(uvRight, depthRight);
    const pD = toWorld(uvDown, depthDown);
    const dRight = pR.sub(p0);
    const dDown = pD.sub(p0);
    const n = normalize(cross(dRight, dDown));
    return n;
  }
  toJSON() {
    return {
      type: _DepthCollision.type,
      id: this.id,
      mode: this.mode,
      normal: this.normal,
      restitution: this.restitution,
      friction: this.friction,
      thickness: this.thickness
      // depthTexture + camera aren't serializable — caller must re-supply on fromJSON.
    };
  }
  static fromJSON(_data) {
    throw new Error(
      "DepthCollision cannot be deserialized without a depthTexture + camera reference."
    );
  }
};
registerModule(DepthCollision);
var SdfCollision = class _SdfCollision {
  static type = "update.sdf_collision";
  kind = "particle_update";
  type = _SdfCollision.type;
  id;
  sdf;
  mode;
  restitution;
  friction;
  thickness;
  gradientEpsilon;
  _uRestitution;
  _uFriction;
  _uThickness;
  _uEps;
  constructor(params) {
    this.sdf = params.sdf;
    this.mode = params.mode ?? "bounce";
    this.restitution = params.restitution ?? 0.5;
    this.friction = params.friction ?? 0.9;
    this.thickness = params.thickness ?? 0.02;
    this.gradientEpsilon = params.gradientEpsilon ?? 0.01;
    this.id = params.id;
    this._uRestitution = uniform(this.restitution);
    this._uFriction = uniform(this.friction);
    this._uThickness = uniform(this.thickness);
    this._uEps = uniform(this.gradientEpsilon);
  }
  contributeUpdateTSL(ctx) {
    const pos = attr.position.read(ctx.storage, ctx.i);
    const d = this.sdf(pos);
    const collided = d.lessThan(this._uThickness);
    If(collided, () => {
      if (this.mode === "kill") {
        attr.alive.write(ctx.storage, ctx.i, float(0));
      } else if (this.mode === "stop") {
        attr.velocity.write(ctx.storage, ctx.i, vec3(0, 0, 0));
      } else {
        const n = this._gradientNormal(pos);
        const pushed = pos.add(n.mul(this._uThickness.sub(d)));
        attr.position.write(ctx.storage, ctx.i, pushed);
        const vel = attr.velocity.read(ctx.storage, ctx.i);
        const vDotN = dot(vel, n);
        const vNormal = n.mul(vDotN);
        const vTangent = vel.sub(vNormal);
        const reflected = vTangent.mul(this._uFriction).sub(vNormal.mul(this._uRestitution));
        attr.velocity.write(ctx.storage, ctx.i, reflected);
      }
    });
  }
  /**
   * SDF gradient via Christensen's tetrahedron offsets — 4 SDF evaluations instead of 6
   * for central differences, with identical accuracy at typical epsilons.
   */
  _gradientNormal(p) {
    const h = this._uEps;
    const k1 = vec3(1, -1, -1);
    const k2 = vec3(-1, -1, 1);
    const k3 = vec3(-1, 1, -1);
    const k4 = vec3(1, 1, 1);
    const d1 = this.sdf(p.add(k1.mul(h)));
    const d2 = this.sdf(p.add(k2.mul(h)));
    const d3 = this.sdf(p.add(k3.mul(h)));
    const d4 = this.sdf(p.add(k4.mul(h)));
    const grad = k1.mul(d1).add(k2.mul(d2)).add(k3.mul(d3)).add(k4.mul(d4));
    return normalize(grad);
  }
  toJSON() {
    return {
      type: _SdfCollision.type,
      id: this.id,
      mode: this.mode,
      restitution: this.restitution,
      friction: this.friction,
      thickness: this.thickness,
      gradientEpsilon: this.gradientEpsilon
      // sdf function isn't serializable — caller must re-supply on fromJSON.
    };
  }
  static fromJSON(_data) {
    throw new Error("SdfCollision cannot be deserialized without an `sdf` function reference.");
  }
};
registerModule(SdfCollision);
function normalizeTextures(input) {
  if (!input) return {};
  if (input instanceof THREE14.Texture) return { base: input };
  return input;
}
function buildTextureNodes(textures) {
  const out = {};
  for (const [key, tex] of Object.entries(textures)) {
    out[key] = texture(tex);
  }
  return out;
}
function scrollUV(uv2, speed, time) {
  return uv2.add(speed.mul(time)).fract();
}
function safeLifetimeT(age, lifetime) {
  return age.div(lifetime.max(1e-4)).clamp(0, 1);
}
var cache = /* @__PURE__ */ new Map();
function softCircleTexture(size = 64) {
  const key = `soft_circle_${size}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const data = new Uint8Array(size * size * 4);
  const half = size * 0.5;
  const inv = 1 / half;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (x + 0.5 - half) * inv;
      const dy = (y + 0.5 - half) * inv;
      const r = Math.sqrt(dx * dx + dy * dy);
      const a = Math.max(0, 1 - r);
      const s = a * a * (3 - 2 * a);
      const i = (y * size + x) * 4;
      data[i] = 255;
      data[i + 1] = 255;
      data[i + 2] = 255;
      data[i + 3] = Math.round(s * 255);
    }
  }
  const tex = new THREE14.DataTexture(data, size, size, THREE14.RGBAFormat, THREE14.UnsignedByteType);
  tex.minFilter = THREE14.LinearFilter;
  tex.magFilter = THREE14.LinearFilter;
  tex.wrapS = THREE14.ClampToEdgeWrapping;
  tex.wrapT = THREE14.ClampToEdgeWrapping;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  cache.set(key, tex);
  return tex;
}
function circleTexture(size = 64) {
  const key = `circle_${size}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const data = new Uint8Array(size * size * 4);
  const half = size * 0.5;
  const rr = (half - 1) * (half - 1);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x + 0.5 - half;
      const dy = y + 0.5 - half;
      const inside = dx * dx + dy * dy <= rr;
      const i = (y * size + x) * 4;
      data[i] = 255;
      data[i + 1] = 255;
      data[i + 2] = 255;
      data[i + 3] = inside ? 255 : 0;
    }
  }
  const tex = new THREE14.DataTexture(data, size, size, THREE14.RGBAFormat, THREE14.UnsignedByteType);
  tex.minFilter = THREE14.LinearFilter;
  tex.magFilter = THREE14.LinearFilter;
  tex.needsUpdate = true;
  cache.set(key, tex);
  return tex;
}
function streakTexture(width = 128, height = 32) {
  const key = `streak_${width}_${height}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const fx = (x + 0.5) / width;
      const fy = (y + 0.5) / height - 0.5;
      const lengthFalloff = 1 - Math.abs(fx * 2 - 1);
      const widthFalloff = Math.max(0, 1 - Math.abs(fy) * 2);
      const a = lengthFalloff * widthFalloff;
      const i = (y * width + x) * 4;
      data[i] = 255;
      data[i + 1] = 255;
      data[i + 2] = 255;
      data[i + 3] = Math.round(Math.min(1, a) * 255);
    }
  }
  const tex = new THREE14.DataTexture(data, width, height, THREE14.RGBAFormat, THREE14.UnsignedByteType);
  tex.minFilter = THREE14.LinearFilter;
  tex.magFilter = THREE14.LinearFilter;
  tex.needsUpdate = true;
  cache.set(key, tex);
  return tex;
}
function disposeTextureCache() {
  for (const tex of cache.values()) tex.dispose();
  cache.clear();
}

// src/modules/render/sprite-renderer.ts
var SLOT_MASK = (1 << 10) - 1;
var SpriteRenderer = class _SpriteRenderer {
  static type = "render.sprite";
  kind = "render";
  type = _SpriteRenderer.type;
  id;
  blending;
  opacity;
  depthWrite;
  depthTest;
  renderOrder;
  textureRef;
  animation;
  orientation;
  facingAngle;
  object3D;
  _mesh;
  _geometry;
  _material;
  _textures;
  _colorNode;
  _setOpacity = () => {
  };
  _uTime = uniform(0, "float");
  constructor(params = {}) {
    this.blending = params.blending ?? "additive";
    this.opacity = params.opacity ?? 1;
    this.depthWrite = params.depthWrite ?? false;
    this.depthTest = params.depthTest ?? true;
    this.renderOrder = params.renderOrder ?? 0;
    this.id = params.id;
    this.textureRef = params.textureRef;
    this.animation = params.animation;
    this.orientation = params.orientation ?? "camera";
    this.facingAngle = params.facingAngle ?? 0;
    this._colorNode = params.colorNode;
    const explicitMap = params.textures ? normalizeTextures(params.textures) : null;
    if (explicitMap && Object.keys(explicitMap).length > 0) {
      this._textures = explicitMap;
    } else if (params.texture) {
      this._textures = { base: params.texture };
    } else {
      this._textures = { base: softCircleTexture(64) };
    }
    this.object3D = new THREE14.Group();
    this.object3D.frustumCulled = false;
    this.object3D.matrixAutoUpdate = false;
    this.object3D.renderOrder = this.renderOrder;
  }
  init(storage, capacity, opts) {
    const geom = new THREE14.BufferGeometry();
    const quadPos = new Float32Array([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0]);
    const quadUv = new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]);
    geom.setAttribute("position", new THREE14.BufferAttribute(quadPos, 3));
    geom.setAttribute("uv", new THREE14.BufferAttribute(quadUv, 2));
    geom.setIndex([0, 1, 2, 0, 2, 3]);
    const orientation = this.orientation;
    const facingRad = this.facingAngle * Math.PI / 180;
    const material = new MeshBasicNodeMaterial({
      transparent: true,
      // Flat and wall quads are seen from both sides; camera-facing ones never are.
      side: orientation === "camera" ? THREE14.FrontSide : THREE14.DoubleSide,
      depthWrite: this.depthWrite,
      depthTest: this.depthTest,
      blending: this._resolveBlending()
    });
    material.toneMapped = false;
    const textureNodes = buildTextureNodes(this._textures);
    const opacityUniform = uniform(this.opacity, "float");
    this._setOpacity = (v) => {
      opacityUniform.value = v;
    };
    const sortIndices = opts?.sortIndices;
    material.vertexNode = Fn(() => {
      const effectiveIdx = sortIndices ? sortIndices.element(instanceIndex).bitAnd(uint(SLOT_MASK)).toInt() : instanceIndex.toInt();
      const posAlive = storage.posAlive.element(effectiveIdx).toVar();
      const traits = storage.traits.element(effectiveIdx).toVar();
      const pos = posAlive.xyz;
      const aliveFlag = posAlive.w;
      const scale = traits.x;
      const rotation = traits.y;
      const mvCenter = modelViewMatrix.mul(vec4(pos, 1));
      const c = cos(rotation);
      const s = sin(rotation);
      const effectiveScale = scale.mul(aliveFlag);
      const scaled = positionLocal.xy.mul(effectiveScale);
      if (orientation === "camera") {
        const offsetX2 = scaled.x.mul(c).sub(scaled.y.mul(s));
        const offsetY2 = scaled.x.mul(s).add(scaled.y.mul(c));
        const mvFinal2 = mvCenter.add(vec4(offsetX2, offsetY2, 0, 0));
        return cameraProjectionMatrix.mul(mvFinal2);
      }
      const viewDir = (x, y, z) => modelViewMatrix.mul(vec4(x, y, z, 0)).xyz.normalize();
      let axisX;
      let axisY;
      let offsetX;
      let offsetY;
      if (orientation === "upright") {
        const up = viewDir(0, 1, 0);
        const toCamera = mvCenter.xyz.normalize().negate();
        const right = cross(up, toCamera);
        axisX = right.div(max(length(right), 1e-5));
        axisY = up;
        offsetX = scaled.x;
        offsetY = scaled.y;
      } else {
        if (orientation === "ground") {
          axisX = viewDir(1, 0, 0);
          axisY = viewDir(0, 0, -1);
        } else {
          axisX = viewDir(Math.cos(facingRad), 0, -Math.sin(facingRad));
          axisY = viewDir(0, 1, 0);
        }
        offsetX = scaled.x.mul(c).sub(scaled.y.mul(s));
        offsetY = scaled.x.mul(s).add(scaled.y.mul(c));
      }
      const mvFinal = mvCenter.add(vec4(axisX.mul(offsetX).add(axisY.mul(offsetY)), 0));
      return cameraProjectionMatrix.mul(mvFinal);
    })();
    const animation = this.animation;
    const userColorNode = this._colorNode;
    const uTime = this._uTime;
    material.colorNode = Fn(() => {
      const effectiveIdx = sortIndices ? sortIndices.element(instanceIndex).bitAnd(uint(SLOT_MASK)).toInt() : instanceIndex.toInt();
      const posAlive = storage.posAlive.element(effectiveIdx).toVar();
      const velAge = storage.velAge.element(effectiveIdx).toVar();
      const traits = storage.traits.element(effectiveIdx).toVar();
      const colorVec = storage.color.element(effectiveIdx).toVar();
      const age = velAge.w;
      const lifetime = traits.w.max(1e-4);
      const lifetimeT = safeLifetimeT(age, lifetime);
      const baseUv = uv();
      const animatedUv = animation ? (() => {
        const frameCount = animation.cols * animation.rows;
        const frame = animation.mode === "loop" ? age.mul(animation.fps ?? 24) : lifetimeT.mul(frameCount).min(float(frameCount - 1));
        return spritesheetUV(
          vec2(animation.cols, animation.rows),
          baseUv,
          frame
        );
      })() : baseUv;
      const ctx = {
        particle: {
          color: colorVec,
          age,
          lifetime,
          lifetimeT,
          size: traits.x,
          position: posAlive.xyz,
          alive: posAlive.w
        },
        uv: baseUv,
        textures: textureNodes,
        time: uTime
      };
      if (userColorNode) {
        return userColorNode(ctx);
      }
      const baseTex = textureNodes.base;
      if (!baseTex) {
        const alpha2 = colorVec.a.mul(opacityUniform);
        return vec4(colorVec.rgb, alpha2);
      }
      const sampled = baseTex.sample(animatedUv);
      const rgb = sampled.rgb.mul(colorVec.rgb);
      const alpha = sampled.a.mul(colorVec.a).mul(opacityUniform);
      return vec4(rgb, alpha);
    })();
    const mesh = new THREE14.InstancedMesh(geom, material, capacity);
    mesh.count = 0;
    mesh.frustumCulled = false;
    mesh.matrixAutoUpdate = false;
    mesh.renderOrder = this.renderOrder;
    this._geometry = geom;
    this._material = material;
    this._mesh = mesh;
    this.object3D.add(mesh);
  }
  _resolveBlending() {
    switch (this.blending) {
      case "additive":
        return THREE14.AdditiveBlending;
      case "alpha":
      case "normal":
        return THREE14.NormalBlending;
    }
  }
  updateRender(liveCount, ctx) {
    if (!this._mesh) return;
    this._mesh.count = liveCount;
    this._setOpacity(this.opacity * ctx.intensity);
    this._uTime.value = performance.now() / 1e3;
    this.object3D.visible = liveCount > 0;
  }
  dispose() {
    this._geometry?.dispose();
    this._material?.dispose();
  }
  toJSON() {
    return {
      type: _SpriteRenderer.type,
      id: this.id,
      blending: this.blending,
      opacity: this.opacity,
      depthWrite: this.depthWrite,
      depthTest: this.depthTest,
      renderOrder: this.renderOrder,
      textureRef: this.textureRef,
      animation: this.animation,
      orientation: this.orientation,
      facingAngle: this.facingAngle
      // `textures` and `colorNode` are not serializable — caller must re-supply on fromJSON.
    };
  }
  static fromJSON(data) {
    return new _SpriteRenderer({
      blending: data["blending"],
      opacity: data["opacity"],
      depthWrite: data["depthWrite"],
      depthTest: data["depthTest"],
      renderOrder: data["renderOrder"],
      textureRef: data["textureRef"],
      animation: data["animation"],
      orientation: data["orientation"],
      facingAngle: data["facingAngle"],
      id: data.id
    });
  }
};
registerModule(SpriteRenderer);
var MeshRenderer = class _MeshRenderer {
  static type = "render.mesh";
  kind = "render";
  type = _MeshRenderer.type;
  id;
  object3D;
  _geometry;
  _material;
  _mesh;
  _renderOrder;
  _ownsMaterial;
  constructor(params) {
    this._geometry = params.geometry;
    this._renderOrder = params.renderOrder ?? 0;
    this.id = params.id;
    if (params.material) {
      this._material = params.material;
      this._ownsMaterial = false;
    } else {
      this._material = new MeshBasicNodeMaterial({ color: 16777215 });
      this._ownsMaterial = true;
    }
    this.object3D = new THREE14.Group();
    this.object3D.frustumCulled = false;
    this.object3D.matrixAutoUpdate = false;
    this.object3D.renderOrder = this._renderOrder;
  }
  init(storage, capacity) {
    const mat = this._material;
    const userPositionNode = mat.positionNode ?? null;
    const userNormalNode = mat.normalNode ?? null;
    const userColorNode = mat.colorNode ?? null;
    const axisNode = () => {
      const idxF = float(instanceIndex);
      const s = idxF.mul(7919.11);
      const ax = hash(s).sub(0.5);
      const ay = hash(s.add(1)).sub(0.5);
      const az = hash(s.add(2)).sub(0.5);
      return vec3(ax, ay, az).normalize();
    };
    const rotateByAxisAngle = (v, axis, cosA, sinA) => {
      const oneMinusCos = float(1).sub(cosA);
      const term1 = v.mul(cosA);
      const term2 = axis.cross(v).mul(sinA);
      const term3 = axis.mul(axis.dot(v)).mul(oneMinusCos);
      return term1.add(term2).add(term3);
    };
    mat.positionNode = Fn(() => {
      const posAlive = storage.posAlive.element(instanceIndex).toVar();
      const traits = storage.traits.element(instanceIndex).toVar();
      const particlePos = posAlive.xyz;
      const alive = posAlive.w;
      const scale = traits.x;
      const rotation = traits.y;
      const localSource = userPositionNode ?? positionLocal;
      const axis = axisNode();
      const cosA = cos(rotation);
      const sinA = sin(rotation);
      const rotated = rotateByAxisAngle(localSource, axis, cosA, sinA);
      const effScale = scale.mul(alive);
      return particlePos.add(rotated.mul(effScale));
    })();
    mat.normalNode = Fn(() => {
      const traits = storage.traits.element(instanceIndex).toVar();
      const rotation = traits.y;
      const axis = axisNode();
      const cosA = cos(rotation);
      const sinA = sin(rotation);
      const localNormal = userNormalNode ?? normalLocal;
      return rotateByAxisAngle(localNormal, axis, cosA, sinA);
    })();
    if (!userColorNode) {
      mat.colorNode = Fn(() => storage.color.element(instanceIndex).rgb)();
    }
    const mesh = new THREE14.InstancedMesh(this._geometry, this._material, capacity);
    mesh.count = 0;
    mesh.frustumCulled = false;
    mesh.matrixAutoUpdate = false;
    mesh.renderOrder = this._renderOrder;
    this._mesh = mesh;
    this.object3D.add(mesh);
  }
  updateRender(liveCount, _ctx) {
    if (!this._mesh) return;
    this._mesh.count = liveCount;
    this.object3D.visible = liveCount > 0;
  }
  dispose() {
    this._mesh?.dispose();
    if (this._ownsMaterial) this._material.dispose();
  }
  toJSON() {
    return {
      type: _MeshRenderer.type,
      id: this.id,
      renderOrder: this._renderOrder
    };
  }
  static fromJSON(_data) {
    throw new Error("MeshRenderer cannot be deserialized without geometry + material refs.");
  }
};
registerModule(MeshRenderer);
var RibbonRenderer = class _RibbonRenderer {
  static type = "render.ribbon";
  kind = "render";
  type = _RibbonRenderer.type;
  id;
  object3D;
  historyLength;
  width;
  opacity;
  sampleRate;
  minDistance;
  sampleLifetime;
  sampleUntil;
  _blending;
  _renderOrder;
  _depthTest;
  _depthWrite;
  _faceCamera;
  _textures;
  _colorNode;
  _widthOverLife;
  _alphaOverLife;
  _colorOverLife;
  _hasCustomLayers;
  _layers;
  _capacity = 0;
  _history;
  _writeKernel;
  _uHead;
  _uSampleLifetime;
  _uTime;
  _head = 0;
  _sampleAccum = Number.POSITIVE_INFINITY;
  _geometry;
  _lastSamplePosition = new THREE14.Vector3();
  _pendingFollowPosition = new THREE14.Vector3();
  _hasLastSamplePosition = false;
  _hasPendingFollowPosition = false;
  constructor(params = {}) {
    this.historyLength = Math.max(2, params.historyLength ?? 32);
    this.width = params.width ?? 0.1;
    this._blending = params.blending ?? "additive";
    this.opacity = params.opacity ?? 1;
    this._renderOrder = params.renderOrder ?? 0;
    this._depthTest = params.depthTest ?? true;
    this._depthWrite = params.depthWrite ?? false;
    this._faceCamera = params.faceCamera ?? true;
    this.sampleRate = Math.max(0, params.sampleRate ?? 0);
    this.minDistance = Math.max(0, params.minDistance ?? 0);
    this.sampleLifetime = params.sampleLifetime !== void 0 ? Math.max(0, params.sampleLifetime) : void 0;
    this.sampleUntil = params.sampleUntil;
    this._textures = normalizeTextures(params.textures);
    this._colorNode = params.colorNode;
    this._widthOverLife = params.widthOverLife;
    this._alphaOverLife = params.alphaOverLife;
    this._colorOverLife = params.colorOverLife;
    this.id = params.id;
    this._hasCustomLayers = !!params.layers?.length;
    const sourceLayers = this._hasCustomLayers ? params.layers : [{ width: this.width, opacity: this.opacity, color: [1, 1, 1] }];
    this._layers = sourceLayers.map((layer) => {
      const width = layer.width ?? this.width;
      const opacity = layer.opacity ?? this.opacity;
      const color = layer.color ?? [1, 1, 1];
      return {
        width,
        opacity,
        color,
        uWidth: uniform(width),
        uOpacity: uniform(opacity),
        uColor: uniform(new THREE14.Vector3(color[0], color[1], color[2]))
      };
    });
    this._uHead = uniform(0);
    this._uSampleLifetime = uniform(this.sampleLifetime ?? 0);
    this._uTime = uniform(0);
    this.object3D = new THREE14.Group();
    this.object3D.frustumCulled = false;
    this.object3D.matrixAutoUpdate = false;
    this.object3D.renderOrder = this._renderOrder;
  }
  init(storage, capacity) {
    this._capacity = capacity;
    const N = this.historyLength;
    this._history = instancedArray(capacity * N, "vec4");
    this._geometry = this._buildGeometry();
    this._writeKernel = this._buildWriteKernel(storage);
    for (const layer of this._layers) {
      layer.material = this._buildMaterial(storage, layer);
      const mesh = new THREE14.InstancedMesh(this._geometry, layer.material, capacity);
      mesh.count = 0;
      mesh.frustumCulled = false;
      mesh.matrixAutoUpdate = false;
      mesh.renderOrder = this._renderOrder;
      layer.mesh = mesh;
      this.object3D.add(mesh);
    }
  }
  reset() {
    this._head = 0;
    this._sampleAccum = Number.POSITIVE_INFINITY;
    this._hasLastSamplePosition = false;
    this._hasPendingFollowPosition = false;
    for (const layer of this._layers) {
      if (layer.mesh) layer.mesh.count = 0;
    }
    this.object3D.visible = false;
  }
  setFollowPosition(position) {
    this._pendingFollowPosition.copy(position);
    this._hasPendingFollowPosition = true;
  }
  postUpdate(renderer, liveCount, deltaTime, emitterTime) {
    if (!this._writeKernel) return;
    if (this.sampleUntil !== void 0 && emitterTime > this.sampleUntil) return;
    if (!this._shouldRecordThisTick(deltaTime)) return;
    if (!this._passesMinDistance()) return;
    this._uHead.value = this._head;
    this._uSampleLifetime.value = this.sampleLifetime ?? 0;
    this._writeKernel.count = liveCount;
    void renderer.computeAsync(this._writeKernel);
    this._head = (this._head + 1) % this.historyLength;
    if (this._hasPendingFollowPosition) {
      this._lastSamplePosition.copy(this._pendingFollowPosition);
      this._hasLastSamplePosition = true;
    }
  }
  updateRender(liveCount, ctx) {
    this._uTime.value = performance.now() / 1e3;
    this._uSampleLifetime.value = this.sampleLifetime ?? 0;
    if (!this._hasCustomLayers && this._layers[0]) {
      this._layers[0].width = this.width;
      this._layers[0].opacity = this.opacity;
    }
    for (const layer of this._layers) {
      if (!layer.mesh) continue;
      layer.mesh.count = liveCount;
      layer.uWidth.value = layer.width;
      layer.uOpacity.value = layer.opacity * ctx.intensity;
      layer.uColor.value.set(layer.color[0], layer.color[1], layer.color[2]);
    }
    this.object3D.visible = liveCount > 0;
  }
  dispose() {
    this._geometry?.dispose();
    for (const layer of this._layers) layer.material?.dispose();
  }
  toJSON() {
    return {
      type: _RibbonRenderer.type,
      id: this.id,
      historyLength: this.historyLength,
      width: this.width,
      blending: this._blending,
      opacity: this.opacity,
      renderOrder: this._renderOrder,
      depthTest: this._depthTest,
      depthWrite: this._depthWrite,
      faceCamera: this._faceCamera,
      sampleRate: this.sampleRate,
      minDistance: this.minDistance,
      sampleLifetime: this.sampleLifetime,
      sampleUntil: this.sampleUntil,
      widthOverLife: this._widthOverLife?.toJSON(),
      alphaOverLife: this._alphaOverLife?.toJSON(),
      colorOverLife: this._colorOverLife?.toJSON(),
      layers: this._hasCustomLayers ? this._layers.map((layer) => ({
        width: layer.width,
        opacity: layer.opacity,
        color: layer.color
      })) : void 0
      // textures + colorNode aren't serializable — caller must re-supply on fromJSON.
    };
  }
  static fromJSON(data) {
    return new _RibbonRenderer({
      historyLength: data["historyLength"],
      width: data["width"],
      blending: data["blending"],
      opacity: data["opacity"],
      renderOrder: data["renderOrder"],
      depthTest: data["depthTest"],
      depthWrite: data["depthWrite"],
      faceCamera: data["faceCamera"],
      sampleRate: data["sampleRate"],
      minDistance: data["minDistance"],
      sampleLifetime: data["sampleLifetime"],
      sampleUntil: data["sampleUntil"],
      widthOverLife: data["widthOverLife"] ? Curve1D.fromJSON(data["widthOverLife"]) : void 0,
      alphaOverLife: data["alphaOverLife"] ? Curve1D.fromJSON(data["alphaOverLife"]) : void 0,
      colorOverLife: data["colorOverLife"] ? Gradient.fromJSON(data["colorOverLife"]) : void 0,
      layers: data["layers"],
      id: data.id
    });
  }
  // ────────────────────────────────────────────────────────────────────────
  _shouldRecordThisTick(deltaTime) {
    if (this.sampleRate <= 0) return true;
    if (!Number.isFinite(this._sampleAccum)) {
      this._sampleAccum = 0;
      return true;
    }
    const interval = 1 / this.sampleRate;
    this._sampleAccum += deltaTime;
    if (this._sampleAccum + 1e-6 < interval) return false;
    this._sampleAccum %= interval;
    return true;
  }
  _passesMinDistance() {
    if (this.minDistance <= 0 || !this._hasPendingFollowPosition) return true;
    if (!this._hasLastSamplePosition) return true;
    return this._pendingFollowPosition.distanceToSquared(this._lastSamplePosition) >= this.minDistance * this.minDistance;
  }
  _buildGeometry() {
    const N = this.historyLength;
    const vertexCount = 2 * N;
    const positions = new Float32Array(vertexCount * 3);
    const slots = new Float32Array(vertexCount);
    const sides = new Float32Array(vertexCount);
    for (let k = 0; k < N; k++) {
      slots[2 * k] = k;
      slots[2 * k + 1] = k;
      sides[2 * k] = -1;
      sides[2 * k + 1] = 1;
    }
    const indices = [];
    for (let k = 0; k < N - 1; k++) {
      const a = 2 * k;
      const b = 2 * k + 1;
      const c = 2 * k + 2;
      const d = 2 * k + 3;
      indices.push(a, b, c);
      indices.push(b, d, c);
    }
    const geom = new THREE14.BufferGeometry();
    geom.setAttribute("position", new THREE14.BufferAttribute(positions, 3));
    geom.setAttribute("ribbonSlot", new THREE14.BufferAttribute(slots, 1));
    geom.setAttribute("ribbonSide", new THREE14.BufferAttribute(sides, 1));
    geom.setIndex(indices);
    return geom;
  }
  _buildWriteKernel(storage) {
    const history = this._history;
    const N = this.historyLength;
    const uHead = this._uHead;
    return Fn(() => {
      const i = instanceIndex.toInt();
      const alive = attr.alive.read(storage, i);
      const pos = attr.position.read(storage, i);
      const age = attr.age.read(storage, i);
      const sentinelAge = float(-1e3);
      const isAlive = alive.greaterThanEqual(0.5);
      const finalAge = isAlive.select(age, sentinelAge);
      const slotIdx = float(i).mul(N).add(uHead).toInt();
      history.element(slotIdx).assign(vec4(pos, finalAge));
    })().compute(this._capacity);
  }
  _buildMaterial(storage, layer) {
    const history = this._history;
    const N = this.historyLength;
    const uHead = this._uHead;
    const uSampleLifetime = this._uSampleLifetime;
    const uTime = this._uTime;
    const textureNodes = buildTextureNodes(this._textures);
    const userColorNode = this._colorNode;
    const widthTex = this._widthOverLife ? texture(this._widthOverLife.getTexture()) : void 0;
    const alphaTex = this._alphaOverLife ? texture(this._alphaOverLife.getTexture()) : void 0;
    const colorTex = this._colorOverLife ? texture(this._colorOverLife.getTexture()) : void 0;
    const faceCamera = this._faceCamera;
    const mat = new MeshBasicNodeMaterial({
      transparent: true,
      depthWrite: this._depthWrite,
      depthTest: this._depthTest,
      blending: this._resolveBlending()
    });
    mat.toneMapped = false;
    const vTaper = varying(float(0), "vRibbonTaper");
    const vStale = varying(float(0), "vRibbonStale");
    const vColor = varying(vec4(1, 1, 1, 1), "vRibbonColor");
    const vUv = varying(vec2(0, 0), "vRibbonUv");
    const vLifetimeT = varying(float(0), "vRibbonLifetimeT");
    const vTrailT = varying(float(0), "vRibbonTrailT");
    const vWorldPos = varying(vec3(0, 0, 0), "vRibbonWorldPos");
    const vSize = varying(float(0), "vRibbonSize");
    const vAlive = varying(float(0), "vRibbonAlive");
    const vAge = varying(float(0), "vRibbonAge");
    const vLifetime = varying(float(0), "vRibbonLifetime");
    mat.vertexNode = Fn(() => {
      const pIdx = instanceIndex;
      const kLocal = attribute("ribbonSlot", "float").toVar();
      const side = attribute("ribbonSide", "float").toVar();
      const headF = uHead;
      const actualSlotF = headF.sub(kLocal).add(float(N * 2)).mod(float(N));
      const pIdxF = float(pIdx);
      const slotIdx = pIdxF.mul(N).add(actualSlotF).toInt();
      const entry = history.element(slotIdx).toVar();
      const hPos = entry.xyz;
      const hAge = entry.w;
      const kNext = kLocal.add(1).min(float(N - 1));
      const nextSlotF = headF.sub(kNext).add(float(N * 2)).mod(float(N));
      const nextSlotIdx = pIdxF.mul(N).add(nextSlotF).toInt();
      const nextEntry = history.element(nextSlotIdx).toVar();
      const nextPos = nextEntry.xyz;
      const pI = pIdx.toInt();
      const currentPos = attr.position.read(storage, pI);
      const currentAge = attr.age.read(storage, pI);
      const lifetime = attr.lifetime.read(storage, pI);
      const alive = attr.alive.read(storage, pI);
      const sizeAttr = attr.size.read(storage, pI);
      const ageBack = currentAge.sub(hAge);
      const useLifetime = uSampleLifetime.greaterThan(1e-4);
      const indexT = kLocal.div(float(N - 1));
      const ageT = ageBack.div(uSampleLifetime.max(1e-4)).clamp(0, 1);
      const trailT = useLifetime.select(ageT, indexT).toVar();
      vTrailT.assign(trailT);
      const lifetimeLimit = useLifetime.select(uSampleLifetime.add(1e-3), currentAge.add(1e-3));
      const valid = alive.greaterThanEqual(0.5).and(hAge.greaterThan(-0.5)).and(ageBack.greaterThanEqual(0)).and(ageBack.lessThan(lifetimeLimit));
      const validF = valid.select(float(1), float(0));
      let widthScale = float(1).sub(trailT);
      if (widthTex) widthScale = widthTex.sample(vec2(trailT, 0.5)).r;
      let alphaScale = float(1).sub(trailT);
      if (alphaTex) alphaScale = alphaTex.sample(vec2(trailT, 0.5)).r;
      const alphaMask = alphaScale.mul(validF).mul(alive);
      vTaper.assign(alphaMask);
      vStale.assign(float(1).sub(validF));
      vColor.assign(attr.color.read(storage, pI));
      vUv.assign(vec2(trailT, side.add(1).mul(0.5)));
      vLifetimeT.assign(currentAge.div(lifetime.max(1e-4)).clamp(0, 1));
      vAge.assign(currentAge);
      vLifetime.assign(lifetime);
      vSize.assign(sizeAttr);
      vAlive.assign(alive);
      const effectivePos = hPos.mul(validF).add(currentPos.mul(float(1).sub(validF)));
      vWorldPos.assign(effectivePos);
      const dir = nextPos.sub(hPos);
      const tangent = normalize(dir.add(vec3(1e-5, 0, 1e-5)));
      const viewDir = faceCamera ? normalize(cameraPosition.sub(effectivePos)) : vec3(0, 1, 0);
      const perp = normalize(cross(tangent, viewDir));
      const halfWidth = layer.uWidth.mul(widthScale).mul(validF).mul(alive).mul(side).mul(0.5);
      const offsetPos = effectivePos.add(perp.mul(halfWidth));
      return cameraProjectionMatrix.mul(modelViewMatrix.mul(vec4(offsetPos, 1)));
    })();
    mat.colorNode = Fn(() => {
      const validMask = float(1).sub(vStale);
      const tailMask = vTaper.mul(validMask).mul(layer.uOpacity);
      const ctx = {
        particle: {
          color: vColor,
          age: vAge,
          lifetime: vLifetime,
          lifetimeT: vLifetimeT,
          size: vSize,
          position: vWorldPos,
          alive: vAlive
        },
        uv: vUv,
        textures: textureNodes,
        time: uTime
      };
      let userOut;
      if (userColorNode) {
        userOut = userColorNode(ctx);
      } else {
        const base = textureNodes.base;
        if (base) {
          const sampled = base.sample(vUv);
          userOut = vec4(sampled.rgb.mul(vColor.rgb), sampled.a.mul(vColor.a));
        } else {
          userOut = vColor;
        }
      }
      if (colorTex) {
        const gradient = colorTex.sample(vec2(vTrailT, 0.5));
        userOut = vec4(userOut.rgb.mul(gradient.rgb), userOut.a.mul(gradient.a));
      }
      return vec4(userOut.rgb.mul(layer.uColor), userOut.a.mul(tailMask));
    })();
    return mat;
  }
  _resolveBlending() {
    switch (this._blending) {
      case "additive":
        return THREE14.AdditiveBlending;
      case "alpha":
      case "normal":
        return THREE14.NormalBlending;
    }
  }
};
registerModule(RibbonRenderer);
var BeamRenderer = class _BeamRenderer {
  static type = "render.beam";
  kind = "render";
  type = _BeamRenderer.type;
  id;
  object3D;
  width;
  opacity;
  _blending;
  _renderOrder;
  _taper;
  _textures;
  _colorNode;
  _uWidth = uniform(0.05, "float");
  _uOpacity = uniform(1, "float");
  _uTime = uniform(0, "float");
  _geometry;
  _material;
  _mesh;
  constructor(params = {}) {
    this.width = params.width ?? 0.05;
    this.opacity = params.opacity ?? 1;
    this._blending = params.blending ?? "additive";
    this._renderOrder = params.renderOrder ?? 0;
    this._taper = params.taperToTail ?? true;
    this._textures = normalizeTextures(params.textures);
    this._colorNode = params.colorNode;
    this.id = params.id;
    this._uWidth.value = this.width;
    this._uOpacity.value = this.opacity;
    this.object3D = new THREE14.Group();
    this.object3D.matrixAutoUpdate = false;
    this.object3D.frustumCulled = false;
    this.object3D.renderOrder = this._renderOrder;
  }
  init(storage, capacity) {
    this._geometry = this._buildGeometry();
    this._material = this._buildMaterial(storage);
    const mesh = new THREE14.InstancedMesh(this._geometry, this._material, capacity);
    mesh.count = 0;
    mesh.frustumCulled = false;
    mesh.matrixAutoUpdate = false;
    mesh.renderOrder = this._renderOrder;
    this._mesh = mesh;
    this.object3D.add(mesh);
  }
  updateRender(liveCount, ctx) {
    if (!this._mesh) return;
    this._mesh.count = liveCount;
    this._uWidth.value = this.width;
    this._uOpacity.value = this.opacity * ctx.intensity;
    this._uTime.value = performance.now() / 1e3;
    this.object3D.visible = liveCount > 0;
  }
  dispose() {
    this._geometry?.dispose();
    this._material?.dispose();
  }
  toJSON() {
    return {
      type: _BeamRenderer.type,
      id: this.id,
      width: this.width,
      opacity: this.opacity,
      blending: this._blending,
      renderOrder: this._renderOrder,
      taperToTail: this._taper
    };
  }
  static fromJSON(data) {
    return new _BeamRenderer({
      width: data["width"],
      opacity: data["opacity"],
      blending: data["blending"],
      renderOrder: data["renderOrder"],
      taperToTail: data["taperToTail"],
      id: data.id
    });
  }
  // ────────────────────────────────────────────────────────────────────────
  _buildGeometry() {
    const positions = new Float32Array(4 * 3);
    const sides = new Float32Array([-1, 1, 1, -1]);
    const ends = new Float32Array([0, 0, 1, 1]);
    const indices = [0, 1, 2, 0, 2, 3];
    const geom = new THREE14.BufferGeometry();
    geom.setAttribute("position", new THREE14.BufferAttribute(positions, 3));
    geom.setAttribute("beamSide", new THREE14.BufferAttribute(sides, 1));
    geom.setAttribute("beamEnd", new THREE14.BufferAttribute(ends, 1));
    geom.setIndex(indices);
    return geom;
  }
  _buildMaterial(storage) {
    const uWidth = this._uWidth;
    const uOpacity = this._uOpacity;
    const uTime = this._uTime;
    const taperEnabled = this._taper;
    const textureNodes = buildTextureNodes(this._textures);
    const userColorNode = this._colorNode;
    const mat = new MeshBasicNodeMaterial({
      transparent: true,
      depthWrite: false,
      blending: this._resolveBlending()
    });
    mat.toneMapped = false;
    const vTaper = varying(float(0), "vBeamTaper");
    const vColor = varying(vec4(1, 1, 1, 1), "vBeamColor");
    const vUv = varying(vec2(0, 0), "vBeamUv");
    const vLifetimeT = varying(float(0), "vBeamLifetimeT");
    const vAge = varying(float(0), "vBeamAge");
    const vLifetime = varying(float(0), "vBeamLifetime");
    const vSize = varying(float(0), "vBeamSize");
    const vAlive = varying(float(0), "vBeamAlive");
    const vWorldPos = varying(vec3(0, 0, 0), "vBeamWorldPos");
    mat.vertexNode = Fn(() => {
      const i = instanceIndex.toInt();
      const end = attribute("beamEnd", "float");
      const side = attribute("beamSide", "float");
      const posAlive = storage.posAlive.element(i).toVar();
      const velAge = storage.velAge.element(i).toVar();
      const initVelSize = storage.initVelSize.element(i).toVar();
      const traits = storage.traits.element(i).toVar();
      const head = posAlive.xyz;
      const alive = posAlive.w;
      const age = velAge.w;
      const initVel = initVelSize.xyz;
      const lifetime = traits.w.max(1e-4);
      const tail = head.sub(initVel.mul(age));
      const centerPos = tail.add(head.sub(tail).mul(end));
      const axisDir = normalize(head.sub(tail).add(vec3(1e-5, 0, 1e-5)));
      const viewDir = normalize(cameraPosition.sub(centerPos));
      const perp = normalize(cross(axisDir, viewDir));
      const taperFactor = taperEnabled ? end : float(1);
      const halfWidth = uWidth.mul(taperFactor).mul(0.5).mul(alive);
      const finalPos = centerPos.add(perp.mul(side).mul(halfWidth));
      vTaper.assign(taperFactor);
      vColor.assign(storage.color.element(i));
      vUv.assign(vec2(end, side.add(1).mul(0.5)));
      vAge.assign(age);
      vLifetime.assign(lifetime);
      vLifetimeT.assign(age.div(lifetime).clamp(0, 1));
      vSize.assign(traits.x);
      vAlive.assign(alive);
      vWorldPos.assign(centerPos);
      return cameraProjectionMatrix.mul(modelViewMatrix.mul(vec4(finalPos, 1)));
    })();
    mat.colorNode = Fn(() => {
      const ctx = {
        particle: {
          color: vColor,
          age: vAge,
          lifetime: vLifetime,
          lifetimeT: vLifetimeT,
          size: vSize,
          position: vWorldPos,
          alive: vAlive
        },
        uv: vUv,
        textures: textureNodes,
        time: uTime
      };
      let userOut;
      if (userColorNode) {
        userOut = userColorNode(ctx);
      } else {
        const base = textureNodes.base;
        if (base) {
          const sampled = base.sample(vUv);
          userOut = vec4(sampled.rgb.mul(vColor.rgb), sampled.a.mul(vColor.a));
        } else {
          userOut = vColor;
        }
      }
      return vec4(userOut.rgb, userOut.a.mul(vTaper).mul(uOpacity));
    })();
    return mat;
  }
  _resolveBlending() {
    switch (this._blending) {
      case "additive":
        return THREE14.AdditiveBlending;
      case "alpha":
      case "normal":
        return THREE14.NormalBlending;
    }
  }
};
registerModule(BeamRenderer);
var LightEmission = class _LightEmission {
  static type = "render.light_emission";
  kind = "render";
  type = _LightEmission.type;
  id;
  object3D;
  lightCount;
  intensity;
  _storage;
  _lights = [];
  _readback;
  _readbackPending = false;
  _intensityBase;
  _color;
  _distance;
  _decay;
  constructor(params = {}) {
    this.lightCount = Math.max(1, params.lightCount ?? 4);
    this._intensityBase = params.intensity ?? 2;
    this.intensity = this._intensityBase;
    this._color = new THREE14.Color(params.color ?? 16777215);
    this._distance = params.distance ?? 5;
    this._decay = params.decay ?? 2;
    this.id = params.id;
    this.object3D = new THREE14.Group();
    this.object3D.matrixAutoUpdate = false;
    for (let i = 0; i < this.lightCount; i++) {
      const light = new THREE14.PointLight(
        this._color,
        0,
        // start dark — positions/intensities updated on first readback
        this._distance,
        this._decay
      );
      light.castShadow = false;
      this._lights.push(light);
      this.object3D.add(light);
    }
  }
  init(storage) {
    this._storage = storage;
    this._readback = new Float32Array(this.lightCount * 4);
  }
  postUpdate(renderer, liveCount) {
    if (!this._storage || !this._readback || this._readbackPending) return;
    if (liveCount === 0) return;
    const slots = Math.min(this.lightCount, liveCount);
    this._readbackPending = true;
    renderer.getArrayBufferAsync(this._storage.posAlive.value, null, 0, slots * 16).then((buf) => {
      const src = new Float32Array(buf);
      this._readback.set(src, 0);
      for (let i = src.length; i < this._readback.length; i++) this._readback[i] = 0;
    }).catch(() => {
    }).finally(() => {
      this._readbackPending = false;
    });
  }
  updateRender(liveCount, ctx) {
    if (!this._readback) return;
    const intensity = this._intensityBase * ctx.intensity;
    for (let i = 0; i < this.lightCount; i++) {
      const light = this._lights[i];
      const alive = this._readback[i * 4 + 3];
      if (alive >= 0.5 && i < liveCount) {
        light.position.set(
          this._readback[i * 4 + 0],
          this._readback[i * 4 + 1],
          this._readback[i * 4 + 2]
        );
        light.intensity = intensity;
      } else {
        light.intensity = 0;
      }
    }
  }
  dispose() {
    for (const l of this._lights) l.dispose();
    this._lights.length = 0;
  }
  toJSON() {
    return {
      type: _LightEmission.type,
      id: this.id,
      lightCount: this.lightCount,
      color: this._color.toArray(),
      intensity: this._intensityBase,
      distance: this._distance,
      decay: this._decay
    };
  }
  static fromJSON(data) {
    const colorData = data["color"];
    const color = Array.isArray(colorData) ? new THREE14.Color(colorData[0], colorData[1], colorData[2]) : colorData;
    return new _LightEmission({
      lightCount: data["lightCount"],
      color,
      intensity: data["intensity"],
      distance: data["distance"],
      decay: data["decay"],
      id: data.id
    });
  }
};
registerModule(LightEmission);
var asUint = (n) => n;
var SLOT_BITS = 10;
var DEPTH_BITS = 22;
var DEPTH_MAX_WORLD = 1e3;
var Emitter = class {
  name;
  buffer;
  spawn;
  init;
  update;
  render;
  rng;
  duration;
  loop;
  // Per-tick uniforms
  uDt;
  uEmitterTime;
  uIntensity;
  uWorldMatrix;
  uSpawnCount;
  uSpawnBase;
  uSeedBase;
  // Event output (optional — only when `events.onDeath` is true)
  eventCapacity;
  eventBuffer;
  eventCounter;
  _writeDeathEvents;
  _resetEventKernel;
  // Event input (optional — only when spawn modules include SpawnFromEvents)
  _eventSource;
  _eventPerTrigger = 1;
  // Depth sort (optional — only when `sortByDepth` is true).
  //
  // Uses three.js's ships-with-the-library `BitonicSort` (examples/jsm/gpgpu/BitonicSort.js).
  // That helper sorts a scalar storage buffer in place (ascending, via min/max per step).
  //
  // To sort slot indices by depth we pack each slot's `(invertedDepth, slotIndex)` into a
  // single uint32: the upper `DEPTH_BITS` bits hold inverted-quantized depth (so larger
  // world-depth → smaller uint → sorted-first = drawn-first = back-to-front), and the lower
  // `SLOT_BITS` bits hold the original slot index. Dead slots get key = 0xFFFFFFFF so they
  // sort to the end.
  //
  // Rendering reads `sortKeys[instanceIndex] & SLOT_MASK` to recover the particle's storage
  // slot for draw order `instanceIndex`.
  _sortEnabled;
  _sortIndices;
  // ALIAS of `_sortKeys` — sprite-renderer uses this name
  _sortKeys;
  _sortKeyKernel;
  _sortEngine;
  _uCameraView;
  _emitterTime = 0;
  _playing = true;
  _spawning = true;
  _ringHead = 0;
  _aliveHighWater = 0;
  _seeded = false;
  _initialSeed;
  _retireTailSeconds;
  _spawnKernel;
  _updateKernel;
  constructor(def) {
    this.name = def.name;
    this.buffer = new ParticleBuffer(def.capacity);
    this.spawn = def.spawn;
    this.init = def.init;
    this.update = def.update;
    this.render = def.render;
    this._initialSeed = def.seed ?? Math.random() * 4294967295 >>> 0;
    this.rng = new RNG(this._initialSeed);
    this._seeded = def.seed !== void 0;
    this.duration = def.duration;
    this.loop = def.loop ?? false;
    this._retireTailSeconds = estimateMaxLifetime(def.init);
    this.uDt = uniform(0);
    this.uEmitterTime = uniform(0);
    this.uIntensity = uniform(1);
    this.uWorldMatrix = uniform(new THREE14.Matrix4());
    this.uSpawnCount = uniform(0);
    this.uSpawnBase = uniform(0);
    this.uSeedBase = uniform(0);
    this.eventCapacity = def.events?.capacity ?? 256;
    this._writeDeathEvents = def.events?.onDeath ?? false;
    if (this._writeDeathEvents) {
      this.eventBuffer = instancedArray(this.eventCapacity, "vec4");
      this.eventCounter = instancedArray(1, "uint").toAtomic();
      this._resetEventKernel = this._buildResetEventKernel();
    }
    for (const sm of this.spawn) {
      if (sm instanceof SpawnFromEvents && sm.source) {
        this._eventSource = sm.source;
        this._eventPerTrigger = sm.perEvent;
        break;
      }
    }
    this._sortEnabled = def.sortByDepth ?? false;
    if (this._sortEnabled) {
      if ((def.capacity & def.capacity - 1) !== 0) {
        throw new Error(
          `plume: sortByDepth requires a power-of-two capacity (got ${def.capacity})`
        );
      }
      if (def.capacity > 1 << SLOT_BITS) {
        throw new Error(
          `plume: sortByDepth supports capacity \u2264 ${1 << SLOT_BITS} (got ${def.capacity})`
        );
      }
      this._sortKeys = instancedArray(def.capacity, "uint");
      this._sortIndices = this._sortKeys;
      this._uCameraView = uniform(new THREE14.Matrix4());
      this._sortKeyKernel = this._buildSortKeyKernel();
    }
    this._spawnKernel = this._buildSpawnKernel();
    this._updateKernel = this._buildUpdateKernel();
    this.render.init?.(this.buffer.storage, this.buffer.capacity, {
      sortIndices: this._sortIndices
    });
  }
  /**
   * Re-resolves cross-emitter event-source references and rebuilds the spawn kernel
   * if any deferred name (string source for `SpawnFromEvents`) was resolved after
   * construction. Called by `System` once every emitter has been built and
   * `resolveSource()` has run on each spawn module. No-op when sources were already
   * supplied as direct `Emitter` instances.
   */
  finalizeWiring() {
    for (const sm of this.spawn) {
      if (sm instanceof SpawnFromEvents && sm.source && this._eventSource !== sm.source) {
        this._eventSource = sm.source;
        this._eventPerTrigger = sm.perEvent;
        this._spawnKernel = this._buildSpawnKernel();
        return;
      }
    }
  }
  setFollowPosition(position, hasFollow) {
    for (const m of this.update) {
      const follower = m;
      follower.setFollowPosition?.(position, hasFollow);
    }
    this.render.setFollowPosition?.(position, hasFollow);
  }
  /**
   * Number of live particles, read back from the GPU. Async with a frame or two of latency
   * and a copy of up to `capacity * 16` bytes, so poll it a few times a second (debug HUDs,
   * editors) rather than every frame.
   */
  async countAlive(renderer) {
    const slots = this._aliveHighWater;
    if (slots === 0) return 0;
    const buf = await renderer.getArrayBufferAsync(
      this.buffer.storage.posAlive.value,
      null,
      0,
      slots * 16
    );
    const posAlive = new Float32Array(buf);
    let count = 0;
    for (let i = 3; i < posAlive.length; i += 4) if (posAlive[i] >= 0.5) count++;
    return count;
  }
  play() {
    this._emitterTime = 0;
    this._playing = true;
    this._spawning = true;
    this._ringHead = 0;
    this._aliveHighWater = 0;
    this.render.reset?.();
    if (this._seeded) this.rng.reseed(this._initialSeed);
    for (const s of this.spawn) s.reset?.();
  }
  stopSpawning() {
    this._spawning = false;
  }
  hardStop() {
    this._spawning = false;
    this._playing = false;
    this._aliveHighWater = 0;
    this.render.reset?.();
  }
  isAlive() {
    return this._playing;
  }
  /**
   * Pre-compile all compute kernels for this emitter. Dispatches each kernel once against
   * the (currently all-dead) particle storage — the work is harmless but forces the WebGPU
   * backend to translate WGSL → MSL/HLSL and build pipelines.
   *
   * Call once per prefab via `Manager.preload()` (or ambiently on first use). Without this,
   * the first real use of an Emitter pays the full shader-compilation cost up front —
   * typically frames-to-seconds depending on kernel complexity (bitonic sort especially).
   */
  warmup(renderer) {
    const kernels = [];
    this._updateKernel.count = 1;
    kernels.push(this._updateKernel);
    this.uSpawnCount.value = 1;
    this.uSpawnBase.value = 0;
    this.uSeedBase.value = 0;
    this._spawnKernel.count = 1;
    kernels.push(this._spawnKernel);
    if (this._sortKeyKernel) {
      this._sortKeyKernel.count = this.buffer.capacity;
      kernels.push(this._sortKeyKernel);
    }
    if (this._resetEventKernel) kernels.push(this._resetEventKernel);
    const promise = renderer.computeAsync(kernels);
    this._aliveHighWater = 0;
    this._ringHead = 0;
    this._playing = false;
    this._spawning = false;
    return Promise.resolve(promise);
  }
  tick(renderer, deltaTime, worldMatrix, intensity, camera, batch) {
    if (!this._playing) return;
    const prevTime = this._emitterTime;
    this._emitterTime += deltaTime;
    if (this.duration !== void 0 && prevTime >= this.duration) {
      if (this.loop) {
        this._emitterTime = this._emitterTime % this.duration;
        for (const s of this.spawn) s.reset?.();
      } else {
        this._spawning = false;
      }
    }
    this.uDt.value = deltaTime;
    this.uEmitterTime.value = this._emitterTime;
    this.uIntensity.value = intensity;
    this.uWorldMatrix.value.copy(worldMatrix);
    for (const m of this.update) m.beforeUpdate?.(deltaTime, camera);
    const ownsBatch = batch === void 0;
    const dispatch = ownsBatch ? [] : batch;
    if (this._resetEventKernel) dispatch.push(this._resetEventKernel);
    if (this._aliveHighWater > 0) {
      this._updateKernel.count = this._aliveHighWater;
      dispatch.push(this._updateKernel);
    }
    if (this._spawning) {
      const ctx = {
        rng: this.rng,
        deltaTime,
        emitterTime: this._emitterTime,
        intensity
      };
      let requested = 0;
      for (const s of this.spawn) requested += s.requestSpawn(ctx);
      const spawnCount = Math.min(requested, this.buffer.capacity);
      if (spawnCount > 0) {
        this.uSpawnCount.value = spawnCount;
        this.uSpawnBase.value = this._ringHead;
        this.uSeedBase.value = this.rng.u32();
        this._ringHead = (this._ringHead + spawnCount) % this.buffer.capacity;
        if (this._aliveHighWater < this.buffer.capacity) {
          this._aliveHighWater = Math.min(this._aliveHighWater + spawnCount, this.buffer.capacity);
        }
        this._spawnKernel.count = spawnCount;
        dispatch.push(this._spawnKernel);
      }
    }
    if (this.render.postUpdate && this._aliveHighWater > 0 && !ownsBatch && dispatch.length > 0) {
      const prePostUpdate = dispatch.slice();
      dispatch.length = 0;
      void renderer.computeAsync(prePostUpdate);
    } else if (ownsBatch && dispatch.length > 0) {
      void renderer.computeAsync(dispatch);
    }
    if (this.render.postUpdate && this._aliveHighWater > 0) {
      this.render.postUpdate(renderer, this._aliveHighWater, deltaTime, this._emitterTime);
    }
    if (this._sortEnabled && this._aliveHighWater > 0 && camera && this._uCameraView) {
      camera.updateMatrixWorld();
      this._uCameraView.value.copy(camera.matrixWorldInverse);
      this._dispatchSort(renderer);
    }
    if (!this._spawning && this.duration !== void 0 && !this.loop) {
      if (this._emitterTime > this.duration + this._retireTailSeconds) {
        this._playing = false;
      }
    }
  }
  syncRender(ctx) {
    this.render.updateRender(this._aliveHighWater, ctx);
  }
  dispose() {
    this.render.dispose();
  }
  // ─ Kernel builders ──────────────────────────────────────────────────────
  _dispatchSort(renderer) {
    if (!this._sortKeyKernel || !this._sortKeys) return;
    if (!this._sortEngine) {
      this._sortEngine = new BitonicSort(renderer, this._sortKeys);
    }
    this._sortKeyKernel.count = this.buffer.capacity;
    void renderer.computeAsync(this._sortKeyKernel);
    void this._sortEngine.compute(renderer);
  }
  /**
   * Build the compute kernel that packs per-slot depth + slot-index into a single uint32
   * and writes it into `_sortKeys`. After this kernel runs, `BitonicSort.compute()` sorts
   * the buffer ascending — the lower `SLOT_BITS` bits of each sorted element then name the
   * particle slot that should draw at that position.
   */
  _buildSortKeyKernel() {
    const storage = this.buffer.storage;
    const sortKeys = this._sortKeys;
    const uCamView = this._uCameraView;
    const SLOT_MASK2 = (1 << SLOT_BITS) - 1;
    const DEPTH_MAX_Q = (1 << DEPTH_BITS) - 1;
    const depthScale = DEPTH_MAX_Q / DEPTH_MAX_WORLD;
    return Fn(() => {
      const i = instanceIndex.toInt();
      const pos = attr.position.read(storage, i);
      const alive = attr.alive.read(storage, i);
      const viewPos = uCamView.mul(vec4(pos, 1));
      const depth = viewPos.z.negate();
      const depthQ = clamp(depth.mul(depthScale), float(0), float(DEPTH_MAX_Q)).toUint();
      const depthInv = uint(DEPTH_MAX_Q).sub(depthQ);
      const slot = instanceIndex.bitAnd(uint(SLOT_MASK2));
      const liveKey = depthInv.shiftLeft(uint(SLOT_BITS)).bitOr(slot);
      const deadKey = uint(4294967295);
      const key = alive.greaterThanEqual(0.5).select(liveKey, deadKey);
      sortKeys.element(i).assign(key);
    })().compute(this.buffer.capacity);
  }
  _buildResetEventKernel() {
    const counter = this.eventCounter;
    return Fn(() => {
      atomicStore(counter.element(0), 0);
    })().compute(1);
  }
  _buildSpawnKernel() {
    const storage = this.buffer.storage;
    const uSpawnCount = this.uSpawnCount;
    const uSpawnBase = this.uSpawnBase;
    const uSeedBase = this.uSeedBase;
    const eventSource = this._eventSource;
    const perTrigger = this._eventPerTrigger;
    const initModules = this.init;
    const spawnUpdateModules = this.update.filter((m) => m.applyOnSpawn);
    const uniforms = {
      worldMatrix: this.uWorldMatrix,
      emitterTime: this.uEmitterTime,
      intensity: this.uIntensity
    };
    return Fn(() => {
      const t = instanceIndex;
      const tFloat = float(t);
      If(tFloat.lessThan(uSpawnCount), () => {
        const slotF = uSpawnBase.add(tFloat).mod(float(this.buffer.capacity));
        const slotI = slotF.toInt().toVar();
        const rawMix = uSeedBase.add(tFloat.mul(7919.17));
        const seed = hash(rawMix).mul(1e6).toVar();
        const ctx = {
          storage,
          slot: slotI,
          seed,
          worldMatrix: uniforms.worldMatrix,
          emitterTime: uniforms.emitterTime,
          intensity: uniforms.intensity
        };
        const initSlot = (eventPos) => {
          attr.alive.write(storage, slotI, float(1));
          attr.age.write(storage, slotI, float(0));
          if (eventPos) attr.position.write(storage, slotI, eventPos);
          for (const m of initModules) m.contributeSpawnTSL(ctx);
          attr.initialColor.write(storage, slotI, attr.color.read(storage, slotI));
          attr.initialVelocity.write(storage, slotI, attr.velocity.read(storage, slotI));
          attr.initialSize.write(storage, slotI, attr.size.read(storage, slotI));
          const updateCtx = {
            storage,
            i: slotI,
            dt: this.uDt,
            emitterTime: uniforms.emitterTime,
            intensity: uniforms.intensity,
            worldMatrix: uniforms.worldMatrix
          };
          for (const m of spawnUpdateModules) m.contributeUpdateTSL(updateCtx);
        };
        if (eventSource?.eventBuffer && eventSource.eventCounter) {
          const eventIdx = tFloat.div(float(perTrigger)).floor();
          const eventCountF = float(asUint(atomicLoad(eventSource.eventCounter.element(0))));
          const eventValidF = eventIdx.lessThan(eventCountF);
          const eventRecord = eventSource.eventBuffer.element(eventIdx.toInt()).xyz;
          If(eventValidF, () => {
            initSlot(eventRecord);
          });
        } else {
          initSlot(null);
        }
      });
    })().compute(this.buffer.capacity);
  }
  _buildUpdateKernel() {
    const storage = this.buffer.storage;
    const uDt = this.uDt;
    const updateModules = this.update;
    const uniforms = {
      dt: this.uDt,
      emitterTime: this.uEmitterTime,
      intensity: this.uIntensity,
      worldMatrix: this.uWorldMatrix
    };
    const writeDeathEvents = this._writeDeathEvents;
    const eventBuffer = this.eventBuffer;
    const eventCounter = this.eventCounter;
    const eventCapacity = this.eventCapacity;
    return Fn(() => {
      const i = instanceIndex.toInt();
      const aliveFlag = attr.alive.read(storage, i).toVar();
      If(aliveFlag.greaterThanEqual(0.5), () => {
        const curAge = attr.age.read(storage, i);
        const newAge = curAge.add(uDt).toVar();
        const life = attr.lifetime.read(storage, i);
        If(newAge.greaterThanEqual(life), () => {
          if (writeDeathEvents && eventBuffer && eventCounter) {
            const pos = attr.position.read(storage, i);
            const prevCountU = asUint(atomicAdd(eventCounter.element(0), 1));
            const prevCountI = prevCountU.toInt();
            const prevCountF = float(prevCountU);
            If(prevCountF.lessThan(float(eventCapacity)), () => {
              eventBuffer.element(prevCountI).assign(vec4(pos, 1));
            });
          }
          attr.alive.write(storage, i, float(0));
        }).Else(() => {
          attr.age.write(storage, i, newAge);
          const ctx = {
            storage,
            i,
            dt: uniforms.dt,
            emitterTime: uniforms.emitterTime,
            intensity: uniforms.intensity,
            worldMatrix: this.uWorldMatrix
          };
          for (const m of updateModules) m.contributeUpdateTSL(ctx);
          if (writeDeathEvents && eventBuffer && eventCounter) {
            const postAlive = attr.alive.read(storage, i);
            If(postAlive.lessThan(0.5), () => {
              const pos = attr.position.read(storage, i);
              const prevCountU = asUint(atomicAdd(eventCounter.element(0), 1));
              const prevCountI = prevCountU.toInt();
              const prevCountF = float(prevCountU);
              If(prevCountF.lessThan(float(eventCapacity)), () => {
                eventBuffer.element(prevCountI).assign(vec4(pos, 1));
              });
            });
          }
        });
      });
    })().compute(this.buffer.capacity);
  }
};
function estimateMaxLifetime(initModules) {
  for (const mod of initModules) {
    if (mod.type !== "init.lifetime") continue;
    const lifetime = mod.lifetime;
    if (!lifetime) continue;
    return Math.max(0.05, maxScalarInput(lifetime) + 0.1);
  }
  return 5;
}
function maxScalarInput(input) {
  switch (input.kind) {
    case "constant":
      return input.value;
    case "range":
      return input.max;
    case "list":
      return input.values.length > 0 ? Math.max(...input.values) : 0;
  }
}
var System = class {
  name;
  emitters;
  object3D;
  position = new THREE14.Vector3();
  quaternion = new THREE14.Quaternion();
  scale = new THREE14.Vector3(1, 1, 1);
  intensity = 1;
  duration;
  loop;
  _systemTime = 0;
  _playing = true;
  _worldMatrix = new THREE14.Matrix4();
  constructor(def) {
    this.name = def.name;
    this.duration = def.duration;
    this.loop = def.loop ?? false;
    this.emitters = def.emitters.map((e) => new Emitter(e));
    this.object3D = new THREE14.Group();
    this.object3D.name = def.name ?? "PlumeSystem";
    this.object3D.matrixAutoUpdate = false;
    for (const em of this.emitters) this.object3D.add(em.render.object3D);
    for (const em of this.emitters) {
      for (const mod of em.spawn) {
        const resolver = mod.resolveSource;
        if (typeof resolver === "function") {
          resolver.call(mod, this.emitters);
        }
      }
    }
    for (const em of this.emitters) em.finalizeWiring();
  }
  play() {
    this._systemTime = 0;
    this._playing = true;
    for (const em of this.emitters) em.play();
  }
  /** Pre-compile all compute kernels for every emitter. See `Emitter.warmup`. */
  async warmup(renderer) {
    await Promise.all(this.emitters.map((em) => em.warmup(renderer)));
  }
  stopSpawning() {
    for (const em of this.emitters) em.stopSpawning();
  }
  hardStop() {
    this._playing = false;
    for (const em of this.emitters) em.hardStop();
  }
  /** Emitter lifecycle: true while any emitter has live particles or is still spawning. */
  isAlive() {
    if (!this._playing) return false;
    for (const em of this.emitters) if (em.isAlive()) return true;
    return false;
  }
  setIntensity(value) {
    this.intensity = Math.max(0, value);
  }
  setFollowPosition(position, hasFollow) {
    for (const em of this.emitters) em.setFollowPosition(position, hasFollow);
  }
  /** Live particles across all emitters. See {@link Emitter.countAlive} for cost. */
  async countAlive(renderer) {
    const counts = await Promise.all(this.emitters.map((em) => em.countAlive(renderer)));
    return counts.reduce((a, b) => a + b, 0);
  }
  /**
   * Update all emitters. Renderer is passed through for GPU compute dispatch.
   *
   * If `batch` is provided, emitter frame kernels are collected into it instead of being
   * dispatched inline — the Manager uses this to coalesce every active system's kernels
   * into a single `renderer.computeAsync([...])` call per tick, cutting per-frame command-
   * buffer submits from O(systems) down to O(1).
   */
  tick(renderer, deltaTime, parentIntensity, camera, batch) {
    if (!this._playing) return;
    this._systemTime += deltaTime;
    if (this.duration !== void 0 && this._systemTime > this.duration) {
      if (this.loop) {
        this._systemTime = this._systemTime % this.duration;
        for (const em of this.emitters) em.play();
      } else {
        this.stopSpawning();
      }
    }
    this._worldMatrix.compose(this.position, this.quaternion, this.scale);
    const effectiveIntensity = parentIntensity * this.intensity;
    for (const em of this.emitters)
      em.tick(renderer, deltaTime, this._worldMatrix, effectiveIntensity, camera, batch);
    if (!this.isAlive()) this._playing = false;
  }
  syncRender(camera, parentIntensity) {
    const ctx = {
      camera,
      worldMatrix: this._worldMatrix,
      intensity: parentIntensity * this.intensity
    };
    for (const em of this.emitters) em.syncRender(ctx);
  }
  dispose() {
    for (const em of this.emitters) em.dispose();
    if (this.object3D.parent) this.object3D.parent.remove(this.object3D);
  }
};
var Manager = class {
  renderer;
  scene;
  camera;
  maxActive;
  maxPoolPer;
  globalIntensity;
  fixedTimestep;
  maxAccumulatedTime;
  _prefabs = /* @__PURE__ */ new Map();
  _pool = /* @__PURE__ */ new Map();
  _active = [];
  _accum = 0;
  // Reused per-tick scratch for LOD / culling. Kept as instance fields so we don't allocate
  // every frame; the Manager is single-threaded per JS runtime so no aliasing concern.
  _frustum = new THREE14.Frustum();
  _frustumMatrix = new THREE14.Matrix4();
  _cullSphere = new THREE14.Sphere();
  _cameraWorldPos = new THREE14.Vector3();
  _systemWorldPos = new THREE14.Vector3();
  _followWorldPos = new THREE14.Vector3();
  // Shared compute batch; cleared + refilled each step, flushed as one `computeAsync`.
  _batchBuffer = [];
  constructor(options) {
    this.renderer = options.renderer;
    this.scene = options.scene;
    this.camera = options.camera;
    this.maxActive = options.maxActive ?? 128;
    this.maxPoolPer = options.maxPoolPer ?? 8;
    this.globalIntensity = options.globalIntensity ?? 1;
    this.fixedTimestep = options.fixedTimestep;
    this.maxAccumulatedTime = options.maxAccumulatedTime ?? 0.25;
  }
  /**
   * Register a prefab by id. Accepts either a plain `SystemDef` or a factory `() => SystemDef`.
   * Factories are called once per newly-created System instance, giving each pooled System
   * its own renderer/module instances (required for correct multi-spawn rendering).
   */
  register(id, def) {
    this._prefabs.set(id, def);
  }
  /**
   * Remove a prefab registration and dispose any inactive pooled instances for it.
   * Active instances are left alone; call `clear()` first when replacing a live preview.
   */
  unregister(id) {
    this._prefabs.delete(id);
    const pool = this._pool.get(id);
    if (pool) {
      for (const sys of pool) sys.dispose();
      this._pool.delete(id);
    }
  }
  /**
   * Preload pooled instances of a prefab for hot spawning — also warms their compute
   * pipelines so the first real spawn doesn't stall. Respects `maxPoolPer`; if `count` is
   * higher, the pool is capped and the rest are discarded. Call this for prefabs you plan
   * to spawn in bursts (e.g. a wave of explosions) so the user doesn't see a compile hitch.
   */
  async preload(id, count = 1) {
    const input = this._prefabs.get(id);
    if (!input) throw new Error(`plume: prefab "${id}" not registered`);
    const pool = this._getPool(id);
    const target = Math.min(count, this.maxPoolPer);
    const warmups = [];
    while (pool.length < target) {
      const sys = this._createSystem(input);
      warmups.push(sys.warmup(this.renderer));
      sys.hardStop();
      pool.push(sys);
    }
    await Promise.all(warmups);
  }
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
  async warmup(ids) {
    if (!this.camera) {
      throw new Error(
        "plume: Manager.warmup() requires a camera \u2014 set it in the constructor or assign manager.camera before calling."
      );
    }
    const targets = ids ? [...new Set(ids)].map((id) => {
      const input = this._prefabs.get(id);
      if (!input) throw new Error(`plume: prefab "${id}" not registered`);
      return [id, input];
    }) : [...this._prefabs];
    const warmSystems = [];
    for (const [id, input] of targets) {
      const sys = this._createSystem(input);
      warmSystems.push({ id, sys });
      this.scene.add(sys.object3D);
    }
    try {
      await Promise.all(warmSystems.map(({ sys }) => sys.warmup(this.renderer)));
      const restore = [];
      for (const { sys } of warmSystems) {
        for (const em of sys.emitters) {
          const obj = em.render.object3D;
          const prevVisible = obj.visible;
          obj.visible = true;
          restore.push(() => {
            obj.visible = prevVisible;
          });
          obj.traverse((child) => {
            const maybeInstanced = child;
            if (maybeInstanced.isInstancedMesh && typeof maybeInstanced.count === "number") {
              const prevCount = maybeInstanced.count;
              maybeInstanced.count = 1;
              restore.push(() => {
                maybeInstanced.count = prevCount;
              });
            }
          });
        }
      }
      await this.renderer.compileAsync(this.scene, this.camera);
      this.renderer.render(this.scene, this.camera);
      for (const fn of restore) fn();
    } finally {
      for (const { id, sys } of warmSystems) {
        sys.object3D.parent?.remove(sys.object3D);
        const pool = this._getPool(id);
        if (pool.length < this.maxPoolPer) pool.push(sys);
        else sys.dispose();
      }
    }
  }
  _createSystem(input) {
    const def = typeof input === "function" ? input() : input;
    return new System(def);
  }
  has(id) {
    return this._prefabs.has(id);
  }
  /** Spawn a registered prefab. Returns the System or null if at capacity / unknown id. */
  spawn(id, options = {}) {
    const input = this._prefabs.get(id);
    if (!input) return null;
    if (this._active.length >= this.maxActive) return null;
    const pool = this._getPool(id);
    const system2 = pool.pop() ?? this._createSystem(input);
    if (options.position)
      system2.position.set(options.position.x, options.position.y, options.position.z);
    else system2.position.set(0, 0, 0);
    if (options.quaternion) {
      system2.quaternion.set(
        options.quaternion.x,
        options.quaternion.y,
        options.quaternion.z,
        options.quaternion.w
      );
    } else {
      system2.quaternion.identity();
    }
    if (options.scale !== void 0) {
      if (typeof options.scale === "number")
        system2.scale.set(options.scale, options.scale, options.scale);
      else system2.scale.set(options.scale.x, options.scale.y, options.scale.z);
    } else {
      system2.scale.set(1, 1, 1);
    }
    system2.setIntensity(options.intensity ?? 1);
    const parent = options.parent ?? this.scene;
    parent.add(system2.object3D);
    system2.play();
    const entry = { id, system: system2, lod: options.lod, follow: options.follow, parent };
    this._syncFollow(entry);
    this._active.push(entry);
    return system2;
  }
  /**
   * Advance all active systems. Call once per frame before renderer.render().
   *
   * If `fixedTimestep` is set on construction, this accumulates `deltaTime` and dispatches
   * as many whole fixed-length steps as the accumulator allows — guaranteeing deterministic
   * output across framerate variation. Any remainder stays in the accumulator for next call.
   * If `fixedTimestep` is unset, the call delegates to `_stepOnce(deltaTime, ...)` as-is.
   */
  tick(deltaTime, camera) {
    const cam = camera ?? this.camera;
    const intensity = this.globalIntensity;
    if (this.fixedTimestep === void 0 || this.fixedTimestep <= 0) {
      this._stepOnce(deltaTime, intensity, cam);
      return;
    }
    this._accum = Math.min(this._accum + deltaTime, this.maxAccumulatedTime);
    const step = this.fixedTimestep;
    while (this._accum >= step) {
      this._stepOnce(step, intensity, cam);
      this._accum -= step;
    }
  }
  /** Reset the fixed-timestep accumulator. Call after seeking/scrubbing to avoid step backlog. */
  resetClock() {
    this._accum = 0;
  }
  _stepOnce(deltaTime, intensity, cam) {
    let frustumReady = false;
    if (cam) {
      cam.updateMatrixWorld();
      this._frustumMatrix.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
      this._frustum.setFromProjectionMatrix(this._frustumMatrix);
      cam.getWorldPosition(this._cameraWorldPos);
      frustumReady = true;
    }
    const batch = this._batchBuffer;
    batch.length = 0;
    for (let i = this._active.length - 1; i >= 0; i--) {
      const entry = this._active[i];
      const sys = entry.system;
      this._syncFollow(entry);
      let lodScale = 1;
      let visible = true;
      if (entry.lod && frustumReady) {
        this._systemWorldPos.copy(sys.position);
        const dist = this._cameraWorldPos.distanceTo(this._systemWorldPos);
        const maxDist = entry.lod.maxDistance;
        if (maxDist !== void 0) {
          const fadeStart = entry.lod.farFadeStart ?? maxDist;
          if (dist >= maxDist) {
            lodScale = 0;
          } else if (dist > fadeStart && maxDist > fadeStart) {
            lodScale = 1 - (dist - fadeStart) / (maxDist - fadeStart);
          }
        }
        if (entry.lod.bounds !== void 0) {
          this._cullSphere.set(this._systemWorldPos, entry.lod.bounds);
          visible = this._frustum.intersectsSphere(this._cullSphere);
        }
      }
      sys.object3D.visible = visible;
      sys.tick(this.renderer, deltaTime, intensity * lodScale, cam, batch);
      if (cam) sys.syncRender(cam, intensity * lodScale);
      if (!sys.isAlive()) {
        sys.object3D.parent?.remove(sys.object3D);
        const pool = this._getPool(entry.id);
        if (pool.length < this.maxPoolPer) {
          pool.push(sys);
        } else {
          sys.dispose();
        }
        this._active.splice(i, 1);
      }
    }
    if (batch.length > 0) void this.renderer.computeAsync(batch);
  }
  /** Hard-stop every active system and return them to the pool. */
  clear() {
    while (this._active.length > 0) {
      const entry = this._active.pop();
      entry.system.hardStop();
      entry.system.object3D.parent?.remove(entry.system.object3D);
      const pool = this._getPool(entry.id);
      if (pool.length < this.maxPoolPer) pool.push(entry.system);
      else entry.system.dispose();
    }
  }
  /** Dispose every system (pool + active) and release GPU resources. */
  dispose() {
    for (const e of this._active) e.system.dispose();
    this._active.length = 0;
    for (const pool of this._pool.values()) for (const s of pool) s.dispose();
    this._pool.clear();
  }
  _getPool(id) {
    let pool = this._pool.get(id);
    if (!pool) {
      pool = [];
      this._pool.set(id, pool);
    }
    return pool;
  }
  _syncFollow(entry) {
    const { follow, parent, system: system2 } = entry;
    if (!follow) {
      system2.setFollowPosition(system2.position, false);
      return;
    }
    const returned = follow.getPosition(this._followWorldPos);
    if (returned) this._followWorldPos.set(returned.x, returned.y, returned.z);
    if ((follow.space ?? "world") === "local") {
      parent.updateMatrixWorld(true);
      parent.localToWorld(this._followWorldPos);
    }
    system2.position.copy(this._followWorldPos);
    system2.setFollowPosition(this._followWorldPos, true);
  }
};

// src/serialization.ts
function systemDefToJSON(def) {
  return {
    version: 1,
    name: def.name,
    duration: def.duration,
    loop: def.loop,
    emitters: def.emitters.map(emitterDefToJSON)
  };
}
function emitterDefToJSON(def) {
  return {
    name: def.name,
    capacity: def.capacity,
    seed: def.seed,
    duration: def.duration,
    loop: def.loop,
    events: def.events,
    sortByDepth: def.sortByDepth,
    spawn: def.spawn.map((m) => m.toJSON()),
    init: def.init.map((m) => m.toJSON()),
    update: def.update.map((m) => m.toJSON()),
    render: def.render.toJSON()
  };
}
function systemDefFromJSON(json) {
  if (json.version !== 1) {
    throw new Error(`plume: unsupported system JSON version ${json.version}`);
  }
  return {
    name: json.name,
    duration: json.duration,
    loop: json.loop,
    emitters: json.emitters.map(emitterDefFromJSON)
  };
}
function emitterDefFromJSON(json) {
  return {
    name: json.name,
    capacity: json.capacity,
    seed: json.seed,
    duration: json.duration,
    loop: json.loop,
    events: json.events,
    sortByDepth: json.sortByDepth,
    spawn: json.spawn.map((m) => moduleFromJSON(m)),
    init: json.init.map((m) => moduleFromJSON(m)),
    update: json.update.map((m) => moduleFromJSON(m)),
    render: moduleFromJSON(json.render)
  };
}

// src/builder.ts
function isScalarInput(v) {
  return typeof v === "object" && v !== null && "kind" in v;
}
function isVec3Input(v) {
  return typeof v === "object" && v !== null && "kind" in v;
}
function isColorInput(v) {
  return typeof v === "object" && v !== null && "kind" in v;
}
function toScalarInput(input) {
  if (typeof input === "number") return { kind: "constant", value: input };
  if (isScalarInput(input)) return input;
  return { kind: "range", min: input.min, max: input.max };
}
function toVec3Input(input) {
  if (Array.isArray(input)) return { kind: "constant", value: input };
  if (isVec3Input(input)) return input;
  return { kind: "range", min: input.min, max: input.max };
}
function toColorInput(input) {
  if (Array.isArray(input)) return { kind: "constant", value: input };
  if (isColorInput(input)) return input;
  return { kind: "range", min: input.min, max: input.max };
}
function toCurve(input) {
  if (input instanceof Curve1D) return input;
  if (typeof input === "number") return Curve1D.constant(input);
  if (input.length === 0) throw new Error("plume: curve input must have at least one keyframe");
  const first = input[0];
  if (Array.isArray(first)) {
    const tuples = input;
    return new Curve1D(tuples.map(([t, v]) => ({ t, v })));
  }
  return new Curve1D(input);
}
function toGradient(input) {
  if (input instanceof Gradient) return input;
  return new Gradient(input);
}
function toTrailGradient(input) {
  if (input instanceof Gradient) return input;
  return new Gradient(
    input.map((stop) => {
      if (!Array.isArray(stop)) return stop;
      const [t, color] = stop;
      return {
        t,
        color: color.length === 4 ? color : [color[0], color[1], color[2], 1]
      };
    })
  );
}
var EmitterBuilder = class {
  _name;
  _capacity = 256;
  _duration;
  _loop;
  _seed;
  _sortByDepth = false;
  _events;
  _spawn = [];
  _init = [];
  _update = [];
  _render;
  constructor(name) {
    this._name = name;
  }
  // ─ Emitter-level ─
  name(value) {
    this._name = value;
    return this;
  }
  capacity(value) {
    this._capacity = value;
    return this;
  }
  duration(seconds) {
    this._duration = seconds;
    return this;
  }
  loop(value = true) {
    this._loop = value;
    return this;
  }
  seed(value) {
    this._seed = value;
    return this;
  }
  sortByDepth(value = true) {
    this._sortByDepth = value;
    return this;
  }
  emitEvents(config = { onDeath: true }) {
    this._events = config;
    return this;
  }
  // ─ Spawn ─
  spawnRate(rate) {
    this._spawn.push(new SpawnRate({ rate }));
    return this;
  }
  spawnBurst(bursts) {
    this._spawn.push(new SpawnBurst({ bursts: Array.isArray(bursts) ? bursts : [bursts] }));
    return this;
  }
  spawnFromEvents(source, perEvent = 1, maxEventsPerFrame) {
    this._spawn.push(new SpawnFromEvents({ source, perEvent, maxEventsPerFrame }));
    return this;
  }
  // ─ Init ─
  lifetime(input) {
    this._init.push(new InitLifetime({ lifetime: toScalarInput(input) }));
    return this;
  }
  position(params) {
    this._init.push(new InitPosition(params));
    return this;
  }
  velocity(params) {
    this._init.push(
      new InitVelocity({
        shape: params.shape,
        speed: toScalarInput(params.speed),
        worldSpace: params.worldSpace
      })
    );
    return this;
  }
  size(input) {
    this._init.push(new InitSize({ size: toScalarInput(input) }));
    return this;
  }
  rotation(input, opts = {}) {
    this._init.push(
      new InitRotation({
        rotation: toScalarInput(input),
        angularVelocity: opts.angularVelocity !== void 0 ? toScalarInput(opts.angularVelocity) : void 0
      })
    );
    return this;
  }
  color(color, opts = {}) {
    this._init.push(
      new InitColor({
        color: toColorInput(color),
        alpha: opts.alpha !== void 0 ? toScalarInput(opts.alpha) : void 0
      })
    );
    return this;
  }
  fromMesh(params) {
    this._init.push(new InitFromMesh(params));
    return this;
  }
  // ─ Update — in typical call order ─
  integrate() {
    this._update.push(new VelocityIntegrator());
    return this;
  }
  lifetimeTick() {
    this._update.push(new LifetimeTick());
    return this;
  }
  gravity(acceleration = -9.81) {
    const v = typeof acceleration === "number" ? [0, acceleration, 0] : acceleration;
    this._update.push(new Gravity({ acceleration: v }));
    return this;
  }
  drag(coefficient) {
    this._update.push(new Drag({ coefficient }));
    return this;
  }
  colorOverLife(gradient) {
    this._update.push(new ColorOverLife({ gradient: toGradient(gradient) }));
    return this;
  }
  sizeOverLife(curve) {
    this._update.push(new SizeOverLife({ curve: toCurve(curve) }));
    return this;
  }
  alphaOverLife(curve) {
    this._update.push(new AlphaOverLife({ curve: toCurve(curve) }));
    return this;
  }
  velocityOverLife(curve) {
    this._update.push(new VelocityOverLife({ curve: toCurve(curve) }));
    return this;
  }
  followPosition() {
    this._update.push(new FollowPosition());
    return this;
  }
  turbulence(params) {
    this._update.push(new TurbulenceForce(params));
    return this;
  }
  curlNoise(params) {
    this._update.push(new CurlNoiseForce(params));
    return this;
  }
  vortex(params) {
    this._update.push(new VortexForce(params));
    return this;
  }
  pointAttractor(params) {
    this._update.push(new PointAttractor(params));
    return this;
  }
  scaleBySpeed(params) {
    this._update.push(new ScaleBySpeed(params));
    return this;
  }
  planeCollision(params = {}) {
    this._update.push(new PlaneCollision(params));
    return this;
  }
  sphereCollision(params) {
    this._update.push(new SphereCollision(params));
    return this;
  }
  depthCollision(params) {
    this._update.push(new DepthCollision(params));
    return this;
  }
  sdfCollision(params) {
    this._update.push(new SdfCollision(params));
    return this;
  }
  flowmapForce(params) {
    this._update.push(new FlowmapForce(params));
    return this;
  }
  limitVelocity(params) {
    const p = typeof params === "number" ? { maxSpeed: params } : params;
    this._update.push(new LimitVelocity(p));
    return this;
  }
  // ─ Render — only one may be set; last call wins ─
  renderSprite(params = {}) {
    this._render = new SpriteRenderer(params);
    return this;
  }
  renderMesh(params) {
    this._render = new MeshRenderer(params);
    return this;
  }
  renderRibbon(params = {}) {
    this._render = new RibbonRenderer(params);
    return this;
  }
  renderBeam(params = {}) {
    this._render = new BeamRenderer(params);
    return this;
  }
  renderLight(params = {}) {
    this._render = new LightEmission(params);
    return this;
  }
  /** Attach a pre-constructed render module instance (e.g. one you already configured by hand). */
  renderWith(module) {
    this._render = module;
    return this;
  }
  build() {
    if (!this._render) {
      throw new Error(
        `plume: emitter${this._name ? ` "${this._name}"` : ""} has no render module; call one of renderSprite/renderMesh/renderRibbon/renderBeam/renderLight before build()`
      );
    }
    return {
      name: this._name,
      capacity: this._capacity,
      duration: this._duration,
      loop: this._loop,
      seed: this._seed,
      sortByDepth: this._sortByDepth,
      events: this._events,
      spawn: this._spawn,
      init: this._init,
      update: this._update,
      render: this._render
    };
  }
};
var TrailBuilder = class {
  _name;
  _capacity = 32;
  _sampleRate = 60;
  _minDistance = 0;
  _lifetime = 1;
  _widthOverLife = Curve1D.linear(0.1, 0);
  _alphaOverLife = Curve1D.linear(1, 0);
  _colorOverLife = Gradient.constant([1, 1, 1, 1]);
  _renderParams = {};
  constructor(name) {
    this._name = name;
  }
  name(value) {
    this._name = value;
    return this;
  }
  capacity(value) {
    this._capacity = Math.max(2, Math.floor(value));
    return this;
  }
  sampleRate(value) {
    this._sampleRate = Math.max(0, value);
    return this;
  }
  minDistance(value) {
    this._minDistance = Math.max(0, value);
    return this;
  }
  lifetime(seconds) {
    this._lifetime = Math.max(1e-3, seconds);
    return this;
  }
  widthOverLife(curve) {
    this._widthOverLife = toCurve(curve);
    return this;
  }
  alphaOverLife(curve) {
    this._alphaOverLife = toCurve(curve);
    return this;
  }
  colorOverLife(gradient) {
    this._colorOverLife = toTrailGradient(gradient);
    return this;
  }
  renderRibbon(params = {}) {
    this._renderParams = params;
    return this;
  }
  build(systemDuration) {
    const trailLifetime = this._lifetime;
    const headLifetime = Math.max(0.05, (systemDuration ?? trailLifetime) + trailLifetime + 0.1);
    return new EmitterBuilder(this._name).capacity(1).duration(1e-3).spawnBurst({ time: 0, count: 1 }).lifetime(headLifetime).position({ shape: { kind: "point" } }).size(1).color([1, 1, 1], { alpha: 1 }).followPosition().renderRibbon({
      ...this._renderParams,
      historyLength: this._capacity,
      sampleRate: this._sampleRate,
      minDistance: this._minDistance,
      sampleLifetime: trailLifetime,
      sampleUntil: systemDuration,
      widthOverLife: this._widthOverLife,
      alphaOverLife: this._alphaOverLife,
      colorOverLife: this._colorOverLife
    }).build();
  }
};
var SystemBuilder = class {
  _name;
  _duration;
  _loop;
  _emitters = [];
  _trailFactories = [];
  constructor(name) {
    this._name = name;
  }
  name(value) {
    this._name = value;
    return this;
  }
  duration(seconds) {
    this._duration = seconds;
    return this;
  }
  loop(value = true) {
    this._loop = value;
    return this;
  }
  emitter(arg1, arg2) {
    if (typeof arg1 === "string") {
      if (!arg2) throw new Error("plume: .emitter(name, build) requires a build callback");
      const b = new EmitterBuilder(arg1);
      const out = arg2(b);
      this._emitters.push(out.build());
      return this;
    }
    if (typeof arg1 === "function") {
      const b = new EmitterBuilder();
      const out = arg1(b);
      this._emitters.push(out.build());
      return this;
    }
    if (arg1 instanceof EmitterBuilder) {
      this._emitters.push(arg1.build());
      return this;
    }
    this._emitters.push(arg1);
    return this;
  }
  trail(arg1, arg2) {
    const name = typeof arg1 === "string" ? arg1 : void 0;
    const build = typeof arg1 === "string" ? arg2 : arg1;
    if (!build) throw new Error("plume: .trail(name, build) requires a build callback");
    const trail = build(new TrailBuilder(name));
    this._trailFactories.push((duration) => trail.build(duration));
    return this;
  }
  build() {
    const emitters = [
      ...this._emitters,
      ...this._trailFactories.map((factory) => factory(this._duration))
    ];
    if (emitters.length === 0) {
      throw new Error(
        `plume: system${this._name ? ` "${this._name}"` : ""} has no emitters; call .emitter(...) at least once before build()`
      );
    }
    return {
      name: this._name,
      duration: this._duration,
      loop: this._loop,
      emitters
    };
  }
};
function system(name) {
  return new SystemBuilder(name);
}
function emitter(name) {
  return new EmitterBuilder(name);
}
async function dumpShaders(renderer, target, options = {}) {
  const emitters = "emitters" in target ? target.emitters : [target];
  const perEmitter = await Promise.all(emitters.map((em) => dumpEmitter(renderer, em, options)));
  return {
    emitters: perEmitter,
    markdown: () => formatMarkdown(perEmitter)
  };
}
async function dumpEmitter(renderer, em, options) {
  const name = em.name ?? "<anon>";
  const nodes = renderer._nodes;
  const kernelShader = (kernel) => {
    if (!kernel || !nodes) return null;
    try {
      return nodes.getForCompute(kernel).computeShader ?? null;
    } catch {
      return null;
    }
  };
  const internals = em;
  const spawn = kernelShader(internals._spawnKernel);
  const update = kernelShader(internals._updateKernel);
  const sort = kernelShader(internals._sortKeyKernel);
  const resetEvents = kernelShader(internals._resetEventKernel);
  let render = null;
  if (options.camera) {
    let mesh = null;
    em.render.object3D.traverse((child) => {
      if (!mesh && child.isMesh) mesh = child;
    });
    if (mesh) {
      const scene = options.scene ?? makeTempScene(em.render.object3D);
      try {
        const result = await renderer.debug.getShaderAsync(scene, options.camera, mesh);
        render = { vertex: result.vertexShader, fragment: result.fragmentShader };
      } catch (err) {
        render = { vertex: null, fragment: null };
        console.warn(`plume: getShaderAsync failed for "${name}":`, err);
      }
    }
  }
  return { name, spawn, update, sort, resetEvents, render };
}
function makeTempScene(obj) {
  let cursor = obj;
  while (cursor) {
    if (cursor.isScene) return cursor;
    cursor = cursor.parent;
  }
  const scene = new THREE14.Scene();
  scene.add(obj);
  return scene;
}
function formatMarkdown(emitters) {
  const lines = [];
  lines.push(`# Plume shader dump \u2014 ${emitters.length} emitter${emitters.length === 1 ? "" : "s"}`);
  lines.push("");
  for (const e of emitters) {
    lines.push(`## Emitter: \`${e.name}\``);
    lines.push("");
    section(lines, "Spawn kernel (WGSL)", e.spawn);
    section(lines, "Update kernel (WGSL)", e.update);
    section(lines, "Sort-key kernel (WGSL)", e.sort);
    section(lines, "Reset-events kernel (WGSL)", e.resetEvents);
    if (e.render) {
      section(lines, "Render \u2014 vertex shader", e.render.vertex);
      section(lines, "Render \u2014 fragment shader", e.render.fragment);
    } else {
      lines.push("_No render shader available (pass `camera` to `dumpShaders` to include it)._");
      lines.push("");
    }
  }
  return lines.join("\n");
}
function section(lines, heading, body) {
  if (body === null) return;
  lines.push(`### ${heading}`);
  lines.push("");
  lines.push("```wgsl");
  lines.push(body.trim());
  lines.push("```");
  lines.push("");
}

export { AlphaOverLife, BeamRenderer, ColorOverLife, CurlNoiseForce, Curve1D, DepthCollision, Drag, Emitter, EmitterBuilder, FlowmapForce, FollowPosition, Gradient, Gravity, InitColor, InitFromMesh, InitLifetime, InitPosition, InitRotation, InitSize, InitVelocity, LifetimeTick, LightEmission, LimitVelocity, Manager, MeshRenderer, ParticleBuffer, PlaneCollision, PointAttractor, RNG, RibbonRenderer, ScaleBySpeed, SdfCollision, SizeOverLife, SpawnBurst, SpawnFromEvents, SpawnRate, SphereCollision, SpriteRenderer, System, SystemBuilder, TrailBuilder, TurbulenceForce, VelocityIntegrator, VelocityOverLife, VortexForce, circleTexture, disposeTextureCache, dumpShaders, emitter, emitterDefFromJSON, emitterDefToJSON, getModuleFactory, listRegisteredModules, moduleFromJSON, normalizeTextures, registerModule, sampleColor, sampleDirection, samplePosition, sampleScalar, sampleVec3, scrollUV, sdfBox, sdfIntersect, sdfPlane, sdfSphere, sdfSubtract, sdfUnion, sharedRNG, softCircleTexture, streakTexture, system, systemDefFromJSON, systemDefToJSON, toColorInput, toCurve, toGradient, toScalarInput, toVec3Input, unregisterModule };
//# sourceMappingURL=chunk-EAHWMAO4.js.map
//# sourceMappingURL=chunk-EAHWMAO4.js.map