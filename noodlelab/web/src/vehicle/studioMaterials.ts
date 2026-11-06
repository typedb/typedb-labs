// Physically based materials for the Blender-modelled parts, matched by the material names the
// Blender scripts assign (see blender/corner.py). Surface detail comes from small textures generated
// here in code, so there are no image files to license or download:
//  - concentric machining marks and circular brushing for discs, hubs and diamond-cut wheel faces
//    (these parts carry "radial" UVs centred on the axle, so the rings line up with the real axis)
//  - a fine grain for cast and forged metal and for brake-pad friction material.

import * as THREE from "three";

const SIZE = 1024;

function canvasTexture(size: number, paint: (img: ImageData) => void, repeat = false, height = size, paintAfter?: (img: ImageData) => void): THREE.Texture {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = height;
  const ctx = canvas.getContext("2d")!;
  const img = ctx.createImageData(size, height);
  paint(img);
  paintAfter?.(img);
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.flipY = false; // match glTF texture coordinates
  tex.colorSpace = THREE.NoColorSpace; // data, not colour
  tex.anisotropy = 8;
  if (repeat) tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

/** Deterministic pseudo-random noise (no Math.random: the picture must be identical every load). */
function hash(x: number, y: number) {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return s - Math.floor(s);
}

/** Roughness (green channel) with concentric lathe rings around the texture centre. */
function radialRoughness(base: number, depth: number) {
  return canvasTexture(SIZE, (img) => {
    for (let y = 0; y < SIZE; y++) {
      for (let x = 0; x < SIZE; x++) {
        const r = Math.hypot(x - SIZE / 2, y - SIZE / 2);
        const rings = 0.5 + 0.5 * Math.sin(r * 2.4) * Math.sin(r * 0.37 + 1.3);
        const v = Math.min(1, Math.max(0, base + depth * (rings - 0.5) + 0.04 * (hash(Math.round(r * 4), 7) - 0.5)));
        const i = (y * SIZE + x) * 4;
        img.data[i] = 0;
        img.data[i + 1] = v * 255;
        img.data[i + 2] = 255; // metalness channel: fully metallic
        img.data[i + 3] = 255;
      }
    }
  });
}

/** Anisotropy direction map: the brushing runs round the circle (tangent to the rings). */
function radialAnisotropy() {
  return canvasTexture(SIZE, (img) => {
    for (let y = 0; y < SIZE; y++) {
      for (let x = 0; x < SIZE; x++) {
        const dx = x - SIZE / 2 + 0.5;
        const dy = y - SIZE / 2 + 0.5;
        const len = Math.hypot(dx, dy) || 1;
        const i = (y * SIZE + x) * 4;
        img.data[i] = ((-dy / len) * 0.5 + 0.5) * 255;
        img.data[i + 1] = ((dx / len) * 0.5 + 0.5) * 255;
        img.data[i + 2] = 255;
        img.data[i + 3] = 255;
      }
    }
  });
}

/** Tileable grain in the roughness channel: cast metal, forged metal, friction material. */
function grain(base: number, depth: number, scale: number) {
  const n = 512;
  return canvasTexture(
    n,
    (img) => {
      for (let y = 0; y < n; y++) {
        for (let x = 0; x < n; x++) {
          const coarse = hash(Math.floor(x / scale) % (n / scale), Math.floor(y / scale) % (n / scale));
          const fine = hash(x, y);
          const v = Math.min(1, Math.max(0, base + depth * (0.6 * coarse + 0.4 * fine - 0.5)));
          const i = (y * n + x) * 4;
          img.data[i] = 0;
          img.data[i + 1] = v * 255;
          img.data[i + 2] = 255;
          img.data[i + 3] = 255;
        }
      }
    },
    true,
  );
}

/**
 * Tyre tread as a normal map (surface direction per pixel), one tread pitch wide and the full tyre width
 * tall; the tyre's UVs repeat it 64 times round. Shoulder blocks get angled lateral slots (staggered
 * between the two shoulders); the middle ribs get fine angled sipes. The circumferential grooves are real
 * geometry. v runs across the tyre: the tread spans about 0.15 to 0.85.
 */
function treadTextures(): { normal: THREE.Texture; cavity: THREE.Texture } {
  const W = 256;
  const H = 1024;
  const height = new Float32Array(W * H);
  const smooth = (e0: number, e1: number, x: number) => {
    const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
    return t * t * (3 - 2 * t);
  };
  for (let y = 0; y < H; y++) {
    const v = y / H;
    for (let x = 0; x < W; x++) {
      const u = x / W;
      let h = 1;
      // shoulder slots: one per pitch on each shoulder, half a pitch apart, slanting outwards
      for (const [v0, v1, phase, dir] of [[0.15, 0.275, 0.5, 1], [0.725, 0.85, 0.0, -1]] as const) {
        if (v > v0 && v < v1) {
          const along = dir > 0 ? v - v0 : v1 - v;
          const centre = (phase + along * 0.55) % 1;
          const d = Math.min(Math.abs(u - centre), 1 - Math.abs(u - centre));
          h -= 0.75 * (1 - smooth(0.04, 0.065, d)) * smooth(0.0, 0.02, dir > 0 ? v1 - v : v - v0);
        }
      }
      // sipes across the three middle ribs
      if (v > 0.3 && v < 0.7 && !(Math.abs(v - 0.426) < 0.026 || Math.abs(v - 0.574) < 0.026)) {
        const centre = (v * 1.6) % 0.5;
        const d = Math.min(Math.abs((u % 0.5) - centre), 0.5 - Math.abs((u % 0.5) - centre));
        h -= 0.45 * (1 - smooth(0.006, 0.012, d));
      }
      height[y * W + x] = h + 0.015 * (hash(x, y) - 0.5);
    }
  }
  const normal = canvasTexture(W, (img) => img, true, H, (img) => {
    const at = (x: number, y: number) => height[Math.min(H - 1, Math.max(0, y)) * W + ((x + W) % W)];
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const dx = (at(x + 1, y) - at(x - 1, y)) * 3;
        const dy = (at(x, y + 1) - at(x, y - 1)) * 3;
        const len = Math.hypot(dx, dy, 1);
        const i = (y * W + x) * 4;
        img.data[i] = (-dx / len) * 127.5 + 127.5;
        img.data[i + 1] = (-dy / len) * 127.5 + 127.5;
        img.data[i + 2] = (1 / len) * 127.5 + 127.5;
        img.data[i + 3] = 255;
      }
    }
  });
  // Ambient occlusion (red channel): light reaches less far into slots and sipes, so they read darker.
  const cavity = canvasTexture(W, (img) => img, true, H, (img) => {
    for (let k = 0; k < W * H; k++) {
      const v = Math.min(1, Math.max(0, 0.25 + 0.75 * height[k])) * 255;
      img.data[k * 4] = v;
      img.data[k * 4 + 1] = v;
      img.data[k * 4 + 2] = v;
      img.data[k * 4 + 3] = 255;
    }
  });
  return { normal, cavity };
}

export interface StudioTextures {
  tread: THREE.Texture;
  treadCavity: THREE.Texture;
  ringsFine: THREE.Texture;
  ringsFriction: THREE.Texture;
  brushing: THREE.Texture;
  cast: THREE.Texture;
  forged: THREE.Texture;
  friction: THREE.Texture;
}

/** Generate the surface textures (needs a browser: they are drawn on a canvas). */
export function createStudioTextures(): StudioTextures {
  const { normal: tread, cavity: treadCavity } = treadTextures();
  for (const t of [tread, treadCavity]) {
    t.repeat.set(64, 1);
    t.wrapT = THREE.ClampToEdgeWrapping;
  }
  return {
    tread,
    treadCavity,
    ringsFine: radialRoughness(0.2, 0.22),
    ringsFriction: radialRoughness(0.32, 0.3),
    brushing: radialAnisotropy(),
    cast: grain(0.55, 0.35, 4),
    forged: grain(0.36, 0.18, 8),
    friction: grain(0.92, 0.12, 2),
  };
}

export function createStudioMaterials(textures: StudioTextures = createStudioTextures()): Map<string, THREE.MeshPhysicalMaterial> {
  const { tread, treadCavity, ringsFine, ringsFriction, brushing, cast, forged, friction } = textures;

  const m = (p: THREE.MeshPhysicalMaterialParameters) => new THREE.MeshPhysicalMaterial(p);
  const c = (hex: string) => new THREE.Color(hex);
  const library = new Map<string, THREE.MeshPhysicalMaterial>([
    // tyre: soft black rubber with a faint sheen on the sidewall, never pure black
    ["rubber-tyre", m({ color: c("#1d1e21"), roughness: 0.86, sheen: 0.35, sheenRoughness: 0.6, sheenColor: c("#5b6068"), roughnessMap: friction })],
    ["rubber-tread", m({ color: c("#1b1c1f"), roughness: 0.9, normalMap: tread, normalScale: new THREE.Vector2(1.6, 1.6), aoMap: treadCavity, aoMapIntensity: 1, sheen: 0.2, sheenColor: c("#4b4f55") })],
    ["rubber", m({ color: c("#1b1c1f"), roughness: 0.78, sheen: 0.2, sheenColor: c("#4a4e55") })],
    // wheel (D1.4): satin graphite paint, and a machined face under a smoked lacquer, so the spokes read as a
    // restrained dark metallic accent rather than bright silver against the dark body
    ["alloy-painted", m({ color: c("#25282c"), metalness: 0.65, roughness: 0.42, clearcoat: 0.6, clearcoatRoughness: 0.2 })],
    ["alloy-machined", m({ color: c("#6f747a"), metalness: 1, roughness: 1, roughnessMap: ringsFine, anisotropy: 0.6, anisotropyMap: brushing, clearcoat: 0.8, clearcoatRoughness: 0.08 })],
    ["gloss-black", m({ color: c("#101114"), metalness: 0.3, roughness: 0.12, clearcoat: 1 })],
    ["steel-chrome", m({ color: c("#eef0f2"), metalness: 1, roughness: 0.07 })],
    ["steel-zinc", m({ color: c("#bdb8aa"), metalness: 1, roughness: 0.36 })],
    ["steel-dark", m({ color: c("#3d4045"), metalness: 0.6, roughness: 0.5 })],
    // exterior (D1.3, refined in D1.4): graphite metallic paint whose flake roughness and slightly soft clear coat
    // keep reflections controlled (not a mirror); dark tinted glass that still shows the cabin; satin-black lower body
    ["body-paint", m({ color: c("#42484f"), metalness: 0.7, roughness: 0.36, clearcoat: 1, clearcoatRoughness: 0.1 })],
    ["body-glass", m({ color: c("#0b0f13"), metalness: 0.45, roughness: 0.05, transparent: true, opacity: 0.86, clearcoat: 1, clearcoatRoughness: 0.02 })],
    ["roof-glass", m({ color: c("#0c1015"), metalness: 0.55, roughness: 0.05, clearcoat: 1, clearcoatRoughness: 0.02 })],
    ["satin-black", m({ color: c("#141518"), metalness: 0.05, roughness: 0.72 })],
    // lamps (D1.4): the lit elements; their glow is set by setExteriorLights (off: a faint unlit sheen)
    ["lamp", m({ color: c("#8e959d"), metalness: 0.4, roughness: 0.25, emissive: c("#f2f6ff"), emissiveIntensity: 0.04 })],
    ["tail-lamp", m({ color: c("#6e0f14"), roughness: 0.2, emissive: c("#ff1a24"), emissiveIntensity: 0.05 })],
    ["lamp-lens", m({ color: c("#aab4be"), metalness: 0, roughness: 0.04, transparent: true, opacity: 0.06, specularIntensity: 0.6, depthWrite: false })],
    ["tail-lens", m({ color: c("#3a0508"), metalness: 0, roughness: 0.03, transparent: true, opacity: 0.45, clearcoat: 1, depthWrite: false })],
    // retro-reflectors in the rear bumper: deep red, never lit
    ["reflector", m({ color: c("#5a0a10"), metalness: 0, roughness: 0.25, clearcoat: 1 })],
    ["lamp-housing", m({ color: c("#040405"), metalness: 0, roughness: 0.6 })],
    ["lamp-bezel", m({ color: c("#5c6168"), metalness: 1, roughness: 0.22 })],
    ["trim-dark-metal", m({ color: c("#2b2f34"), metalness: 0.9, roughness: 0.5 })],
    // the panels' cut edges, seen in the shut lines: near black, so the gaps read as dark lines
    ["shut-black", m({ color: c("#060607"), metalness: 0, roughness: 0.9 })],
    ["mirror-glass", m({ color: c("#9aa2ab"), metalness: 1, roughness: 0.03 })],
    ["camera-lens", m({ color: c("#06080b"), metalness: 0.6, roughness: 0.04, clearcoat: 1 })],
    ["sensor-window", m({ color: c("#07090c"), metalness: 0.5, roughness: 0.04, clearcoat: 1 })],
    // body-in-white: pressed steel in its grey electro-coat (D1.2)
    ["body-ecoat", m({ color: c("#6c7279"), metalness: 0.2, roughness: 0.5, clearcoat: 0.25, clearcoatRoughness: 0.35 })],
    // the black underbody protection on the structure's faces inside the wheelhouses (D1.4)
    ["underbody-coat", m({ color: c("#141518"), metalness: 0, roughness: 0.85 })],
    ["steel-machined", m({ color: c("#c7cbcf"), metalness: 1, roughness: 1, roughnessMap: ringsFine, anisotropy: 0.7, anisotropyMap: brushing })],
    // brakes: machined friction faces with circular brushing; cast iron vanes; anodised aluminium hat;
    // calliper in an anodised bronze (a restrained warm accent against the cool metals)
    ["iron-friction", m({ color: c("#a3a6a9"), metalness: 1, roughness: 1, roughnessMap: ringsFriction, anisotropy: 0.9, anisotropyMap: brushing })],
    ["iron-cast", m({ color: c("#55585c"), metalness: 0.85, roughness: 1, roughnessMap: cast })],
    ["aluminium-anodised", m({ color: c("#3e4248"), metalness: 1, roughness: 0.3, clearcoat: 0.4 })],
    ["caliper-paint", m({ color: c("#9c7448"), metalness: 0.7, roughness: 0.34, clearcoat: 1, clearcoatRoughness: 0.12 })],
    ["pad-friction", m({ color: c("#2d2925"), metalness: 0, roughness: 1, roughnessMap: friction })],
    // hub, bearing
    ["bearing-steel", m({ color: c("#d8dbde"), metalness: 1, roughness: 0.1 })],
    ["brass", m({ color: c("#c9a04f"), metalness: 1, roughness: 0.28 })],
    // knuckle and arms: cast and forged aluminium with machined faces
    ["aluminium-cast", m({ color: c("#b9bdc2"), metalness: 0.9, roughness: 1, roughnessMap: cast })],
    ["aluminium-machined", m({ color: c("#e1e4e7"), metalness: 1, roughness: 0.18 })],
    ["aluminium-forged", m({ color: c("#c9cdd1"), metalness: 1, roughness: 1, roughnessMap: forged })],
    // damper, spring, plastics
    ["plastic-black", m({ color: c("#1f2023"), metalness: 0, roughness: 0.5 })],
    ["plastic-reservoir", m({ color: c("#ddd5bd"), metalness: 0, roughness: 0.35, clearcoat: 0.4, clearcoatRoughness: 0.2 })],
    ["spring-paint", m({ color: c("#2c3035"), metalness: 0.4, roughness: 0.42, clearcoat: 0.6, clearcoatRoughness: 0.2 })],
    ["damper-paint", m({ color: c("#23262b"), metalness: 0.5, roughness: 0.3, clearcoat: 0.8 })],
    ["polyurethane", m({ color: c("#b88a2f"), metalness: 0, roughness: 0.55, sheen: 0.3, sheenColor: c("#e0b866") })],
    // drive units: enamelled copper windings and busbars, grey laminations, nickel-plated magnets,
    // solder-masked boards, the moulded power module, the orange high-voltage connector
    ["copper", m({ color: c("#b8734a"), metalness: 1, roughness: 0.32, clearcoat: 0.5, clearcoatRoughness: 0.2 })],
    ["electrical-steel", m({ color: c("#5a5e66"), metalness: 0.9, roughness: 0.42 })],
    ["magnet", m({ color: c("#a9adb3"), metalness: 1, roughness: 0.22 })],
    ["pcb", m({ color: c("#1f3b2f"), metalness: 0.1, roughness: 0.4, clearcoat: 0.8, clearcoatRoughness: 0.15 })],
    ["module-grey", m({ color: c("#8b8e93"), metalness: 0, roughness: 0.6 })],
    ["hv-orange", m({ color: c("#d46a1f"), metalness: 0.05, roughness: 0.45, clearcoat: 0.3 })],
    // battery: cells in a dark blue insulating wrap
    ["battery-cell", m({ color: c("#2c3a52"), metalness: 0.1, roughness: 0.45, clearcoat: 0.4, clearcoatRoughness: 0.3 })],
  ]);
  for (const [name, material] of library) material.name = name; // makes inspection and debugging easier
  return library;
}

/** The exterior lamps lit or unlit: the lit elements' glow, restrained so there is no bloom-like flare. */
export function setExteriorLights(library: Map<string, THREE.MeshPhysicalMaterial>, on: boolean) {
  library.get("lamp")!.emissiveIntensity = on ? 4.0 : 0.04;
  library.get("tail-lamp")!.emissiveIntensity = on ? 3.5 : 0.05;
}

/** Swap the placeholder materials on a loaded object for the studio materials of the same name. */
export function applyStudioMaterials(object: THREE.Object3D, library: Map<string, THREE.MeshPhysicalMaterial>) {
  object.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const swap = (mat: THREE.Material) => library.get(mat.name) ?? mat;
    mesh.material = Array.isArray(mesh.material) ? mesh.material.map(swap) : swap(mesh.material);
  });
}
