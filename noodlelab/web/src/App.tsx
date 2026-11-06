import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Stage } from "./scene/Stage";
import { semantic, TYPEDB_STATUS_EVENT } from "./semantic/api";
import { useAnswer } from "./semantic/useAnswer";
import { ComponentPanel } from "./ui/ComponentPanel";
import { Explore, type ExploreTab } from "./ui/Explore";
import { ModelDownload } from "./ui/ModelDownload";
import { useFocus } from "./ui/focus";
import { Scrubber } from "./ui/Scrubber";
import { TypeQLOverlay, type OverlayContext } from "./ui/TypeQLOverlay";
import { panelParts, typeqlStartsCollapsed } from "./ui/transition";

function usePrefersReducedMotion() {
  const query = "(prefers-reduced-motion: reduce)";
  const [reduced, setReduced] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const onChange = () => setReduced(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return reduced;
}

/** Whether the semantic layer (API and TypeDB) answers: checked on load, every 20 seconds and with every answer. */
function useTypeDBStatus() {
  const [status, setStatus] = useState<"checking" | "available" | "unavailable">("checking");
  useEffect(() => {
    let live = true;
    const check = () => semantic.health().then((ok) => live && setStatus(ok ? "available" : "unavailable"));
    check();
    const timer = setInterval(check, 20_000);
    const onAnswer = (e: Event) => setStatus((e as CustomEvent<boolean>).detail ? "available" : "unavailable");
    window.addEventListener(TYPEDB_STATUS_EVENT, onAnswer);
    return () => {
      live = false;
      clearInterval(timer);
      window.removeEventListener(TYPEDB_STATUS_EVENT, onAnswer);
    };
  }, []);
  return status;
}

/** Where the side panels end (CSS pixels): the explorer's right edge and the part panel's distance from the window's
 * right edge, measured from the panels themselves, so the camera always frames the space actually free. */
function usePanelEdges() {
  const [edges, setEdges] = useState({ left: 354, right: 384 });
  useEffect(() => {
    const measure = () => {
      const explore = document.querySelector(".explore")?.getBoundingClientRect();
      const panel = document.querySelector(".panel:not(.minimised)")?.getBoundingClientRect();
      setEdges((e) => {
        const next = { left: explore ? Math.round(explore.right) : e.left, right: panel ? Math.round(window.innerWidth - panel.left) : e.right };
        return next.left === e.left && next.right === e.right ? e : next;
      });
    };
    const observer = new MutationObserver(measure);
    observer.observe(document.querySelector("main") ?? document.body, { childList: true });
    window.addEventListener("resize", measure);
    measure();
    return () => { observer.disconnect(); window.removeEventListener("resize", measure); };
  }, []);
  return edges;
}

export function App() {
  const [exploring, setExploring] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const reducedMotion = usePrefersReducedMotion();
  const typedb = useTypeDBStatus();
  const { focus, error: focusError, pending, request, cancel, clear } = useFocus();
  const [exploreOpen, setExploreOpen] = useState(() => window.innerWidth > 1100);
  const [exploreTab, setExploreTab] = useState<ExploreTab>("systems");
  // The TypeQL overlay describes whatever was chosen last: the focus (system, assembly, type...) or a single part.
  const [lastChoice, setLastChoice] = useState<"focus" | "component">("focus");
  // The TypeQL overlay is open by default on every desktop screen (TypeQL is central to the demonstrator); only the
  // user collapses it. (Phones, out of scope for the desktop layout, keep it collapsed at first.)
  const [typeqlCollapsed, setTypeqlCollapsed] = useState(() => typeqlStartsCollapsed(window.innerWidth));
  const [panelMinimised, setPanelMinimised] = useState(false);
  // The part panel on screen keeps its content while a newly selected part loads out of sight, then swaps (the 3D
  // highlight follows the new selection at once). A newer selection replaces a pending one.
  const [shownPart, setShownPart] = useState<string | null>(null);
  useEffect(() => { if (selectedId === null) setShownPart(null); }, [selectedId]);
  const parts = panelParts(selectedId, shownPart);
  const partReady = useCallback(() => setShownPart(selectedId), [selectedId]);
  const edges = usePanelEdges();
  // Where the overlay ends, so the camera frames the vehicle beside or below it.
  const [overlayEdge, setOverlayEdge] = useState<{ right: number; bottom: number } | null>(null);
  const onOverlayEdge = useCallback((edge: { right: number; bottom: number } | null) => setOverlayEdge((e) =>
    e && edge && Math.abs(e.right - edge.right) < 1 && Math.abs(e.bottom - edge.bottom) < 1 ? e : edge), []);
  const select = useCallback((id: string | null) => {
    setSelectedId(id);
    if (id) setLastChoice("component");
  }, []);
  useEffect(() => { if (focus) setLastChoice("focus"); }, [focus]);
  // The part under the pointer, named from TypeDB's component list (asked once, when exploring starts).
  const [hovered, setHovered] = useState<string | null>(null);
  const listing = useAnswer(exploring ? "components" : null, (s) => semantic.components(s));
  const names = listing.state?.status === "ok" ? listing.state.answer.data : null;
  const hoverName = hovered && names ? names.find((c) => c.id === hovered)?.name ?? null : null;
  const tip = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const move = (e: PointerEvent) => { if (tip.current) tip.current.style.transform = `translate(${e.clientX + 14}px, ${e.clientY + 16}px)`; };
    window.addEventListener("pointermove", move);
    return () => window.removeEventListener("pointermove", move);
  }, []);
  // Stable props for the 3D stage, so the scene doesn't re-render when unrelated parts of the page change.
  const hasOverlay = exploring && !typeqlCollapsed && (selectedId !== null || focus !== null);
  const insets = useMemo(() => ({ left: exploring && exploreOpen ? edges.left : 0,
    right: exploring && selectedId && !panelMinimised ? edges.right : 0,
    overlay: hasOverlay ? overlayEdge : null }), [exploring, exploreOpen, selectedId, panelMinimised, edges, hasOverlay, overlayEdge]);
  const overlay: OverlayContext | null = lastChoice === "component" && selectedId ? { kind: "component", id: selectedId }
    : focus ? { kind: "focus", focus } : selectedId ? { kind: "component", id: selectedId } : null;
  // A system or assembly chosen anywhere (also from the component panel) opens its view in the explorer.
  useEffect(() => {
    const tabs: Partial<Record<string, ExploreTab>> = { system: "systems", assembly: "assemblies", type: "types", question: "questions" };
    const tab = focus ? tabs[focus.kind] : undefined;
    if (tab) {
      setExploreTab(tab);
      setExploreOpen(true);
    }
  }, [focus]);
  // Development only: select a part from the console, for repeatable checks (see CLAUDE.md).
  useEffect(() => {
    if (import.meta.env.DEV) Object.assign(window, { __select: (id: string | null) => { setExploring(true); setSelectedId(id); if (id) setLastChoice("component"); } });
  }, []);

  return (
    <main className={`app${exploring ? " exploring" : ""}${exploring && exploreOpen ? " explore-is-open" : ""}${exploring && selectedId ? " panel-is-open" : ""}`}>
      <div className="canvas">
        <Stage exploring={exploring} reducedMotion={reducedMotion} selectedId={selectedId}
          highlight={focus?.ids ?? null} onSelect={select} onHover={setHovered}
          insets={insets} />
      </div>

      <header className="brand">
        <span className="brand-mark" aria-hidden />
        <span>Noodlelab Visual Explorer</span>
        <span className="brand-sep">·</span>
        <span className={`typedb-status ${typedb}`} role="status">
          TypeDB {typedb === "available" ? "connected" : typedb === "unavailable" ? "unavailable" : "…"}
        </span>
      </header>

      <section className="intro" aria-hidden={exploring}>
        <h1>A vehicle is more than the sum of its parts.</h1>
        <p>Explore the structure of a complex system, powered by TypeDB.</p>
        <button type="button" onClick={() => setExploring(true)} tabIndex={exploring ? -1 : 0}>
          Explore the vehicle
        </button>
      </section>

      {exploring && (focus || focusError) && (
        <div className={focusError ? "focus-bar error" : "focus-bar"} role="status">
          <span>{focusError ? focusError.message : focus!.title}</span>
          {focus && (focus.kind === "impact" || focus.kind === "requirements") && (
            <span className="focus-key">
              <i className="primary" />{focus.kind === "impact" ? "loses a function" : "essential"}
              <i className={focus.kind === "impact" ? "degraded" : "secondary"} />{focus.kind === "impact" ? "only degraded" : "backed up or supporting"}
            </span>
          )}
          <button type="button" className="link" onClick={clear}>{focusError ? "Dismiss" : "Clear"}</button>
        </div>
      )}

      {exploring && (
        <footer className="controls">
          <Scrubber reducedMotion={reducedMotion} />
          <p className="hint">Drag to orbit · scroll to zoom · right-drag to pan · click a part</p>
        </footer>
      )}

      {exploring && exploreOpen && (
        <Explore pending={pending} onCancel={cancel} tab={exploreTab} onTab={setExploreTab} focus={focus} onFocus={request} onSelect={select}
          onClose={() => setExploreOpen(false)} />
      )}
      {exploring && !exploreOpen && (
        <button type="button" className="explore-open" onClick={() => setExploreOpen(true)}>Explore TypeDB ›</button>
      )}

      {exploring && parts.map(({ id: part, state }) => (
        <ComponentPanel key={part} id={part} focus={focus} onSelect={select} onFocus={request}
          minimised={panelMinimised} onMinimise={setPanelMinimised}
          state={state}
          onReady={part === selectedId ? partReady : undefined}
          onClose={() => setSelectedId(null)} />
      ))}

      {exploring && <TypeQLOverlay context={overlay} collapsed={typeqlCollapsed} onCollapse={setTypeqlCollapsed}
        onSlot={onOverlayEdge} />}

      <div ref={tip} className={hoverName && hovered !== selectedId ? "hover-tip shown" : "hover-tip"} aria-hidden>
        {hoverName}{hoverName && <span> · click for its TypeDB details</span>}
      </div>

      {exploring && <ModelDownload />}

      <p className="disclaimer">Original concept vehicle for demonstration. Not a production model.</p>
    </main>
  );
}
