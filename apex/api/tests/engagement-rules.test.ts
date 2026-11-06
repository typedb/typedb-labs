// The engagement rules on small made-up records (no TypeDB): every threshold boundary, each escalation
// trigger on its own, the authority profile, Unknown, not-yet-active, ties and the requests-only letters.

import { describe, expect, test } from "vitest";
import * as engagement from "../src/engagement.ts";
import type { Items, RaciRow, WorkstreamEvent } from "../src/queries.ts";
import { plusDays } from "./oracle.ts";

const AS_OF = "2026-10-26";
const P = engagement.policy();
const ETYPES = new Set(["engagement", "response", "meeting", "delivery", "decision"]);
const OTYPES = new Set(["outreach", "request", "notice"]);
const PERSON: engagement.Party = { code: "P1", name: "Pat", kind: "person", employer: "O1", authority: false };

const day = (n: number) => plusDays(AS_OF, n);

function item(code = "X1", kw: Record<string, unknown> = {}): Items {
  const base = { name: `Item ${code}`, type: "activity", status: "in-progress", due: day(30), planned_start: day(-60),
    actual_start: null, criticality: "medium", workstream: "WS1", progress: null };
  return { [code]: { ...base, ...kw } as Items[string] };
}

interface EventOptions {
  actor?: string;
  subject?: string;
  when?: number;
  to?: string[];
  attended?: string[];
  answered_by?: { code: string; when: string }[];
  due?: string | null;
  automated?: boolean | null;
  agenda?: { code: string; name: string }[];
}

function event(code: string, kind: string, o: EventOptions = {}): WorkstreamEvent {
  const actor = o.actor ?? "P1";
  const subject = o.subject ?? "X1";
  return { workstream: "WS1", code, type: kind, when: `${day(o.when ?? -1)}T10:00:00`, kind, summary: `${kind} ${code}`,
    actor: { code: actor, name: actor, type: "person", employer: null }, item: { code: subject, name: subject },
    recipients: (o.to ?? []).map((c) => ({ code: c, name: c })),
    attendees: (o.attended ?? []).map((c) => ({ code: c, name: c })),
    agenda: o.agenda ?? [], replies_to: [],
    answered_by: o.answered_by ?? [], response_due: o.due ?? null,
    automated: o.automated ?? null, previous_status: null, new_status: null };
}

interface RunOptions {
  letter?: string;
  raci?: RaciRow[];
  party?: engagement.Party;
  reviews?: { authority: string; clearance: string }[];
  floats?: Record<string, { float: number | null; deadline: string | null; by_deadline: Record<string, number> }>;
  employees?: string[];
}

function run(items: Items, events: WorkstreamEvent[], o: RunOptions = {}) {
  const party = o.party ?? PERSON;
  const raci = o.raci ?? Object.keys(items).map((c) => ({ holder: party.code, item: c, letter: o.letter ?? "R", via: null }));
  return engagement.assess(party, AS_OF, items, raci, events, ETYPES, o.reviews ?? [], o.floats ?? {}, o.employees ?? [], null, OTYPES);
}

const top = (result: engagement.Result) => result.assessments[0]!;

describe.each(["A", "R"])("inactivity thresholds for %s", (letter) => {
  test.each([[3, "green"], [4, "amber"], [7, "amber"], [8, "red"]] as [number, string][])("%i days is %s", (days, level) => {
    const other = event("E0", "delivery", { subject: "Y1", when: -1 }); // engaged elsewhere: never improves this item
    const r = run({ ...item(), ...item("Y1") }, [event("E1", "meeting", { when: -days }), other],
      { letter, raci: [{ holder: "P1", item: "X1", letter, via: null }] });
    expect([top(r).level, top(r).days]).toEqual([level, days]);
  });
});

test.each(["C", "I"])("Consulted and Informed are assessed on requests only (%s)", (letter) => {
  const r = run(item(), [event("E1", "meeting", { when: -200, attended: ["P1"] })], { letter });
  expect(top(r).category).toBe("requests-only");
  expect(r.level).toBe("none");
});

test("no engagement on the item counts from when it became active", () => {
  const items = { ...item("X1", { planned_start: day(-9) }), ...item("Y1") };
  const r = run(items, [event("E9", "delivery", { subject: "Y1", when: -1 })], { raci: [{ holder: "P1", item: "X1", letter: "R", via: null }] });
  const a = top(r);
  expect([a.level, a.days]).toEqual(["red", 9]);
  expect(a.reason).toContain("since it became active");
  expect(a.context).toContain("not counted"); // elsewhere: context only
});

test.each([[1, false], [0, true]] as [number, boolean][])("not-yet-active boundary: start in %i days", (start, active) => {
  const r = run(item("X1", { planned_start: day(start) }), [event("E1", "delivery", { subject: "Y1" })]);
  expect(top(r).level !== "not-yet-active").toBe(active);
});

test.each([[P.milestone_active_window_days + 1, false], [P.milestone_active_window_days, true]] as [number, boolean][])(
  "point items become active a window before they are due (%i days)", (due, active) => {
    const r = run(item("X1", { type: "milestone", planned_start: null, due: day(due) }), [event("E1", "delivery", { subject: "Y1" })]);
    expect(top(r).level !== "not-yet-active").toBe(active);
  });

test("no engagement anywhere is unknown, never red", () => {
  const r = run(item(), []);
  expect(r.level).toBe("unknown");
  expect(top(r).category).toBe("insufficient-information");
  expect(r.no_engagement_recorded).toBe(true);
});

test.each([[-1, "red", "overdue-response"], [0, "amber", "response-due"], [2, "amber", "response-due"], [3, "green", "response-awaited"]] as [number, string, string][])(
  "request reply-by boundaries (due in %i)", (dueIn, level, category) => {
    const r = run(item("X1", { status: "complete" }), [event("Q1", "request", { actor: "P9", to: ["P1"], due: day(dueIn), when: -5 })]);
    expect([top(r).level, top(r).category]).toEqual([level, category]);
  });

test("answered requests and unrelated org requests are not findings", () => {
  const answered = event("Q1", "request", { actor: "P9", to: ["P1"], due: day(-3), when: -5, answered_by: [{ code: "R1", when: day(-4) }] });
  const orgOtherItem = event("Q2", "request", { actor: "P9", to: ["O1"], due: day(-3), when: -5, subject: "Z9" });
  expect(run(item("X1", { status: "complete" }), [answered, orgOtherItem]).level).toBe("none");
});

test("an org request counts for a person assigned to that item", () => {
  const q = event("Q1", "request", { actor: "P9", to: ["O1"], due: day(-2), when: -5, subject: "X1" });
  expect(top(run(item(), [q, event("E1", "delivery", { when: -1 })])).category).toBe("overdue-response");
});

test("an overdue response outranks inactivity and recent engagement", () => {
  const q = event("Q1", "request", { actor: "P9", to: ["P1"], due: day(-1), when: -5, subject: "Y1" });
  const r = run({ ...item(), ...item("Y1") }, [q, event("E1", "meeting", { when: -20, attended: ["P1"] }), event("E2", "delivery", { subject: "Y1", when: 0 })],
    { raci: [{ holder: "P1", item: "X1", letter: "A", via: null }] });
  expect(r.assessments.slice(0, 2).map((a) => a.category)).toEqual(["overdue-response", "inactivity"]);
});

test("outreach counts for its sender, not its recipients, and automation never", () => {
  const sent = event("E1", "request", { when: -2 });
  const received = event("E2", "request", { actor: "P9", to: ["P1"], when: -1 });
  const automated = event("E3", "notice", { when: -1, automated: true });
  expect(top(run(item(), [sent])).days).toBe(2);
  expect(top(run(item(), [received, event("E9", "delivery", { subject: "Y1", when: -1 })])).days).toBe(60); // since active
  expect(run(item(), [automated]).level).toBe("unknown");
});

describe.each(["float", "critical"])("escalation by %s", (trigger) => {
  test.each(["due-soon", "at-risk"])("amber to red names its reasons (%s)", (urgency) => {
    const kw: Record<string, unknown> = urgency === "due-soon" ? { due: day(10) } : { status: "at-risk" };
    if (trigger === "critical") kw.criticality = "critical";
    const floats: RunOptions["floats"] = trigger === "float" ? { X1: { float: 30, deadline: "D1", by_deadline: {} } } : {};
    const items = { ...item("X1", kw), ...item("D1", { type: "deadline", name: "The deadline" }) };
    const r = run(items, [event("E1", "delivery", { when: -5 })], { raci: [{ holder: "P1", item: "X1", letter: "R", via: null }], floats });
    const a = top(r);
    expect([a.level, a.category]).toEqual(["red", "deal-risk"]);
    expect(a.reason.includes("schedule-critical")).toBe(trigger === "float");
    expect(a.reason).toContain("Escalated");
  });
});

test.each([
  [{ due: day(15), criticality: "critical" }, {}], // not urgent enough
  [{ due: day(10) }, { X1: { float: 31, deadline: "D1", by_deadline: {} } }], // float above the critical line
] as [Record<string, unknown>, RunOptions["floats"]][])("no escalation without both conditions (%#)", (kw, floats) => {
  const items = { ...item("X1", kw), ...item("D1", { type: "deadline" }) };
  const r = run(items, [event("E1", "delivery", { when: -5 })], { raci: [{ holder: "P1", item: "X1", letter: "R", via: null }], floats });
  expect([top(r).level, top(r).category]).toEqual(["amber", "inactivity"]);
});

test("an engaged person is never escalated", () => {
  const items = item("X1", { criticality: "critical", due: day(3), status: "at-risk" });
  expect(top(run(items, [event("E1", "delivery", { when: -1 })])).level).toBe("green");
});

test("workstream letters count engagement on any item in it", () => {
  const items = { ...item("WS1", { type: "workstream", workstream: null }), ...item("X1") };
  const r = run(items, [event("E1", "delivery", { subject: "X1", when: -2 })], { raci: [{ holder: "P1", item: "WS1", letter: "A", via: null }] });
  expect(top(r).days).toBe(2);
  expect(top(r).reason).toContain("or any of its items");
});

function steering(when: number, attended: string[] = ["P1"], agenda: string[] = []): WorkstreamEvent {
  return event("M1", "meeting", { actor: "P9", subject: "WS1", when, attended, agenda: agenda.map((a) => ({ code: a, name: a })) });
}

test("a workstream meeting is oversight for workstream letters", () => {
  const items = { ...item("WS1", { type: "workstream", workstream: null }), ...item("X1") };
  const r = run(items, [steering(-2)], { raci: [{ holder: "P1", item: "WS1", letter: "A", via: null }] });
  expect([top(r).days, top(r).level]).toEqual([2, "green"]);
});

test("attending a workstream meeting does not reset items it did not discuss", () => {
  const items = { ...item("WS1", { type: "workstream", workstream: null }), ...item("X1"), ...item("X2") };
  const raci = [{ holder: "P1", item: "X1", letter: "R", via: null }];
  const r = run(items, [steering(-1, ["P1"], ["X2"]), event("E0", "delivery", { subject: "X1", when: -20 })], { raci });
  expect([top(r).level, top(r).days]).toEqual(["red", 20]); // still measured from 20 days ago
});

test("an agenda item counts for attendees only", () => {
  const items = { ...item("WS1", { type: "workstream", workstream: null }), ...item("X1") };
  const raci = [{ holder: "P1", item: "X1", letter: "R", via: null }];
  const attended = run(items, [steering(-1, ["P1"], ["X1"])], { raci });
  expect(top(attended).days).toBe(1);
  expect(top(attended).reason).toContain("discussed at");
  const absent = run(items, [steering(-1, ["P7"], ["X1"]), event("E9", "delivery", { subject: "Y1", when: -1 })], { raci });
  expect(top(absent).days).toBe(60); // since the item became active
});

const AUTH: engagement.Party = { code: "AU", name: "Authority", kind: "organisation", employer: null, authority: true };

test.each([[11, "green"], [10, "amber"], [0, "amber"], [-1, "red"]] as [number, string][])("authority statutory timetable boundaries (due in %i)", (dueIn, level) => {
  const items = item("C1", { type: "regulatory-clearance", due: day(dueIn), planned_start: null });
  const r = run(items, [], { party: AUTH, raci: [], reviews: [{ authority: "AU", clearance: "C1" }] });
  expect([r.level, r.profile, top(r).category]).toEqual([level, "Statutory timetable", "statutory-timetable"]);
});

test("authorities are never assessed on silence", () => {
  const items = { ...item("C1", { type: "regulatory-clearance", due: day(30), planned_start: null }), ...item() };
  const r = run(items, [], { party: AUTH, raci: [{ holder: "AU", item: "X1", letter: "I", via: null }], reviews: [{ authority: "AU", clearance: "C1" }] });
  expect(r.level).toBe("green");
  expect(new Set(r.assessments.map((a) => a.category))).toEqual(new Set(["statutory-timetable", "authority"]));
  const q = event("Q1", "request", { actor: "P9", to: ["AU"], due: day(1), when: -3, subject: "C1" });
  expect(run(items, [q], { party: AUTH, raci: [], reviews: [{ authority: "AU", clearance: "C1" }] }).level).toBe("amber");
});

test("deadlines are limits, not work", () => {
  const r = run(item("D1", { type: "deadline", planned_start: null }), [event("E1", "delivery", { subject: "Y1" })], { letter: "A" });
  expect(top(r).category).toBe("deadline");
  expect(r.level).toBe("none");
});

test("ties go to the stronger letter, then the earlier due date", () => {
  const items = { ...item("X1", { due: day(40) }), ...item("X2", { due: day(20) }), ...item("X3", { due: day(10) }) };
  const raci = [{ holder: "P1", item: "X1", letter: "A", via: null }, { holder: "P1", item: "X2", letter: "R", via: null },
    { holder: "P1", item: "X3", letter: "R", via: null }];
  const r = run(items, [event("E9", "delivery", { subject: "Y1", when: -1 })], { raci });
  expect(r.assessments.slice(0, 3).map((a) => a.item)).toEqual(["X1", "X3", "X2"]);
});

test("every finding carries its evidence", () => {
  const q = event("Q1", "request", { actor: "P9", to: ["P1"], due: day(-1), when: -5 });
  const r = run(item(), [q, event("E1", "meeting", { when: -9, attended: ["P1"] })]);
  const kinds = new Set(r.assessments.flatMap((a) => a.evidence.map((e) => e.kind)));
  expect(["request", "item", "event"].every((k) => kinds.has(k))).toBe(true);
});
