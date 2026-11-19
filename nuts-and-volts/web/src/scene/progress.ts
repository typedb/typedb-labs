// Shared explosion progress (0 = assembled, 1 = exploded), outside React so the 3D scene can read it
// every frame without re-rendering the page. The slider subscribes to show the current value.

import { useSyncExternalStore } from "react";

const PLAY_SECONDS = 7; // a full assembled → exploded run when the play button is used

type Listener = () => void;

class ProgressStore {
  value = 0;
  /** -1 = playing towards assembled, +1 = towards exploded, 0 = still. */
  direction: -1 | 0 | 1 = 0;
  private listeners = new Set<Listener>();

  subscribe = (l: Listener) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };
  get = () => this.value;
  getDirection = () => this.direction;

  /** Jump to a value (the slider), stopping any playback. */
  set(v: number) {
    this.direction = 0;
    this.update(v);
  }
  play(direction: -1 | 1) {
    this.direction = direction;
    this.emit();
  }
  /** Called once per frame by the scene. */
  tick(dt: number) {
    if (!this.direction) return;
    const next = this.value + (this.direction * dt) / PLAY_SECONDS;
    if (next >= 1 || next <= 0) {
      this.direction = 0;
      this.update(next >= 1 ? 1 : 0);
    } else this.update(next);
  }
  private update(v: number) {
    this.value = Math.min(1, Math.max(0, v));
    this.emit();
  }
  private emit() {
    for (const l of this.listeners) l();
  }
}

export const progress = new ProgressStore();

export const useProgress = () => useSyncExternalStore(progress.subscribe, progress.get);
export const usePlayDirection = () => useSyncExternalStore(progress.subscribe, progress.getDirection);
