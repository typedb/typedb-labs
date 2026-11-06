// The exterior lamps on or off (D1.4), outside React so the materials can follow it without re-rendering.
// ?lights=on starts with them on.

import { useSyncExternalStore } from "react";

type Listener = () => void;
const listeners = new Set<Listener>();
const params = typeof window === "undefined" ? new URLSearchParams() : new URLSearchParams(window.location.search);

export const exteriorLights = {
  on: params.get("lights") === "on",
  set(on: boolean) {
    this.on = on;
    for (const l of listeners) l();
  },
  subscribe(l: Listener) {
    listeners.add(l);
    return () => listeners.delete(l);
  },
};

export const useExteriorLights = () => useSyncExternalStore((l) => exteriorLights.subscribe(l), () => exteriorLights.on);
