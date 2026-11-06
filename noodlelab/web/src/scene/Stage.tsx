// The studio: camera, lighting and the slow turntable.
// Lighting imitates automotive product photography: a large soft box overhead, long strip
// lights either side that draw clean reflections along the body, and a dim rim light behind.

import { CameraControls, ContactShadows, Environment, Lightformer, PerformanceMonitor } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { EffectComposer, N8AO, ToneMapping } from "@react-three/postprocessing";
import { ToneMappingMode } from "postprocessing";
import { memo, Suspense, useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { explodedVolume } from "./framing";
import { progress } from "./progress";
import { HALF_RES_AO_ABOVE, quality, settings, useQualityTier, type Tier } from "./settings";
import { Vehicle } from "./Vehicle";

function Turntable({ spinning, children }: { spinning: boolean; children: React.ReactNode }) {
  const ref = useRef<THREE.Group>(null);
  useFrame((_, dt) => {
    if (spinning && ref.current) ref.current.rotation.y += dt * 0.09;
  });
  return (
    <group ref={ref} name="turntable" rotation={[0, -0.5, 0]}>
      {children}
    </group>
  );
}

/** Screen space taken by the side panels (CSS pixels), and where the TypeQL overlay ends (right and bottom edges;
 * null when closed), so the vehicle can be framed in what is left. */
export interface Insets { left: number; right: number; overlay: { right: number; bottom: number } | null }

/** Kept clear at the bottom for the explode controls and focus bar, and at the top for the brand line (CSS pixels). */
const CONTROLS = 165;
const BRAND = 64;

/** While the intro text is showing, shift the picture so the vehicle sits right of the headline. While exploring,
 * frame it in the free space: between the side panels and between the brand line and the controls, and beside or
 * below the TypeQL overlay (whichever leaves it larger). A lens "film offset" sideways, a view offset up or down
 * and a wider lens when the space is small, so the camera itself doesn't move. */
/** A framing target: how far to move the picture (CSS pixels) and how much to widen the lens. */
interface FrameTarget { dx: number; down: number; fit: number }

/** Re-frame only for a real change: the vehicle's size by more than 8%, or its position by more than 24 px. */
const significant = (a: FrameTarget, b: FrameTarget) =>
  Math.abs(a.fit / b.fit - 1) > 0.08 || Math.abs(a.dx - b.dx) > 24 || Math.abs(a.down - b.down) > 24;
/** How much wider than the free space between the side panels the vehicle may be (it extends behind them), and how
 * far the lens may narrow below the base angle (a slightly closer view when the screen is roomy). */
const OVERHANG = 1.3;
const MIN_FIT = 0.9;
/** While the TypeQL overlay is open, the vehicle's centre moves right by this share of the overlay's slot (from the
 * explorer's edge to the overlay's right edge); its size does not change, so it reaches further behind the part panel. */
const OVERLAY_SHIFT = 0.4;
/** How long the layout must hold still before the camera follows it (ms). */
const SETTLE_MS = 150;

function Framing({ exploring, insets }: { exploring: boolean; insets: Insets }) {
  const { camera, size } = useThree();
  // The target the camera is gliding towards, a candidate waiting for the layout to settle, and the last progress
  // seen: the framing follows the explosion continuously, but other changes only once settled and significant.
  const committed = useRef<FrameTarget | null>(null);
  const candidate = useRef<{ target: FrameTarget; since: number } | null>(null);
  const lastProgress = useRef(progress.value);
  const wasExploring = useRef(exploring);
  useFrame((_, dt) => {
    const cam = camera as THREE.PerspectiveCamera;
    const { width: W, height: H } = size;
    // Film offset that moves the image right by dx pixels (negative offset = content moves right).
    const aspect = W / H;
    const filmWidth = cam.filmGauge * Math.min(aspect, 1);
    const shift = (dx: number) => -(dx / W) * filmWidth * 2 * Math.tan(THREE.MathUtils.degToRad(cam.fov / 2)) * aspect;
    // On narrow (portrait) screens, widen the lens so the whole car still fits across.
    const baseFov = aspect >= 1.4 ? 24 : Math.min(55, (24 * 1.4) / aspect);
    let dx = 0, down = 0, fit = 1;
    if (exploring) {
      // How much room the vehicle takes with the base lens (a fixed vertical angle, so its size on screen scales with
      // the window's height): assembled about 0.95 of the height across and 45% of the height tall, from any angle
      // with a margin; fully exploded a little wider and nearly the whole height.
      const e = 1 - Math.pow(1 - progress.value, 2.5);
      // On phones the panels cover the whole width (as sheets), so only the overlay above counts, and the wider
      // portrait lens makes the vehicle span the width but little of the height.
      const phone = W < 640;
      const need = phone
        ? { w: W * 0.92, h: H * THREE.MathUtils.lerp(0.26, 0.8, e) }
        : { w: H * THREE.MathUtils.lerp(0.95, 1.05, e), h: H * THREE.MathUtils.lerp(0.46, 0.95, e) };
      if (phone) {
        // Phones: the vehicle below the overlay, across the full width.
        const y0 = Math.max(insets.overlay?.bottom ?? 0, BRAND), y1 = H - 120;
        fit = Math.min(Math.max(need.w / W, need.h / Math.max(y1 - y0, 1), 1), 2.6);
        down = (y0 + y1) / 2 - H / 2;
      } else {
        // Desktop: the scene is a full-width background behind the panels. The vehicle is centred in the band between
        // the brand line and the controls, and may reach behind the panels and the TypeQL overlay: it is sized to be
        // up to OVERHANG times the free width, so it stays large. While the overlay is open, the vehicle moves right
        // (OVERLAY_SHIFT), behind the part panel rather than the TypeQL. The overlay's slot is fixed by its styles,
        // never its content, so switching selections never moves the camera.
        const x0 = insets.left, x1 = W - insets.right, y1 = H - CONTROLS;
        const o = insets.overlay;
        const free = Math.max(x1 - x0, W * 0.4);
        fit = Math.min(Math.max(need.w / (free * OVERHANG), need.h / (y1 - BRAND), MIN_FIT), 2.6);
        // The shift never takes the vehicle's far end (about need.w / fit wide on screen) past the window's edge.
        const shift = o ? Math.max(o.right - x0, 0) * OVERLAY_SHIFT : 0;
        const room = W - 16 - ((x0 + x1) / 2 + need.w / fit / 2);
        dx = (x0 + x1) / 2 - W / 2 + Math.max(Math.min(shift, room), 0);
        down = (BRAND + y1) / 2 - H / 2;
      }
    }
    // Decide whether to take this framing as the new target.
    const now = performance.now();
    const fresh: FrameTarget = { dx, down, fit };
    const moving = progress.value !== lastProgress.current || progress.direction !== 0;
    lastProgress.current = progress.value;
    const switched = exploring !== wasExploring.current;
    wasExploring.current = exploring;
    if (!committed.current || moving || switched) {
      committed.current = fresh;              // first frame, the explosion moving, or entering the explorer
      candidate.current = null;
    } else if (significant(fresh, committed.current)) {
      const c = candidate.current;
      if (!c || significant(fresh, c.target) || Math.abs(fresh.fit / c.target.fit - 1) > 0.005) candidate.current = { target: fresh, since: now };
      else if (now - c.since >= SETTLE_MS) {
        committed.current = fresh;
        candidate.current = null;
      }
    } else candidate.current = null;
    ({ dx, down, fit } = committed.current);

    const target = exploring ? shift(dx) : W < 900 ? 0 : -3.2;
    // Glide towards the target, and settle on it exactly once within a fraction of a pixel (no endless tail).
    const glided = THREE.MathUtils.damp(cam.filmOffset, target, 3, dt);
    const next = Math.abs(glided - target) < 5e-4 ? target : glided;
    const wanted = THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(baseFov / 2)) * fit));
    const fov = Math.abs(wanted - cam.fov) < 0.02 ? wanted : THREE.MathUtils.damp(cam.fov, wanted, 3, dt);
    const view = cam.view;
    const current = view?.enabled ? -view.offsetY : 0;
    const damped = THREE.MathUtils.damp(current, down, 3, dt);
    const settled = Math.abs(damped - down) < 0.5 ? down : damped;
    const viewChanged = Math.abs(current - settled) > 0.01 || (view?.enabled && (view.fullWidth !== W || view.fullHeight !== H));
    if (Math.abs(next - cam.filmOffset) > 1e-4 || Math.abs(cam.fov - fov) > 1e-4 || viewChanged) {
      cam.filmOffset = next;
      cam.fov = fov;
      if (settled !== 0) cam.setViewOffset(W, H, 0, -settled, W, H);
      else cam.clearViewOffset();
      cam.updateProjectionMatrix();
    }
  });
  return null;
}

const ASSEMBLED_VIEW = { targetY: 0.72, distance: 11.9 };

/** Camera distance that shows the whole exploded assembly from any orbit angle, on this screen. */
function explodedDistance(aspect: number, fovDeg: number) {
  const v = THREE.MathUtils.degToRad(fovDeg) / 2;
  const h = Math.atan(Math.tan(v) * aspect);
  const { radius, halfHeight } = explodedVolume;
  const margin = aspect < 1 ? 0.88 : 1.02; // on portrait screens the width limit alone is overly cautious
  const byWidth = radius / Math.tan(h) + radius * 0.6; // the near side of the assembly comes towards the camera
  const byHeight = halfHeight / Math.tan(v) + radius * 0.6;
  return Math.max(byWidth, byHeight) * margin;
}

/** Orbit / zoom / pan, plus an automatic reframe while the explosion progresses: the camera keeps
 * its angle (the viewer's choice) but rises and pulls back until the whole assembly is in view. */
function Controls({ exploring }: { exploring: boolean }) {
  const ref = useRef<React.ComponentRef<typeof CameraControls>>(null);
  const framed = useRef(0);
  const { size } = useThree();
  useEffect(() => {
    ref.current?.setTarget(0, ASSEMBLED_VIEW.targetY, 0, false); // look at the middle of the car, not the ground
  }, []);
  useFrame(() => {
    const c = ref.current;
    const p = progress.value;
    if (!c || Math.abs(p - framed.current) < 1e-4) return;
    framed.current = p;
    const e = 1 - Math.pow(1 - p, 2.5); // pull back early: the assembly opens up fast at the start
    // The base lens (before any widening for the side panels, which Framing applies on top).
    const aspect = size.width / size.height;
    const far = explodedDistance(aspect, aspect >= 1.4 ? 24 : Math.min(55, (24 * 1.4) / aspect));
    c.setTarget(0, THREE.MathUtils.lerp(ASSEMBLED_VIEW.targetY, explodedVolume.centreY, e), 0, true);
    c.dollyTo(THREE.MathUtils.lerp(ASSEMBLED_VIEW.distance, far, e), true);
  });
  return (
    <CameraControls
      ref={ref}
      makeDefault
      enabled={exploring}
      minDistance={3}
      maxDistance={60}
      maxPolarAngle={Math.PI / 2 - 0.04}
      smoothTime={0.35}
    />
  );
}

/** Lights that travel with the camera: a soft key from over the viewer's shoulder and two cool rim
 * lights from behind the assembly, so every part has a bright outline against the dark background
 * whichever way it is viewed. They strengthen as the vehicle opens up. */
function CameraLights() {
  const key = useRef<THREE.DirectionalLight>(null);
  const rimL = useRef<THREE.DirectionalLight>(null);
  const rimR = useRef<THREE.DirectionalLight>(null);
  const { camera, scene } = useThree();
  const v = useMemo(() => ({ fwd: new THREE.Vector3(), right: new THREE.Vector3(), up: new THREE.Vector3(0, 1, 0) }), []);
  useFrame(() => {
    const p = progress.value;
    camera.getWorldDirection(v.fwd);
    v.right.crossVectors(v.fwd, v.up).normalize();
    const place = (light: THREE.DirectionalLight | null, along: number, side: number, up: number, intensity: number) => {
      if (!light) return;
      light.position.copy(v.fwd).multiplyScalar(along).addScaledVector(v.right, side).addScaledVector(v.up, up);
      light.target.position.set(0, 0, 0);
      light.target.updateMatrixWorld();
      light.intensity = intensity;
    };
    place(key.current, -10, -6, 8, 0.6 + 0.9 * p);
    place(rimL.current, 12, -9, 6, 0.9 + 1.6 * p);
    place(rimR.current, 12, 9, 4, 0.7 + 1.3 * p);
    scene.environmentIntensity = 0.9 + 0.5 * p; // the studio map, brighter as the vehicle opens up
  });
  return (
    <>
      <directionalLight ref={key} color="#fff6ec" />
      <directionalLight ref={rimL} color="#cfe0ff" />
      <directionalLight ref={rimR} color="#e6f2ff" />
    </>
  );
}

/** Reflections and soft light come from a photographed studio (Poly Haven "Monochrome Studio 02", CC0:
 * dark ceiling, rectangular softboxes). A few long strip lights are added on top: they draw the clean
 * highlight lines along the bodywork that automotive photography relies on. */
function Studio() {
  return (
    <Environment files={`${import.meta.env.BASE_URL}env/monochrome_studio_02_1k.hdr`} resolution={512} frames={1} environmentIntensity={0.9}>
      <Lightformer form="rect" intensity={2.2} position={[0, 2.2, 6]} scale={[14, 0.3, 1]} />
      <Lightformer form="rect" intensity={2.2} position={[0, 2.2, -6]} rotation-y={Math.PI} scale={[14, 0.3, 1]} />
      <Lightformer form="rect" intensity={1.4} position={[0, 6, 0]} rotation-x={Math.PI / 2} scale={[9, 3, 1]} />
      <Lightformer form="ring" color="#bcd7ff" intensity={1.2} position={[-4, 5, -4]} scale={2.5} />
      {/* faint surrounding walls and floor bounce: metal facing the camera reflects soft grey, never black */}
      <Lightformer form="rect" intensity={0.35} position={[0, -5, 0]} rotation-x={-Math.PI / 2} scale={[30, 30, 1]} />
      <Lightformer form="rect" intensity={0.3} position={[0, 2, 12]} scale={[30, 10, 1]} />
      <Lightformer form="rect" intensity={0.3} position={[0, 2, -12]} rotation-y={Math.PI} scale={[30, 10, 1]} />
      <Lightformer form="rect" intensity={0.25} position={[12, 2, 0]} rotation-y={-Math.PI / 2} scale={[30, 10, 1]} />
      <Lightformer form="rect" intensity={0.25} position={[-12, 2, 0]} rotation-y={Math.PI / 2} scale={[30, 10, 1]} />
    </Environment>
  );
}

/** Ambient occlusion for opaque parts only. N8AO otherwise notices the ghosted (transparent) parts of a semantic focus
 * and renders every one of them twice more per frame for its transparency compositing: about 1,450 extra draw calls
 * and a full scene walk each time, for no visible gain on a part at 11% opacity (C3c step 7). */
function opaqueOnly(pass: { autoDetectTransparency: boolean; configuration: { transparencyAware: boolean } } | null) {
  if (!pass) return;
  pass.autoDetectTransparency = false;
  pass.configuration.transparencyAware = false;
}

/** Post-processing for the current quality tier (see settings.ts). Steps down a tier when frames are slow. */
function Effects({ tier }: { tier: Tier }) {
  const { size, viewport } = useThree();
  if (!settings.effects || tier === "low") return null;
  // Occlusion cost grows with pixels; on very large canvases the high tier computes it at half resolution.
  const pixels = size.width * size.height * viewport.dpr * viewport.dpr;
  const halfRes = tier !== "high" || (settings.ao ? settings.ao === "half" : pixels > HALF_RES_AO_ABOVE);
  return (
    <EffectComposer multisampling={tier === "high" ? 4 : 2}>
      {/* Ambient occlusion: soft darkening where surfaces meet (crevices, contact between parts). */}
      <N8AO ref={opaqueOnly} aoRadius={0.18} distanceFalloff={0.6} intensity={2.4} quality={tier === "high" ? "high" : "medium"} halfRes={halfRes} />
      <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
    </EffectComposer>
  );
}

export const Stage = memo(function Stage({ exploring, reducedMotion, selectedId, highlight, insets, onSelect, onHover }: {
  exploring: boolean;
  reducedMotion: boolean;
  selectedId: string | null;
  highlight: Map<string, "primary" | "secondary" | "degraded"> | null;
  insets: Insets;
  onSelect: (id: string | null) => void;
  onHover: (id: string | null) => void;
}) {
  const tier = useQualityTier();
  return (
    <Canvas
      dpr={tier === "high" || tier === "medium" ? [1, 1.5] : 1}
      gl={{ antialias: true, toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure: 1.08 }}
      camera={{ position: [8.4, 1.75, 8.4], fov: 24, near: 0.1, far: 100 }}
      onPointerMissed={() => onSelect(null)}
      onCreated={(state) => {
        if (import.meta.env.DEV) import("./devtools").then((d) => d.installDevtools(state));
      }}
    >
      <color attach="background" args={["#060709"]} />
      <fog attach="fog" args={["#060709", 34, 70]} />
      <Studio />
      <Framing exploring={exploring} insets={insets} />
      <directionalLight position={[3, 8, 2]} intensity={0.6} />
      <hemisphereLight args={["#cfd8e2", "#0b0c0f", 0.45]} />
      <CameraLights />
      <Turntable spinning={!exploring && !reducedMotion}>
        <Suspense fallback={null}>
          <group position={[0.04, 0, 0]}>
            <Vehicle selectedId={selectedId} highlight={highlight} onSelect={exploring ? onSelect : () => {}}
              onHover={exploring ? onHover : () => {}} />
          </group>
          {/* Soft shadow under the car. Captured once (after the car has loaded) and turned with it. */}
          <ContactShadows position={[0, 0.001, 0]} opacity={0.8} scale={[6.5, 3.2]} blur={2.4} far={1.2} resolution={512} frames={1} color="#000000" />
        </Suspense>
      </Turntable>
      <Controls exploring={exploring} />
      <Effects tier={tier} />
      {/* Watches the frame rate; if it stays low, drop to the next quality tier. */}
      <PerformanceMonitor flipflops={1} onDecline={() => quality.stepDown()} />
    </Canvas>
  );
});
