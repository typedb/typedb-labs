// A "focus" is a semantic perspective on the 3D model: the components TypeDB returns for one question
// (an assembly's contents, a system's members, a failure's impact) are highlighted and the rest is ghosted.
// Highlight levels (colours in src/theme.ts): "primary" (in the assembly, system or type; a function lost;
// essential to the part), "secondary" (backed up or merely supporting) and "degraded" (functions only degraded).

import { useCallback, useRef, useState } from "react";
import { queryRecord, SemanticError, semantic, type AssemblyDetails, type Impact, type QueryRecord, type QuestionResult, type Requirement,
  type SystemDetails, type TypeDetail } from "../semantic/api";

export type FocusKind = "assembly" | "system" | "impact" | "requirements" | "type" | "question";
export type Level = "primary" | "secondary" | "degraded";

export interface FocusRequest {
  kind: FocusKind;
  /** the assembly, system or component id the question is about */
  key: string;
  /** the selected component the question was asked from */
  anchor: string;
}

export interface Focus extends FocusRequest, QueryRecord {
  title: string;
  /** component id -> highlight level; components not listed are ghosted */
  ids: Map<string, Level>;
  impact?: Impact;
  requirements?: Requirement[];
  /** the answer behind an assembly or system focus, so views can show it without asking again */
  assembly?: AssemblyDetails;
  system?: SystemDetails;
  typeDetail?: TypeDetail;
  question?: QuestionResult;
}

export type FocusError = { request: FocusRequest; kind: SemanticError["kind"]; message: string };

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** Highlight levels for a set of (component, level) entries: a component listed as primary anywhere is primary. */
function levels(entries: [string, Level][]) {
  const map = new Map<string, Level>();
  for (const [id, level] of entries) if (map.get(id) !== "primary") map.set(id, level);
  return map;
}

export function useFocus() {
  const [focus, setFocusState] = useState<Focus | null>(null);
  const [error, setError] = useState<FocusError | null>(null);
  /** the question being asked, while it runs (some take seconds) */
  const [pending, setPending] = useState<FocusRequest | null>(null);
  // Only the latest request may set the focus; an older or cancelled one is aborted and its answer ignored.
  const inFlight = useRef<AbortController | null>(null);

  const request = useCallback(async (req: FocusRequest) => {
    // Asking the same question again turns the perspective off.
    if (focus && focus.kind === req.kind && focus.key === req.key) {
      setFocusState(null);
      return;
    }
    setError(null);
    setPending(req);
    inFlight.current?.abort();
    const controller = new AbortController();
    inFlight.current = controller;
    const signal = controller.signal;
    const setFocus = (f: Focus) => { if (!signal.aborted) setFocusState(f); };
    try {
      if (req.kind === "assembly") {
        const answer = await semantic.assembly(req.key, signal);
        const data = answer.data;
        const ids = levels(data["all-component-ids"].map((id) => [id, "primary"]));
        setFocus({ ...req, title: `${data.name}: ${plural(ids.size, "component")}`, ids, ...queryRecord(answer), assembly: data });
      } else if (req.kind === "system") {
        const answer = await semantic.system(req.key, signal);
        const data = answer.data;
        const ids = levels(data.components.map((c) => [c.id, "primary"]));
        setFocus({ ...req, title: `${data.name}: ${plural(ids.size, "component")}`, ids, ...queryRecord(answer), system: data });
      } else if (req.kind === "type") {
        const answer = await semantic.type(req.key, signal);
        const data = answer.data;
        const ids = levels(data.instances.map((i) => [i.id, "primary"]));
        setFocus({ ...req, title: `Every ${data.type.replace(/-/g, " ")}: ${plural(ids.size, "component")}`, ids, ...queryRecord(answer),
          typeDetail: data });
      } else if (req.kind === "question") {
        const answer = await semantic.question(req.key, signal);
        const data = answer.data;
        const ids = levels(data.highlight.map((id) => [id, "primary"]));
        setFocus({ ...req, title: data.summary, ids, ...queryRecord(answer), question: data });
      } else if (req.kind === "impact") {
        const answer = await semantic.impact(req.key, signal);
        const data = answer.data;
        // Primary: the part loses at least one function. Degraded: its functions are only degraded.
        const ids = levels([[req.key, "primary"], ...data.components.map((c): [string, Level] => [c.id, c.lost.length ? "primary" : "degraded"])]);
        const losing = data.components.filter((c) => c.lost.length).length;
        const title = data.components.length === 0
          ? "If it fails: no other part is affected"
          : `If it fails: ${plural(losing, "part")} lose a function, ${data.components.length - losing} only degraded`;
        setFocus({ ...req, title, ids, ...queryRecord(answer), impact: data });
      } else {
        const answer = await semantic.requirements(req.key, signal);
        const data = answer.data;
        const ids = levels([[req.key, "primary"], ...data.required.map((x): [string, Level] =>
          [x.id, x.role === "essential" ? "primary" : "secondary"])]);
        const essential = data.required.filter((r) => r.role === "essential").length;
        setFocus({ ...req, title: `To work it needs ${plural(data.required.length, "function")} (${essential} essential)`, ids, ...queryRecord(answer),
          requirements: data.required });
      }
    } catch (e) {
      if (signal.aborted) return;                       // cancelled or replaced: not an error
      setFocusState(null);
      if (e instanceof SemanticError) setError({ request: req, kind: e.kind, message: e.message });
      else throw e;
    } finally {
      setPending((p) => (p === req ? null : p));
    }
  }, [focus]);

  /** Stop waiting for the running request (the screen stays as it was). */
  const cancel = useCallback(() => {
    inFlight.current?.abort();
    setPending(null);
  }, []);

  const clear = useCallback(() => { inFlight.current?.abort(); setPending(null); setFocusState(null); setError(null); }, []);
  return { focus, error, pending, request, cancel, clear };
}
