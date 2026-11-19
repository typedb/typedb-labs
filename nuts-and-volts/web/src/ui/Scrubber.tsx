// Assembled ←→ Exploded control: a continuous slider plus a play button that runs the sequence
// forwards or backwards. With reduced motion, the button jumps straight to the other end.

import { exteriorLights, useExteriorLights } from "../scene/lights";
import { progress, usePlayDirection, useProgress } from "../scene/progress";

export function Scrubber({ reducedMotion }: { reducedMotion: boolean }) {
  const value = useProgress();
  const lights = useExteriorLights();
  const direction = usePlayDirection();
  const towardsExploded = direction === 1 || (direction === 0 && value < 0.5);
  const onPlay = () => {
    if (direction !== 0) return progress.set(progress.value); // pause
    const dir = value < 0.5 ? 1 : -1;
    if (reducedMotion) progress.set(dir > 0 ? 1 : 0);
    else progress.play(dir);
  };
  const label = direction !== 0 ? "Pause" : towardsExploded ? "Explode" : "Assemble";
  return (
    <div className="scrubber">
      <button type="button" className="scrub-play" onClick={onPlay} aria-label={label}>
        <span aria-hidden className={direction !== 0 ? "icon-pause" : towardsExploded ? "icon-out" : "icon-in"} />
        <span>{label}</span>
      </button>
      <span className="scrub-end">Assembled</span>
      <input
        type="range"
        min={0}
        max={1000}
        value={Math.round(value * 1000)}
        onChange={(e) => progress.set(Number(e.target.value) / 1000)}
        aria-label="Explosion: assembled to exploded"
        aria-valuetext={`${Math.round(value * 100)}% exploded`}
        style={{ "--fill": `${value * 100}%` } as React.CSSProperties}
      />
      <span className="scrub-end">Exploded</span>
      <button type="button" className="scrub-play scrub-lights" onClick={() => exteriorLights.set(!lights)} aria-pressed={lights}>
        <span aria-hidden className={lights ? "icon-lights on" : "icon-lights"} />
        <span>Lights {lights ? "on" : "off"}</span>
      </button>
    </div>
  );
}
