// The semantic browser: TypeDB's model of the vehicle, explored without selecting a part first.
// Every list and detail here is a TypeDB answer; choosing an item highlights it in 3D (a "focus"), and every
// part named here opens its component panel. The TypeQL behind each view is one click away.

import { useEffect, useRef, useState, type ReactNode } from "react";
import { semantic, type AssemblyNode, type QuestionMeta, type SystemSummary, type TypeNode } from "../semantic/api";
import { useAnswer, type AnswerState } from "../semantic/useAnswer";
import type { Focus, FocusRequest } from "./focus";
import { words } from "./format";
import { formatMs, QueryViewer } from "./QueryViewer";

export type ExploreTab = "systems" | "assemblies" | "types" | "questions";

interface Props {
  pending: FocusRequest | null;
  onCancel: () => void;
  tab: ExploreTab;
  onTab: (tab: ExploreTab) => void;
  focus: Focus | null;
  onFocus: (request: FocusRequest) => void;
  onSelect: (id: string) => void;
  onClose: () => void;
}

const TABS: [ExploreTab, string][] = [["systems", "Systems"], ["assemblies", "Assemblies"], ["types", "Types"], ["questions", "Questions"]];

export function Explore({ pending, onCancel, tab, onTab, focus, onFocus, onSelect, onClose }: Props) {
  // A newly chosen system, assembly or type shows its detail at the top: scroll there.
  const body = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (focus && focus.kind !== "question") body.current?.scrollTo({ top: 0, behavior: "smooth" });
  }, [focus]);
  return (
    <aside className="explore" aria-label="Explore the vehicle's structure in TypeDB">
      <div className="explore-head">
        <nav className="explore-tabs" role="tablist">
          {TABS.map(([key, label]) => (
            <button key={key} type="button" role="tab" aria-selected={tab === key} className={tab === key ? "active" : ""}
              onClick={() => onTab(key)}>{label}</button>
          ))}
        </nav>
        <button type="button" className="panel-close" onClick={onClose} aria-label="Close the explorer">×</button>
      </div>
      <div className="explore-body" ref={body}>
        {tab === "systems" && <Systems focus={focus} onFocus={onFocus} onSelect={onSelect} />}
        {tab === "assemblies" && <Assemblies focus={focus} onFocus={onFocus} onSelect={onSelect} />}
        {tab === "types" && <Types focus={focus} onFocus={onFocus} onSelect={onSelect} />}
        {tab === "questions" && <Questions pending={pending} onCancel={onCancel} focus={focus} onFocus={onFocus} />}
      </div>
    </aside>
  );
}

type Shared = Pick<Props, "focus" | "onFocus" | "onSelect">;

/** Shows loading and failure states for a list answer, or the list itself. */
function Loaded<T>({ state, retry, children }: { state: AnswerState<T> | null; retry: () => void; children: (data: T) => ReactNode }) {
  if (!state || state.status === "loading") return <p className="loading">Asking TypeDB…</p>;
  if (state.status !== "ok") {
    return (
      <div className="panel-state">
        <p>{state.status === "unavailable" ? "TypeDB unavailable. " : ""}{state.message}</p>
        <button type="button" className="chip" onClick={retry}>Try again</button>
      </div>
    );
  }
  return <>{children(state.answer.data)}</>;
}

// ---- Systems ----------------------------------------------------------------------------------------------

function Systems({ focus, onFocus, onSelect }: Shared) {
  const list = useAnswer("systems", (s) => semantic.systems(s));
  const current = focus?.kind === "system" ? focus : null;
  return (
    <>
      {current?.system
        ? <SystemDetail focus={current} all={list.state?.status === "ok" ? list.state.answer.data : []} onFocus={onFocus} onSelect={onSelect} />
        : <p className="explore-intro">What the vehicle does. A part can serve several systems. Choose one to see it in the vehicle.</p>}
      {current?.system && <h3 className="list-head">All systems</h3>}
      <Loaded state={list.state} retry={list.retry}>
        {(systems) => <SystemTree systems={systems} current={current?.key ?? null} onFocus={onFocus} />}
      </Loaded>
      <QueryViewer answers={[list.state?.status === "ok" ? list.state.answer : null]} label="TypeQL for the list" />
    </>
  );
}

function SystemTree({ systems, current, onFocus }: { systems: SystemSummary[]; current: string | null; onFocus: Shared["onFocus"] }) {
  const top = systems.filter((s) => !s.parent);
  const row = (s: SystemSummary, depth: number) => (
    <li key={s.id}>
      <button type="button" className={`tree-row depth-${depth}${current === s.id ? " active" : ""}`} title={s.description ?? undefined}
        onClick={() => onFocus({ kind: "system", key: s.id, anchor: "explore" })}>
        <span>{s.name}</span><span className="count">{s.total}</span>
      </button>
      {systems.some((c) => c.parent === s.id) && (
        <ul>{systems.filter((c) => c.parent === s.id).map((c) => row(c, depth + 1))}</ul>
      )}
    </li>
  );
  return <ul className="tree">{top.map((s) => row(s, 0))}</ul>;
}

function SystemDetail({ focus, all, onFocus, onSelect }: { focus: Focus; all: SystemSummary[] } & Pick<Shared, "onFocus" | "onSelect">) {
  const sys = focus.system!;
  // Parts that also serve a system outside this one (and its sub-systems): where functions meet.
  const inside = new Set([sys.id, ...all.filter((s) => s.parent === sys.id).map((s) => s.id)]);
  const shared = sys.components
    .map((c) => ({ ...c, others: c.systems.filter((s) => !inside.has(s.id)) }))
    .filter((c) => c.others.length > 0);
  return (
    <div className="detail detail-top">
      <h2>{sys.name}</h2>
      {sys.description && <p className="panel-description">{sys.description}</p>}
      {sys.subsystems.length > 0 && (
        <section>
          <h3>Sub-systems</h3>
          <div className="chips">{sys.subsystems.map((s) => (
            <button type="button" key={s.id} className="chip" onClick={() => onFocus({ kind: "system", key: s.id, anchor: "explore" })}>{s.name}</button>
          ))}</div>
        </section>
      )}
      {sys["control-loops"].length > 0 && (
        <section>
          <h3>Control loops</h3>
          <ul className="relations">{sys["control-loops"].map((l) => (
            <li key={l.name} title={l.description ?? undefined}>
              <button type="button" className="link" onClick={() => onSelect(l.controller)}>{l.name}</button>
              <span className="muted"> {l.sensors.length} sensors, {l.actuators.length} actuators</span>
            </li>
          ))}</ul>
        </section>
      )}
      {shared.length > 0 && (
        <section>
          <h3>Shared with other systems</h3>
          <ul className="relations">{shared.map((c) => (
            <li key={c.id}>
              <button type="button" className="link" onClick={() => onSelect(c.id)}>{c.name}</button>
              <span className="muted"> also {c.others.map((o) => o.name).join(", ")}</span>
            </li>
          ))}</ul>
        </section>
      )}
      <section>
        <h3>Parts ({sys.components.length})</h3>
        <PartList parts={sys.components} onSelect={onSelect} />
      </section>
      <QueryViewer answers={[focus]} />
    </div>
  );
}

function PartList({ parts, onSelect }: { parts: { id: string; name: string }[]; onSelect: (id: string) => void }) {
  return (
    <ul className="part-list">{parts.map((p) => (
      <li key={p.id}><button type="button" className="link" onClick={() => onSelect(p.id)}>{p.name}</button></li>
    ))}</ul>
  );
}

// ---- Assemblies ---------------------------------------------------------------------------------------------

function Assemblies({ focus, onFocus, onSelect }: Shared) {
  const tree = useAnswer("assemblies", (s) => semantic.assemblies(s));
  const current = focus?.kind === "assembly" ? focus : null;
  const [open, setOpen] = useState<Set<string>>(new Set(["vehicle"]));
  const toggle = (id: string) => setOpen((o) => { const n = new Set(o); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  return (
    <>
      {!current?.assembly && <p className="explore-intro">Where parts sit: the physical build, assembly inside assembly. Choose one to see it in the vehicle.</p>}
      {current?.assembly && (
        <div className="detail detail-top">
          <p className="panel-path">{[...current.assembly.parents].reverse().map((p) => p.name).join("  ›  ")}</p>
          <h2>{current.assembly.name}</h2>
          <p className="muted">{current.assembly["all-component-ids"].length} parts in total, {current.assembly.components.length} directly</p>
          {current.assembly.subassemblies.length > 0 && (
            <section>
              <h3>Sub-assemblies</h3>
              <div className="chips">{current.assembly.subassemblies.map((s) => (
                <button type="button" key={s.id} className="chip" onClick={() => { setOpen((o) => new Set([...o, current.key])); onFocus({ kind: "assembly", key: s.id, anchor: "explore" }); }}>{s.name}</button>
              ))}</div>
            </section>
          )}
          {current.assembly.components.length > 0 && (
            <section>
              <h3>Parts directly in it</h3>
              <PartList parts={current.assembly.components} onSelect={onSelect} />
            </section>
          )}
          <QueryViewer answers={[current]} />
        </div>
      )}
      {current?.assembly && <h3 className="list-head">The whole build</h3>}
      <Loaded state={tree.state} retry={tree.retry}>
        {(nodes) => {
          const row = (a: AssemblyNode, depth: number): ReactNode => {
            const children = nodes.filter((c) => c.parent === a.id);
            return (
              <li key={a.id}>
                <div className="tree-line">
                  {children.length > 0
                    ? <button type="button" className="tree-twist" aria-label={open.has(a.id) ? "Collapse" : "Expand"} onClick={() => toggle(a.id)}>{open.has(a.id) ? "▾" : "▸"}</button>
                    : <span className="tree-twist" />}
                  <button type="button" className={`tree-row depth-${depth}${current?.key === a.id ? " active" : ""}`}
                    onClick={() => onFocus({ kind: "assembly", key: a.id, anchor: "explore" })}>
                    <span>{a.name}</span><span className="count">{a.total}</span>
                  </button>
                </div>
                {children.length > 0 && open.has(a.id) && <ul>{children.map((c) => row(c, depth + 1))}</ul>}
              </li>
            );
          };
          return <ul className="tree">{nodes.filter((a) => !a.parent).map((a) => row(a, 0))}</ul>;
        }}
      </Loaded>
      <QueryViewer answers={[tree.state?.status === "ok" ? tree.state.answer : null]} label="TypeQL for the tree" />
    </>
  );
}

// ---- Types --------------------------------------------------------------------------------------------------

function Types({ focus, onFocus, onSelect }: Shared) {
  const tree = useAnswer("types", (s) => semantic.types(s));
  const current = focus?.kind === "type" ? focus : null;
  const detail = current?.typeDetail;
  return (
    <>
      {detail ? (
        <div className="detail detail-top">
          <p className="panel-path">{[...detail.supertypes].reverse().map(words).join("  ›  ")}</p>
          <h2>{words(detail.type)}</h2>
          <p className="muted">
            {detail.instances.length} {detail.instances.length === 1 ? "part" : "parts"}
            {new Set(detail.instances.map((i) => i.type)).size > 1 ? ` of ${new Set(detail.instances.map((i) => i.type)).size} types, found with one query` : ""}
          </p>
          <section>
            <h3>Schema: what it can own</h3>
            <div className="chips schema">{detail.owns.map((a) => <span key={a} className="chip static">{a}</span>)}</div>
          </section>
          <section>
            <h3>Schema: roles it can play</h3>
            <div className="chips schema">{detail.plays.map((r) => <span key={r} className="chip static" title={r}>{r.replace(":", " › ")}</span>)}</div>
          </section>
          <section>
            <h3>Parts</h3>
            {[...new Set(detail.instances.map((i) => i.type))].map((t) => (
              <div key={t} className="type-group">
                <p className="type-label">{words(t)}</p>
                <PartList parts={detail.instances.filter((i) => i.type === t)} onSelect={onSelect} />
              </div>
            ))}
          </section>
          <QueryViewer answers={[current]} />
        </div>
      ) : (
        <p className="explore-intro">What kind of thing each part is. Choosing a type includes all its subtypes: one query finds every sensor, whatever kind.</p>
      )}
      {detail && <h3 className="list-head">All types</h3>}
      <Loaded state={tree.state} retry={tree.retry}>
        {(types) => {
          const row = (t: TypeNode, depth: number): ReactNode => (
            <li key={t.type}>
              <button type="button" className={`tree-row depth-${depth}${current?.key === t.type ? " active" : ""}`}
                onClick={() => onFocus({ kind: "type", key: t.type, anchor: "explore" })}>
                <span>{words(t.type)}</span><span className="count">{t.total}</span>
              </button>
              {types.some((c) => c.parent === t.type) && <ul>{types.filter((c) => c.parent === t.type).map((c) => row(c, depth + 1))}</ul>}
            </li>
          );
          return <ul className="tree">{types.filter((t) => !t.parent).map((t) => row(t, 0))}</ul>;
        }}
      </Loaded>
      <QueryViewer answers={[tree.state?.status === "ok" ? tree.state.answer : null]} label="TypeQL for the hierarchy" />
    </>
  );
}

// ---- Questions ------------------------------------------------------------------------------------------------

function Questions({ pending, onCancel, focus, onFocus }: Omit<Shared, "onSelect"> & { pending: FocusRequest | null; onCancel: () => void }) {
  const list = useAnswer("questions", (s) => semantic.questions(s));
  const current = focus?.kind === "question" ? focus : null;
  const result = current?.question;
  const running = pending?.kind === "question" ? pending.key : null;
  const ms = current ? current["timings-ms"].reduce((a, b) => a + b, 0) : 0;
  return (
    <>
      <p className="explore-intro">Questions that need more than looking up a part: totals, every part of a kind, chains of
        dependencies, and failure reasoning across the whole vehicle. Each runs live in TypeDB.</p>
      <Loaded state={list.state} retry={list.retry}>
        {(questions) => (
          <ul className="questions">
            {questions.map((q: QuestionMeta) => {
              const open = result?.id === q.id;
              return (
                <li key={q.id} className={open ? "open" : ""}>
                  <button type="button" className="question" onClick={() => onFocus({ kind: "question", key: q.id, anchor: "explore" })}>
                    <span className="question-tag">{q.capability}</span>
                    <span className="question-title">{q.title}</span>
                  </button>
                  {running === q.id && (
                    <p className="question-running"><span className="loading">Asking TypeDB…</span>
                      <button type="button" className="link" onClick={onCancel}>Cancel</button></p>
                  )}
                  {open && result && (
                    <div className="answer" ref={(el) => el?.parentElement?.scrollIntoView({ block: "nearest", behavior: "smooth" })}>
                      <p className="answer-summary">{result.summary}</p>
                      <p className="muted answer-how">{result.explanation} <span className="answer-time">{formatMs(ms)} in TypeDB</span></p>
                      {result.rows.length > 0 && (
                        <table className="answer-table">
                          <thead><tr>{result.columns.map((c) => <th key={c}>{c}</th>)}</tr></thead>
                          <tbody>{result.rows.map((r, i) => <tr key={i}>{r.map((v, j) => <td key={j}>{typeof v === "number" ? Number(v.toFixed(2)).toLocaleString("en-GB") : v}</td>)}</tr>)}</tbody>
                        </table>
                      )}
                      {result.highlight.length > 0 && (
                        <p className="muted">{result.highlight.length} {result.highlight.length === 1 ? "part" : "parts"} highlighted in the vehicle; click one there to open it.</p>
                      )}
                      <QueryViewer answers={[current]} />
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Loaded>
    </>
  );
}
