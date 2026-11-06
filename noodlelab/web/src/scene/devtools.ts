// Development-only helpers for checking visuals in a browser pane that pauses animation
// (see CLAUDE.md). Not included in production builds.

import type { RootState } from "@react-three/fiber";
import * as THREE from "three";
import { exteriorLights } from "./lights";
import { progress } from "./progress";
import { vehicleState } from "./vehicleState";

/** One clock for all helpers, always moving forward: rendering with an earlier time than the last frame
 * gives negative frame times, which break the smoothed camera and lens offset. */
let clock = 0;
const tick = () => (clock = Math.max(clock + 16, performance.now()));

export function installDevtools(state: RootState) {
  const w = window as unknown as Record<string, unknown>;
  installShotSaver(state);
  installFocus(state);
  installBenchmark(state);
  /** Render at a fixed size (CSS pixels x pixel ratio) regardless of the window, for comparable captures. */
  w.__size = (width: number, height: number, dpr = 1.5) => {
    state.setDpr(dpr);
    state.setSize(width, height);
  };
  w.__vx = state;
  /** Exterior lamps on or off, for lit and unlit comparisons. */
  w.__lights = (on: boolean) => exteriorLights.set(on);
  w.__vxProgress = progress;
  /** Render the scene at explosion progress `p`, turntable turned to `turn` radians, camera tilted to `polar`. */
  w.__shot = async (p: number, turn?: number, polar?: number) => {
    state.setFrameloop("never");
    progress.set(p);
    // polar: camera angle down from straight overhead, in radians (about 1.4 is the default view)
    if (polar !== undefined) (state.get().controls as unknown as { rotatePolarTo(a: number, smooth: boolean): void }).rotatePolarTo(polar, false);
    if (turn !== undefined) state.scene.getObjectByName("turntable")!.rotation.y = turn;
    for (let i = 0; i < 150; i++) state.advance(tick()); // let the camera settle
    await new Promise((r) => setTimeout(r, 300));
    state.advance(tick());
    return state.camera.position.toArray().map((v) => +v.toFixed(2));
  };
}

type Controls = { setLookAt(...a: [number, number, number, number, number, number, boolean]): void };

/**
 * Close-up camera for comparisons: at explosion progress `p`, aim at the average centre of the given
 * parts from a fixed direction (azimuth / elevation in degrees) and distance, with the turntable square.
 * The same call gives the same camera for the procedural and the Blender versions. `only` limits
 * which parts are drawn.
 */
export function installFocus(state: RootState) {
  (window as unknown as Record<string, unknown>).__focus = async (p: number, ids: string[], azimuth: number, elevation: number, distance: number, only?: string[]) => {
    state.setFrameloop("never");
    // Optionally show only some parts (isolates an assembly for close-ups); otherwise show everything.
    for (const b of vehicleState.built) b.object.visible = !only || only.includes(b.id);
    progress.set(p);
    state.scene.getObjectByName("turntable")!.rotation.y = 0;
    for (let i = 0; i < 150; i++) state.advance(tick());
    const target = new THREE.Vector3();
    const parts = vehicleState.built.filter((b) => ids.includes(b.id));
    for (const b of parts) target.add(b.object.getWorldPosition(new THREE.Vector3()));
    target.divideScalar(parts.length);
    const a = THREE.MathUtils.degToRad(azimuth);
    const e = THREE.MathUtils.degToRad(elevation);
    const eye = target.clone().add(new THREE.Vector3(Math.sin(a) * Math.cos(e), Math.sin(e), Math.cos(a) * Math.cos(e)).multiplyScalar(distance));
    (state.get().controls as unknown as Controls).setLookAt(eye.x, eye.y, eye.z, target.x, target.y, target.z, false);
    for (let i = 0; i < 10; i++) state.advance(tick());
    return target.toArray().map((v) => +v.toFixed(3));
  };
}

/** Save the current 3D view (canvas only, no page overlay) to web/shots/<name>.jpg. It renders one
 * frame through the full pipeline, so the picture includes the current tier's effects. */
export function installShotSaver(state: RootState) {
  (window as unknown as Record<string, unknown>).__save = async (name: string) => {
    state.advance(tick());
    const blob = await new Promise<Blob | null>((r) => state.gl.domElement.toBlob(r, "image/jpeg", 0.92));
    if (!blob) throw new Error("Could not capture the canvas");
    return (await fetch(`/__shots/${name}.jpg`, { method: "POST", body: blob })).text();
  };
}

/**
 * Benchmark for checkpoints: `await __perf()` renders 40 frames each assembled, mid-animation and fully
 * exploded at the current size and quality tier, and reports the median and 90th-percentile frame time
 * (waiting for the GPU to finish), triangles and draw calls, plus download size and load time.
 * Use `__size(1440, 900, 1.5)` first so results compare across checkpoints.
 */
export function installBenchmark(state: RootState) {
  (window as unknown as Record<string, unknown>).__perf = async () => {
    const gl = state.gl.getContext();
    const { quality } = await import("./settings");
    state.setFrameloop("never");
    for (const b of vehicleState.built) b.object.visible = true;
    // Always the standard view: the app's starting camera angle, which pulls back as the vehicle explodes.
    (state.get().controls as unknown as Controls).setLookAt(8.4, 1.75, 8.4, 0, 0.72, 0, false);
    state.scene.getObjectByName("turntable")!.rotation.y = -0.5;
    const measure = (setup: (i: number) => void) => {
      setup(0);
      for (let i = 0; i < 60; i++) state.advance(tick()); // settle the camera and warm up shaders
      gl.finish();
      const times: number[] = [];
      state.gl.info.autoReset = false;
      for (let i = 1; i <= 40; i++) {
        setup(i);
        state.gl.info.reset();
        const start = performance.now();
        state.advance(tick());
        gl.finish();
        times.push(performance.now() - start);
      }
      state.gl.info.autoReset = true;
      times.sort((a, b) => a - b);
      const { triangles, calls } = state.gl.info.render;
      return { ms50: +times[20].toFixed(1), ms90: +times[36].toFixed(1), triangles, calls };
    };
    return {
      tier: quality.tier,
      assembled: measure(() => progress.set(0)),
      animating: measure((i) => progress.set(0.3 + (i % 40) * 0.01)),
      exploded: measure(() => progress.set(1)),
      downloadMB: +((vehicleState.loaded?.bytes ?? 0) / 1e6).toFixed(2),
      loadMs: Math.round(vehicleState.loaded?.millis ?? 0),
    };
  };
}
