// The selected component, as TypeDB describes it: identity and type hierarchy, engineering properties, where it
// sits (assembly), what it does (systems), how it is joined and what it depends on. Every value comes from the
// semantic API; "TypeQL" shows the exact queries behind the panel.

import { useEffect } from "react";
import { semantic, type AffectedComponent, type Answer, type Dependency, type Impact, type Requirement } from "../semantic/api";
import { useAnswer, type AnswerState } from "../semantic/useAnswer";
import type { Focus, FocusRequest } from "./focus";
import { attributeLabel, attributeValue, connectionKind, words } from "./format";
import { QueryViewer } from "./QueryViewer";
import type { PanelState } from "./transition";

interface Props {
  id: string;
  focus: Focus | null;
  onSelect: (id: string) => void;
  onFocus: (request: FocusRequest) => void;
  onClose: () => void;
  /** minimised to a small tab at the right edge (the selection and its answers stay) */
  minimised: boolean;
  onMinimise: (minimised: boolean) => void;
  /** "pending": loading out of sight, to replace the panel on screen once ready; "stale": on screen while a newer
   * selection loads */
  state?: PanelState;
  /** called once every answer for this part has arrived (or one failed, so the failure can be shown) */
  onReady?: () => void;
}

export function ComponentPanel({ id, focus, onSelect, onFocus, onClose, minimised, onMinimise, state, onReady }: Props) {
  const details = useAnswer(id, (s) => semantic.component(id, s));
  const placement = useAnswer(id, (s) => semantic.assemblyOf(id, s));
  const systems = useAnswer(id, (s) => semantic.systemsOf(id, s));
  const relations = useAnswer(id, (s) => semantic.relationships(id, s));

  const states = [details.state, placement.state, systems.state, relations.state];
  const failed = states.find((s) => s && s.status !== "loading" && s.status !== "ok") as
    | { status: string; message: string } | undefined;
  const retry = () => [details, placement, systems, relations].forEach((a) => a.retry());

  const ready = states.every((s) => s && s.status !== "loading");
  useEffect(() => { if (ready) onReady?.(); }, [ready, onReady]);
  const extra = state ? ` ${state}` : "";

  const d = ok(details.state);
  const p = ok(placement.state);
  const sys = ok(systems.state);
  const r = ok(relations.state);

  if (minimised) {
    return (
      <aside className={`panel minimised${extra}`} aria-label="Component details from TypeDB (minimised)" aria-hidden={state === "pending"}>
        <button type="button" className="panel-restore" onClick={() => onMinimise(false)} title="Show the part's details">
          <span className="panel-restore-mark" aria-hidden>‹</span>
          <span className="panel-restore-name">{d ? d.data.name : id}</span>
        </button>
        <button type="button" className="panel-close" onClick={onClose} aria-label="Clear selection">×</button>
      </aside>
    );
  }
  return (
    <aside className={`panel${extra}`} aria-live={state ? undefined : "polite"} aria-label="Component details from TypeDB"
      aria-hidden={state === "pending"} aria-busy={state === "stale"}>
      {state === "stale" && <span className="panel-updating" aria-hidden />}
      <button type="button" className="panel-minimise" onClick={() => onMinimise(true)} aria-label="Minimise the part's details"
        title="Minimise (keeps the selection)">–</button>
      <button type="button" className="panel-close" onClick={onClose} aria-label="Clear selection">×</button>

      {failed?.status === "unavailable" ? (
        <Unavailable id={id} message={failed.message} onRetry={retry} />
      ) : failed ? (
        <div className="panel-state">
          <p className="panel-id">{id}</p>
          <p>{failed.message}</p>
          <button type="button" className="chip" onClick={retry}>Ask again</button>
        </div>
      ) : (
        <>
          <p className="panel-path">
            {p ? [...p.data.path].reverse().slice(1).map((a, i, all) => (
              <span key={a.id}>
                <button type="button" className="link" onClick={() => onFocus({ kind: "assembly", key: a.id, anchor: id })}>{a.name}</button>
                {i < all.length - 1 && <span className="sep">›</span>}
              </span>
            )) : <span className="loading">Asking TypeDB…</span>}
          </p>
          <h2>{d ? d.data.name : <span className="loading">Asking TypeDB…</span>}</h2>
          <p className="panel-id">{id}</p>
          {d && (
            <p className="panel-types" title="Type hierarchy in the TypeDB schema">
              {d.data.types.slice(0, -1).map((t, i) => (
                <span key={t}>{i > 0 && <span className="sep">⊂</span>}
                  <button type="button" className="link type-link" onClick={() => onFocus({ kind: "type", key: t, anchor: id })}>{words(t)}</button>
                </span>
              ))}
            </p>
          )}
          {d?.data.description && <p className="panel-description">{d.data.description}</p>}

          {d && d.data.properties.length > 0 && (
            <section>
              <h3>Engineering properties <span className="note">concept design targets</span></h3>
              <dl className="props">
                {d.data.properties.map((prop) => (
                  <div key={prop.attribute}>
                    <dt>{attributeLabel(prop.attribute)}</dt>
                    <dd>{attributeValue(prop.attribute, prop.value)}</dd>
                  </div>
                ))}
              </dl>
            </section>
          )}

          {sys && sys.data.length > 0 && (
            <section>
              <h3>Systems</h3>
              <div className="chips">
                {sys.data.map((s) => (
                  <button type="button" key={s.id} className={chipClass(focus, "system", s.id)} title={s.description ?? undefined}
                    onClick={() => onFocus({ kind: "system", key: s.id, anchor: id })}>
                    {s.parents.length > 0 && <span className="chip-parent">{s.parents[s.parents.length - 1].name} ›</span>} {s.name}
                  </button>
                ))}
              </div>
            </section>
          )}

          <section>
            <h3>Follow the dependencies</h3>
            <div className="chips">
              <button type="button" className={chipClass(focus, "impact", id)} onClick={() => onFocus({ kind: "impact", key: id, anchor: id })}>
                If this fails, what is affected?
              </button>
              <button type="button" className={chipClass(focus, "requirements", id)} onClick={() => onFocus({ kind: "requirements", key: id, anchor: id })}>
                What does it need to work?
              </button>
            </div>
            {focus && focus.anchor === id && focus.impact && <ImpactList impact={focus.impact} onSelect={onSelect} />}
            {focus && focus.anchor === id && focus.requirements && <RequirementList items={focus.requirements} onSelect={onSelect} />}
          </section>

          {r && (
            <>
              <DependencyList title="Needs" items={r.data.needs} side="needs" onSelect={onSelect} />
              <DependencyList title="Needed by" items={r.data["needed-by"]} side="needed-by" onSelect={onSelect} />
              {r.data.connections.length > 0 && (
                <section>
                  <h3>Connections</h3>
                  <ul className="relations">
                    {r.data.connections.map((c, i) => (
                      <li key={i}>
                        <span className="tag">{connectionKind(c.kind)}</span>
                        <button type="button" className="link" onClick={() => onSelect(c.other)}>{c["other-name"]}</button>
                        <span className="muted"> {Object.entries(c.details).filter(([k]) => k !== "description").map(([, v]) => v).join(", ")}</span>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
              {r.data["control-loops"].length > 0 && (
                <section>
                  <h3>Control loops</h3>
                  <ul className="relations">
                    {r.data["control-loops"].map((loop) => (
                      <li key={loop.name} title={loop.description ?? undefined}>
                        <span className="tag">{loop.role}</span>
                        <button type="button" className="link" onClick={() => onFocus({ kind: "system", key: loop.system, anchor: id })}>{loop.name}</button>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
            </>
          )}

          <QueryViewer answers={[d, p, sys, r, focus && focus.anchor === id ? focus : null]} />
        </>
      )}
    </aside>
  );
}

function ok<T>(state: AnswerState<T> | null): Answer<T> | null {
  return state?.status === "ok" ? state.answer : null;
}

function chipClass(focus: Focus | null, kind: string, key: string) {
  return focus && focus.kind === kind && focus.key === key ? "chip active" : "chip";
}

/** Dependencies, function to function. "Needs": this part's function <- the other part's function.
 * "Needed by": the other part's function <- this part's function. */
function DependencyList({ title, items, side, onSelect }: { title: string; items: Dependency[]; side: "needs" | "needed-by";
  onSelect: (id: string) => void }) {
  if (items.length === 0) return null;
  return (
    <section>
      <h3>{title}</h3>
      <ul className="relations">
        {items.map((d) => (
          <li key={`${d.id}-${d.function}-${d.needs}`} title={[d.description, ...d.fallback.map((f) => `Fallback: ${f.name}`)].filter(Boolean).join(" · ") || undefined}>
            <span className="tag" title={`${d.family} dependency`}>{d.kind}</span>
            <button type="button" className="link" onClick={() => onSelect(d.id)}>{d.name}</button>
            <span className="muted">
              {side === "needs" ? ` ${d.needs} → ${d.function}` : ` ${d.needs} → its ${d.function}`}
              {d.loss === "degraded" ? " (degrades only)" : d.fallback.length ? ` (backup: ${d.fallback.map((f) => f.name).join(", ")})` : ""}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** A failure, function by function: the failed part loses everything; other parts usually lose or degrade only
 * some of their functions and keep the rest. */
function ImpactList({ impact, onSelect }: { impact: Impact; onSelect: (id: string) => void }) {
  const { failed, components, fallbacks } = impact;
  const losing = components.filter((c) => c.lost.length);
  const degraded = components.filter((c) => !c.lost.length);
  const row = (c: AffectedComponent) => (
    <li key={c.id} className="affected">
      <button type="button" className="link" onClick={() => onSelect(c.id)}>{c.name}</button>
      {c.lost.length > 0 && <span className="fn lost"> loses {c.lost.join(", ")}</span>}
      {c.degraded.length > 0 && <span className="fn degraded"> {c.lost.length ? "; " : ""}degraded {c.degraded.join(", ")}</span>}
      {c.kept.length > 0 && <span className="fn kept">; keeps {c.kept.join(", ")}</span>}
    </li>
  );
  return (
    <div className="impact">
      <p className="muted failed-note">
        The failed part loses all its functions{failed.functions.length ? `: ${failed.functions.join(", ")}` : ""}. Other parts usually lose
        or degrade only some of theirs.
      </p>
      <Propulsion propulsion={impact.propulsion} />
      {!components.length && <p className="muted">No other part is affected, according to TypeDB.</p>}
      {losing.length > 0 && <><h4 className="lost">Lose a function ({losing.length})</h4><ol className="reached">{losing.map(row)}</ol></>}
      {degraded.length > 0 && <><h4 className="degraded">Only degraded ({degraded.length})</h4><ol className="reached">{degraded.map(row)}</ol></>}
      {fallbacks.length > 0 && (
        <><h4>Fallback in use</h4>
          <ul className="reached">
            {fallbacks.map((f) => (
              <li key={`${f.id}-${f.function}-${f.backup}`} title={f.description}>
                <button type="button" className="link" onClick={() => onSelect(f.backup)}>{f["backup-name"]}</button>
                <span className="muted"> keeps {f.name}: {f.function} (degraded)</span>
              </li>
            ))}
          </ul></>
      )}
    </div>
  );
}

/** Axle-level versus vehicle-level drive: one axle can stop driving while the other carries on. */
function Propulsion({ propulsion }: { propulsion: Impact["propulsion"] }) {
  const word = { lost: "no drive", reduced: "reduced drive", kept: "drives normally" } as const;
  const vehicle = { lost: "The vehicle cannot drive.", reduced: "The vehicle can still drive, with less traction or power.", kept: "Propulsion is unaffected." } as const;
  return (
    <div className="propulsion">
      <ul>
        {propulsion.axles.map((a) => (
          <li key={a.system} className={a.state}>{a.name}: {word[a.state]}</li>
        ))}
      </ul>
      <p className={`vehicle ${propulsion.vehicle}`}>{vehicle[propulsion.vehicle]}</p>
    </div>
  );
}

function RequirementList({ items, onSelect }: { items: Requirement[]; onSelect: (id: string) => void }) {
  const groups: [Requirement["role"], string][] = [["essential", "Essential"], ["backed up", "Backed up"], ["supporting", "Supporting (loss only degrades)"]];
  return (
    <div className="impact">
      {groups.map(([role, label]) => {
        const rows = items.filter((r) => r.role === role);
        return rows.length > 0 && (
          <div key={role}>
            <h4 className={role === "essential" ? "lost" : "degraded"}>{label} ({rows.length})</h4>
            <ol className="reached">
              {rows.map((x) => (
                <li key={`${x.id}-${x.function}`}>
                  <button type="button" className="link" onClick={() => onSelect(x.id)}>{x.name}</button>
                  <span className="muted"> {x.function} · {x.steps} {x.steps === 1 ? "step" : "steps"}</span>
                </li>
              ))}
            </ol>
          </div>
        );
      })}
    </div>
  );
}

function Unavailable({ id, message, onRetry }: { id: string; message: string; onRetry: () => void }) {
  return (
    <div className="panel-state unavailable" role="alert">
      <p className="panel-id">{id}</p>
      <h2>TypeDB unavailable</h2>
      <p>{message}</p>
      <button type="button" className="chip" onClick={onRetry}>Try again</button>
    </div>
  );
}
