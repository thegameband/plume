import { vec3, vec4 } from "three/tsl";
import type { ModuleJSON, ParticleSpawnModule, SpawnInitContext } from "../module.js";
import { attr } from "../../particle-buffer.js";
import type { EmissionShape } from "../../math/shapes.js";
import { samplePositionTSL } from "../../math/tsl-sample.js";
import { registerModule } from "../registry.js";

export interface InitPositionParams {
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

export class InitPosition implements ParticleSpawnModule {
  static readonly type = "init.position";
  readonly kind = "particle_spawn" as const;
  readonly type = InitPosition.type;
  readonly id?: string;
  shape: EmissionShape;
  worldSpace: boolean;
  offset: [number, number, number];

  constructor(params: InitPositionParams) {
    this.shape = params.shape;
    this.worldSpace = params.worldSpace ?? true;
    this.offset = params.offset ?? [0, 0, 0];
    this.id = params.id;
  }

  contributeSpawnTSL(ctx: SpawnInitContext): void {
    const sampled = samplePositionTSL(this.shape, ctx.seed, 20);
    const [ox, oy, oz] = this.offset;
    const localPos = ox === 0 && oy === 0 && oz === 0 ? sampled : sampled.add(vec3(ox, oy, oz));
    const worldPos = this.worldSpace ? ctx.worldMatrix.mul(vec4(localPos, 1.0)).xyz : localPos;
    attr.position.write(ctx.storage, ctx.slot, worldPos);
  }

  toJSON(): ModuleJSON {
    return {
      type: InitPosition.type,
      id: this.id,
      shape: this.shape,
      worldSpace: this.worldSpace,
      offset: this.offset,
    };
  }

  static fromJSON(data: ModuleJSON): InitPosition {
    return new InitPosition({
      shape: data["shape"] as EmissionShape,
      worldSpace: data["worldSpace"] as boolean | undefined,
      offset: data["offset"] as [number, number, number] | undefined,
      id: data.id,
    });
  }
}

registerModule(InitPosition);
