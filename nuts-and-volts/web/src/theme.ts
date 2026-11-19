// The interface's colours and highlight strengths, in one place. The stylesheet reads them as CSS variables
// (applied at start-up by applyTheme) and the 3D scene imports them directly, so nothing else defines a colour
// for the semantic layer. Neutral and material colours live with the materials (vehicle/studioMaterials.ts).

/** "#A78BFA" -> "167, 139, 250", for rgba() in CSS */
const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(", ");

export const theme = {
  /** Primary accent: selection, system / assembly / type highlights, lost functions, active controls. */
  accent: "#A78BFA",
  /** Secondary accent: supporting highlights (backed up or merely supporting a function), soft UI states. */
  accentSoft: "#D6B5FF",
  /** Degraded functionality, and warnings such as "TypeDB unavailable". */
  degraded: "#E0A85A",

  /** 3D highlighting: how strongly each kind of highlighted part glows, and how visible everything else stays. */
  highlight: {
    selectedGlow: 0.3,
    primaryGlow: 0.2,
    secondaryGlow: 0.16,
    degradedGlow: 0.24,
    /** opacity of parts outside a highlighted set (0 = invisible) */
    ghostOpacity: 0.11,
  },
} as const;

/** Publish the colours as CSS variables (--accent, --accent-rgb, --accent-soft, --degraded, --degraded-rgb). */
export function applyTheme(root: HTMLElement = document.documentElement) {
  root.style.setProperty("--accent", theme.accent);
  root.style.setProperty("--accent-rgb", rgb(theme.accent));
  root.style.setProperty("--accent-soft", theme.accentSoft);
  root.style.setProperty("--accent-soft-rgb", rgb(theme.accentSoft));
  root.style.setProperty("--degraded", theme.degraded);
  root.style.setProperty("--degraded-rgb", rgb(theme.degraded));
}
