// Display options and the adaptive rendering quality.
//
// Address options, for comparisons during development:
//   ?corner=procedural      use the original browser-built front-right corner instead of the Blender one
//   ?fx=off                 turn off ambient occlusion and the other post-processing effects
//   ?quality=high|medium|low  fix the rendering quality instead of choosing it automatically
//   ?ao=full|half           force the ambient-occlusion resolution (for comparing; normally automatic)
//
// Quality tiers:
//   high    higher-quality ambient occlusion (at half resolution above about 3 million pixels), 4x antialiasing,
//           up to 1.5x pixel density, full detail kept to almost twice the distance of medium
//   medium  half-resolution ambient occlusion, 2x antialiasing, up to 1.5x pixel density
//   low     no post-processing (the renderer's own antialiasing), 1x pixel density, earlier switch to light detail
// The starting tier comes from the device; if frames are too slow, the app steps down a tier.

import { useSyncExternalStore } from "react";

const params = typeof window === "undefined" ? new URLSearchParams() : new URLSearchParams(window.location.search);

export const settings = {
  /** the Blender-modelled parts (corner and drive units); ?corner=procedural shows the simple shapes instead */
  blenderCorner: params.get("corner") !== "procedural",
  effects: params.get("fx") !== "off",
  /** forced ambient-occlusion resolution, or null for automatic */
  ao: (params.get("ao") === "full" || params.get("ao") === "half" ? params.get("ao") : null) as "full" | "half" | null,
};

/** Above this many rendered pixels, the high tier computes ambient occlusion at half resolution. Measured on
 * the M2 Pro in Chrome at 1600x1000 (3.6 million pixels at 1.5x): half resolution saves 3-4 ms of GPU per frame
 * with no visible difference on the mechanical parts (docs/c3a/README.md). */
export const HALF_RES_AO_ABOVE = 3_000_000;

export type Tier = "high" | "medium" | "low";
const TIERS: Tier[] = ["high", "medium", "low"];

function initialTier(): { tier: Tier; fixed: boolean } {
  const asked = params.get("quality");
  if (asked === "high" || asked === "medium" || asked === "low") return { tier: asked, fixed: true };
  if (typeof navigator === "undefined") return { tier: "high", fixed: false };
  const phone = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && window.innerWidth < 900);
  const fewCores = (navigator.hardwareConcurrency ?? 8) <= 4;
  return { tier: phone ? "low" : fewCores ? "medium" : "high", fixed: false };
}

type Listener = () => void;
const listeners = new Set<Listener>();
const start = initialTier();

export const quality = {
  tier: start.tier,
  /** True when the address fixes the tier: no automatic changes. */
  fixed: start.fixed,
  /** Step down one tier (called when frames are consistently slow). */
  stepDown() {
    if (this.fixed) return;
    const next = TIERS[Math.min(TIERS.indexOf(this.tier) + 1, TIERS.length - 1)];
    if (next === this.tier) return;
    this.tier = next;
    for (const l of listeners) l();
  },
  subscribe(l: Listener) {
    listeners.add(l);
    return () => listeners.delete(l);
  },
};

export const useQualityTier = () => useSyncExternalStore((l) => quality.subscribe(l), () => quality.tier);
