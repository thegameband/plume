<script lang="ts">
  import { onMount, onDestroy, untrack } from "svelte";
  import * as THREE from "three";
  import { Timer } from "three";
  import { WebGPURenderer, MeshStandardNodeMaterial, PostProcessing, type Node } from "three/webgpu";
  import { pass } from "three/tsl";
  import { bloom } from "three/examples/jsm/tsl/display/BloomNode.js";
  import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
  import { TransformControls } from "three/examples/jsm/controls/TransformControls.js";
  import { Manager, type FollowTarget, type System } from "three-plume";

  import { graphStore, updateNodeParam } from "../graph/graphStore.svelte.js";
  import { getSpec } from "three-plume/graph";
  import { compileGraph, CompileError, type CompileContext } from "three-plume/graph";
  import { editorStore } from "../state.svelte.js";

  /** Vec3 field keys that get a draggable in-scene gizmo when the owning node
   *  is selected. Restricted to clearly positional fields so axis/colour vec3s
   *  don't sprout meaningless arrows. */
  const POSITION_LIKE_KEYS = new Set(["position", "center", "origin", "point"]);

  interface Gizmo {
    proxy: THREE.Object3D;
    ctrl: TransformControls;
    helper: THREE.Object3D;
    fieldKey: string;
  }

  /**
   * Preview pane: WebGPU scene with IBL + bloom post-processing, an off-screen
   * depth pass for `DepthCollision`, and a soft ground plane so lit-particle
   * effects (`MeshRenderer` + `LightEmission`) actually land on something.
   *
   * Two trigger paths:
   *   1. Header "Restart" button (`restartTick` increments).
   *   2. Live mode — debounced auto-rebuild on any graph change.
   *
   * Loop: each compiled System is `loop()`-tagged so it keeps emitting once
   * spawned. We don't restart it ourselves.
   */
  let { restartTick }: { restartTick: number } = $props();

  let host: HTMLDivElement | undefined = $state();
  let renderer: WebGPURenderer | undefined;
  let scene: THREE.Scene | undefined;
  let camera: THREE.PerspectiveCamera | undefined;
  let controls: OrbitControls | undefined;
  let manager: Manager | undefined;
  let timer: Timer | undefined;
  let rafId: number | undefined;
  let resizeObserver: ResizeObserver | undefined;

  // Live particle count, read back from the GPU a few times a second.
  let currentSystem: System | undefined;
  let particleCount: number | undefined = $state(undefined);
  let countTimer: ReturnType<typeof setInterval> | undefined;
  let countPending = false;

  function pollParticleCount(): void {
    if (countPending || !renderer) return;
    const sys = currentSystem;
    if (!sys) {
      particleCount = undefined;
      return;
    }
    countPending = true;
    sys
      .countAlive(renderer)
      .then((n) => {
        if (sys === currentSystem) particleCount = n;
      })
      .catch(() => {})
      .finally(() => (countPending = false));
  }
  let registeredCount = 0;
  let currentPreviewId: string | undefined;
  let ready = false;

  // PostProcessing pipeline drives the final image through scene-pass + bloom.
  // Without bloom HDR particle colours look LDR — every Niagara-tier reference
  // VFX has it, so it's a baseline rendering feature, not a polish step.
  let postProcessing: PostProcessing | undefined;
  let bloomOutput: Node | undefined;
  let plainOutput: Node | undefined;
  let bloomEnabled = $state(true);

  // Motion: orbit the emitter around its spawn origin so trails and spread read as they
  // would on a moving object. Speed is along the circle, in metres per second.
  let motionEnabled = $state(false);
  let motionRadius = $state(1);
  let motionSpeed = $state(2);

  // InitPosition/InitFromMesh ignore the emitter transform unless World space is on.
  const spawnsInWorldSpace = $derived(
    graphStore.nodes.some(
      (n) => (n.data.type === "init.position" || n.data.type === "init.from_mesh") && n.data.params.worldSpace === true,
    ),
  );

  function circleFollow(center: THREE.Vector3): FollowTarget {
    // Integrate the angle per call so radius/speed edits don't jump the emitter around the circle.
    let angle = 0;
    let last = performance.now();
    return {
      getPosition: (out) => {
        const now = performance.now();
        const radius = Math.max(0.01, motionRadius || 0);
        angle += (((now - last) / 1000) * (motionSpeed || 0)) / radius;
        last = now;
        return out.set(
          center.x + Math.cos(angle) * radius,
          center.y,
          center.z + Math.sin(angle) * radius,
        );
      },
    };
  }

  // Off-screen depth target. `update.depth_collision` reads from this; the
  // ground plane + any opaque mesh particles render here once per frame.
  // Only allocated when at least one `update.depth_collision` node is present
  // in the current graph — a graph that doesn't need depth shouldn't pay for
  // an extra render-target pass each frame.
  let depthTarget: THREE.RenderTarget | undefined;
  let depthScene: THREE.Scene | undefined; // mirrors the main scene's opaque content
  let depthPassEnabled = false;

  // Ground plane reference so we can keep it in sync between main + depth scenes.
  let ground: THREE.Mesh | undefined;

  let liveDebounceTimer: ReturnType<typeof setTimeout> | undefined;

  // Active gizmos keyed by nodeId:fieldKey. Recomputed on selection / graph
  // changes. Disposed eagerly so dragging old gizmos can't ghost-write back
  // into stale params.
  let gizmos: Map<string, Gizmo> = new Map();

  function makeDepthTarget(w: number, h: number): THREE.RenderTarget {
    const t = new THREE.RenderTarget(w, h, {
      depthBuffer: true,
      // Storing depth as a texture lets us sample it from compute shaders.
      depthTexture: new THREE.DepthTexture(w, h, THREE.UnsignedShortType),
    });
    return t;
  }

  onMount(async () => {
    if (!host) return;

    renderer = new WebGPURenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(host.clientWidth, host.clientHeight);
    // Near-black background so HDR effects pop. Bloom is the multiplier here —
    // a mid-grey background flattens contrast and kills the wow factor.
    renderer.setClearColor(new THREE.Color(0x05060a));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    host.appendChild(renderer.domElement);
    await renderer.init();

    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x05060a);

    // Dim ambient + low-angle key/fill so the floor reads as a dark glossy
    // surface but isn't pitch black. The fire/particle effects supply most of
    // the actual scene illumination via bloom + emissive HDR colours.
    const ambient = new THREE.AmbientLight(0xffffff, 0.08);
    scene.add(ambient);
    const key = new THREE.DirectionalLight(0xffffff, 0.35);
    key.position.set(3, 5, 2);
    scene.add(key);
    const fill = new THREE.DirectionalLight(0x88aaff, 0.12);
    fill.position.set(-3, 2, -2);
    scene.add(fill);

    // Dark glossy floor — low metalness with low roughness gives a near-mirror
    // ground that picks up the fire's reflection (the "wet asphalt" look every
    // Niagara demo uses to sell bright effects).
    const groundMat = new MeshStandardNodeMaterial();
    groundMat.color = new THREE.Color(0x080a10);
    groundMat.roughness = 0.35;
    groundMat.metalness = 0.0;
    ground = new THREE.Mesh(new THREE.PlaneGeometry(20, 20), groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = 0;
    scene.add(ground);

    // Subtle wire grid floats just above the ground plane for orientation.
    const grid = new THREE.GridHelper(10, 10, 0x202430, 0x101218);
    grid.position.y = 0.001;
    scene.add(grid);

    camera = new THREE.PerspectiveCamera(55, host.clientWidth / host.clientHeight, 0.1, 100);
    camera.position.set(2, 2, 4);
    camera.lookAt(0, 0.5, 0);

    controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(0, 0.5, 0);
    controls.enableDamping = true;

    manager = new Manager({ renderer, scene, camera, maxActive: 8 });

    timer = new Timer();
    timer.connect(document);

    // ── Post-processing pipeline ──
    // Render the scene into a TSL `pass`, then add a bloom node on top. The
    // PostProcessing object owns the final blit to the canvas, so we DON'T
    // call renderer.render(scene, camera) directly anymore — that would draw
    // the un-bloomed image OVER our composited result.
    postProcessing = new PostProcessing(renderer);
    const scenePass = pass(scene, camera);
    // strength=0.7 gives a healthy halo without nuking everything;
    // radius=0.85 spreads the glow widely; threshold=0.6 means only HDR pixels
    // (intensity > ~0.6 post-tonemap) contribute to bloom.
    const bloomPass = bloom(scenePass, 0.7, 0.85, 0.6);
    plainOutput = scenePass;
    bloomOutput = scenePass.add(bloomPass);
    postProcessing.outputNode = bloomEnabled ? bloomOutput : plainOutput;

    // Depth scene mirrors the ground plane — built lazily the first time a
    // graph compile asks for depth_collision (see ensureDepthPass).
    // Observe the host rather than the window: the preview column is user-resizable.
    resizeObserver = new ResizeObserver(() => {
      if (!renderer || !camera || !host) return;
      const w = host.clientWidth;
      const h = host.clientHeight;
      if (w === 0 || h === 0) return;
      renderer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      depthTarget?.setSize(w, h);
    });
    resizeObserver.observe(host);
    countTimer = setInterval(pollParticleCount, 250);

    function tick(): void {
      if (!renderer || !scene || !camera || !timer || !manager || !controls || !postProcessing) return;
      timer.update();
      const dt = Math.min(timer.getDelta(), 1 / 30);
      controls.update();
      manager.tick(dt, camera);

      // Refresh depth texture (depth_collision input) before the main pass.
      if (depthPassEnabled && depthScene && depthTarget) {
        const prev = renderer.getRenderTarget();
        renderer.setRenderTarget(depthTarget);
        renderer.render(depthScene, camera);
        renderer.setRenderTarget(prev);
      }

      // PostProcessing.render() drives the entire scene → bloom → screen path.
      postProcessing.render();
      rafId = requestAnimationFrame(tick);
    }
    tick();

    ready = true;
    // Live mode's first debounced rebuild usually fires while `renderer.init()` is still
    // pending and gets dropped, so catch up once the preview exists.
    if (editorStore.live) void rebuildAndSpawn();
  });

  function previewContext(): CompileContext {
    return {
      depthTexture: depthTarget?.depthTexture ?? undefined,
      camera,
      soloEmitterId: graphStore.soloEmitterId,
    };
  }

  function ensureDepthPass(): void {
    if (depthPassEnabled || !host || !scene) return;
    depthScene = new THREE.Scene();
    const groundDepth = new THREE.Mesh(
      new THREE.PlaneGeometry(20, 20),
      new MeshStandardNodeMaterial(),
    );
    groundDepth.rotation.x = -Math.PI / 2;
    depthScene.add(groundDepth);
    depthTarget = makeDepthTarget(host.clientWidth, host.clientHeight);
    depthPassEnabled = true;
  }

  async function rebuildAndSpawn(): Promise<void> {
    if (!manager) {
      editorStore.statusText = "Restart ignored — preview not initialized yet.";
      return;
    }
    if (!ready) {
      editorStore.statusText = "Restart ignored — preview still warming up.";
      return;
    }

    // If any node in the current graph asks for depth_collision, allocate the
    // depth pass once (idempotent) before compiling so the context has a valid
    // depthTexture to hand to the module.
    if (graphStore.nodes.some((n) => n.data.type === "update.depth_collision")) {
      ensureDepthPass();
    }

    let result;
    try {
      result = compileGraph(graphStore.nodes, graphStore.edges, previewContext());
    } catch (err) {
      const msg = err instanceof CompileError ? err.message : String(err);
      editorStore.statusText = `Compile error: ${msg}`;
      return;
    }

    const id = `editor_graph_${++registeredCount}`;
    const previousId = currentPreviewId;
    editorStore.statusText = `Compiling ${result.summary}…`;

    manager.register(id, result.def);
    try {
      await manager.preload(id, 1);
    } catch (err) {
      manager.unregister(id);
      editorStore.statusText = `Warmup failed: ${err instanceof Error ? err.message : String(err)}`;
      console.error("[plume-editor] warmup error:", err);
      return;
    }

    manager.clear();
    currentSystem = undefined;
    if (previousId) manager.unregister(previousId);
    currentPreviewId = id;

    // Take the spawnOrigin from the first emitter node so users can place
    // emitters at non-origin positions (rain at the sky, lightning at altitude,
    // etc.). For multi-emitter graphs all emitters share this transform —
    // additional offsets need to be baked into per-emitter init.position.
    const firstEmitter = graphStore.nodes.find(
      (n) => getSpec(n.data.type).category === "emitter",
    );
    const origin = firstEmitter?.data.params.spawnOrigin;
    const pos = Array.isArray(origin) && origin.length === 3
      ? new THREE.Vector3(origin[0] as number, origin[1] as number, origin[2] as number)
      : new THREE.Vector3(0, 0.5, 0);

    const sys = manager.spawn(id, {
      position: pos,
      follow: motionEnabled ? circleFollow(pos) : undefined,
    });
    if (!sys) {
      manager.unregister(id);
      currentPreviewId = undefined;
      editorStore.statusText = `Spawn returned null (at capacity?) — ${result.summary}`;
      return;
    }
    currentSystem = sys;

    editorStore.statusText = `${editorStore.live ? "Live (auto)" : "Live"} · ${result.summary}`;
  }

  function disposeGizmo(g: Gizmo): void {
    g.ctrl.detach();
    g.ctrl.dispose();
    if (scene) {
      scene.remove(g.helper);
      scene.remove(g.proxy);
    }
  }

  function makeGizmo(nodeId: string, fieldKey: string, position: [number, number, number]): Gizmo {
    if (!scene || !camera || !renderer || !controls) {
      throw new Error("makeGizmo: scene not initialized");
    }
    const proxy = new THREE.Object3D();
    proxy.position.set(position[0], position[1], position[2]);
    scene.add(proxy);

    // A small visual marker so users can see where the gizmo lives even when
    // the TransformControls' arrow tips occlude.
    const marker = new THREE.Mesh(
      new THREE.SphereGeometry(0.05, 16, 12),
      new THREE.MeshBasicMaterial({ color: 0x9ae6b4, transparent: true, opacity: 0.6 }),
    );
    proxy.add(marker);

    const ctrl = new TransformControls(camera, renderer.domElement);
    ctrl.attach(proxy);
    ctrl.setSize(0.6);
    // The controls' helper is what shows the gizmo gizmo arrows in scene.
    const helper = ctrl.getHelper();
    scene.add(helper);

    // Pause OrbitControls while dragging so camera doesn't fight the user.
    ctrl.addEventListener("dragging-changed", (event: { value: unknown }) => {
      if (controls) controls.enabled = !event.value;
    });
    ctrl.addEventListener("objectChange", () => {
      const p = proxy.position;
      // Round to keep saved JSON tidy.
      const r = (n: number): number => Math.round(n * 1000) / 1000;
      updateNodeParam(nodeId, fieldKey, [r(p.x), r(p.y), r(p.z)]);
    });

    return { proxy, ctrl, helper, fieldKey };
  }

  // Sync gizmos with the selected node's position-like vec3 fields. Runs on
  // every selection or graph-content change.
  $effect(() => {
    if (!ready || !scene) return;
    const selectedId = graphStore.selectedId;
    const nodes = graphStore.nodes;

    untrack(() => {
      const selectedNode = selectedId ? nodes.find((n) => n.id === selectedId) : undefined;
      const wantedKeys = new Set<string>();
      if (selectedNode) {
        const spec = getSpec(selectedNode.data.type);
        for (const f of spec.fields) {
          if (f.kind === "vec3" && POSITION_LIKE_KEYS.has(f.key)) {
            wantedKeys.add(`${selectedNode.id}:${f.key}`);
          }
        }
      }

      // Drop gizmos no longer wanted.
      for (const [key, g] of gizmos) {
        if (!wantedKeys.has(key)) {
          disposeGizmo(g);
          gizmos.delete(key);
        }
      }

      // Add or sync gizmos for every wanted key.
      for (const key of wantedKeys) {
        const colon = key.indexOf(":");
        const nodeId = key.slice(0, colon);
        const fieldKey = key.slice(colon + 1);
        const node = nodes.find((n) => n.id === nodeId);
        if (!node) continue;
        const v = node.data.params[fieldKey];
        const pos: [number, number, number] = Array.isArray(v) && v.length === 3
          ? [v[0] as number, v[1] as number, v[2] as number]
          : [0, 0, 0];

        const existing = gizmos.get(key);
        if (existing) {
          // Sync if param changed externally (inspector typing).
          existing.proxy.position.set(pos[0], pos[1], pos[2]);
        } else {
          gizmos.set(key, makeGizmo(nodeId, fieldKey, pos));
        }
      }
    });
  });

  // Swapping the output node (rather than zeroing strength) skips the bloom passes entirely.
  $effect(() => {
    const enabled = bloomEnabled;
    if (!postProcessing || !bloomOutput || !plainOutput) return;
    postProcessing.outputNode = enabled ? bloomOutput : plainOutput;
    postProcessing.needsUpdate = true;
  });

  // Follow is fixed at spawn time, so toggling Motion respawns the effect.
  let motionSeen = false;
  $effect(() => {
    motionEnabled;
    if (!motionSeen) {
      motionSeen = true;
      return;
    }
    untrack(() => void rebuildAndSpawn());
  });

  // Restart button — skip the initial 0 click.
  $effect(() => {
    if (restartTick === 0) return;
    void rebuildAndSpawn();
  });

  // Solo is a preview toggle, so it rebuilds straight away even with Live off.
  let lastSolo: string | undefined = graphStore.soloEmitterId;
  $effect(() => {
    const solo = graphStore.soloEmitterId;
    if (solo === lastSolo) return;
    lastSolo = solo;
    untrack(() => void rebuildAndSpawn());
  });

  // Live mode: rebuild whenever any node, edge, or selectedId changes.
  $effect(() => {
    graphStore.nodes;
    graphStore.edges;

    if (!editorStore.live) return;

    untrack(() => {
      if (liveDebounceTimer !== undefined) clearTimeout(liveDebounceTimer);
      liveDebounceTimer = setTimeout(() => {
        void rebuildAndSpawn();
      }, 300);
    });
  });

  onDestroy(() => {
    if (rafId !== undefined) cancelAnimationFrame(rafId);
    resizeObserver?.disconnect();
    if (countTimer !== undefined) clearInterval(countTimer);
    if (liveDebounceTimer !== undefined) clearTimeout(liveDebounceTimer);
    for (const g of gizmos.values()) disposeGizmo(g);
    gizmos.clear();
    manager?.dispose();
    depthTarget?.dispose();
    renderer?.dispose();
  });
</script>

<div class="preview-wrap">
  <div class="preview-host" bind:this={host}></div>
  <div class="particle-count">
    {particleCount === undefined ? "—" : particleCount.toLocaleString()} particles
  </div>
  <div class="preview-controls">
    <div class="preview-toggles">
      <label class="preview-toggle">
        <input type="checkbox" bind:checked={motionEnabled} />
        Motion
      </label>
      <label class="preview-toggle">
        <input type="checkbox" bind:checked={bloomEnabled} />
        Bloom
      </label>
    </div>
    {#if motionEnabled}
      <div class="motion-panel">
        <label class="motion-field">
          <span>Radius (m)</span>
          <input type="number" min="0.1" step="0.1" bind:value={motionRadius} />
        </label>
        <label class="motion-field">
          <span>Speed (m/s)</span>
          <input type="number" min="0" step="0.5" bind:value={motionSpeed} />
        </label>
        {#if !spawnsInWorldSpace}
          <p class="motion-note">
            Turn on <strong>World space</strong> in InitPosition to see the motion. Without it,
            particles ignore where the emitter is.
          </p>
        {/if}
      </div>
    {/if}
  </div>
</div>

<style>
  .preview-wrap {
    position: relative;
    width: 100%;
    height: 100%;
  }
  .preview-host {
    width: 100%;
    height: 100%;
    background: #0b0c10;
  }
  .particle-count {
    position: absolute;
    top: 8px;
    left: 8px;
    padding: 4px 8px;
    border-radius: 4px;
    background: rgba(17, 19, 26, 0.8);
    color: #c9ced8;
    font: 12px/1.4 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    pointer-events: none;
    user-select: none;
  }
  .preview-controls {
    position: absolute;
    top: 8px;
    right: 8px;
    display: flex;
    flex-direction: column;
    align-items: stretch;
    gap: 6px;
  }
  .preview-toggles {
    display: flex;
    gap: 6px;
  }
  .motion-panel {
    display: flex;
    flex-direction: column;
    gap: 6px;
    width: 0;
    min-width: 100%;
    box-sizing: border-box;
    padding: 6px 8px;
    border-radius: 4px;
    background: rgba(17, 19, 26, 0.8);
    color: #c9ced8;
    font-size: 12px;
  }
  .motion-field {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }
  .motion-field input {
    width: 64px;
    padding: 2px 4px;
    border: 1px solid #2a2c33;
    border-radius: 3px;
    background: #0e1116;
    color: #e7e7e9;
    font: inherit;
  }
  .motion-note {
    margin: 0;
    color: #f6c177;
    line-height: 1.35;
  }
  .preview-toggle {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px 8px;
    border-radius: 4px;
    background: rgba(17, 19, 26, 0.8);
    color: #c9ced8;
    font-size: 12px;
    cursor: pointer;
    user-select: none;
  }
</style>
