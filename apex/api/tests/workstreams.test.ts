// The Workstreams API (/api/workstreams, /api/workstreams/{code}) against answers recomputed from the raw
// YAML. Recursion is re-done here as plain graph searches over the dependencies (no src code is used).

import { beforeAll, expect, test } from "vitest";
import { client } from "./helpers.ts";
import { derivedProgress, diffDays, holders, rawSeed, type Rec } from "./oracle.ts";

const SEED = rawSeed();
const ITEMS: Record<string, Rec> = Object.fromEntries(SEED.items.map((i: Rec) => [i.code, i]));
const WS: Record<string, Rec> = Object.fromEntries(SEED.workstreams.map((w: Rec) => [w.code, w]));
const AS_OF: string = SEED.deal.as_of;
const HARD = new Set(["sequencing", "gating"]);
const CONDITIONS = new Set(["regulatory-clearance", "shareholder-approval", "court-sanction"]);
const NEXT: Record<string, Set<string>> = {};
const PREV: Record<string, Set<string>> = {};
for (const d of SEED.dependencies) {
  if (HARD.has(d.kind)) {
    (NEXT[d.from] ??= new Set()).add(d.to);
    (PREV[d.to] ??= new Set()).add(d.from);
  }
}

function reach(start: string, graph: Record<string, Set<string>>): Set<string> {
  const seen = new Set<string>();
  const todo = [...(graph[start] ?? [])];
  while (todo.length) {
    const x = todo.pop()!;
    if (!seen.has(x)) {
      seen.add(x);
      todo.push(...(graph[x] ?? []));
    }
  }
  return seen;
}

const own = (ws: string) => Object.values(ITEMS).filter((i) => i.workstream === ws);
const eventKey = (e: Rec) => `${e.at}|${e.code}`;

let listing: Record<string, Rec>;
let details: Record<string, Rec>;
beforeAll(async () => {
  const c = client();
  listing = Object.fromEntries((await c.ok("/api/workstreams")).data.workstreams.map((w: Rec) => [w.code, w]));
  details = {};
  for (const code of Object.keys(WS)) details[code] = (await c.ok(`/api/workstreams/${code}`)).data;
});

test("every workstream once in date order", () => {
  const key = (w: Rec) => `${w.planned_start}|${w.due}|${w.code}`;
  expect(Object.keys(listing)).toEqual(Object.values(WS).sort((a, b) => (key(a) < key(b) ? -1 : 1)).map((w) => w.code));
});

test("three measures kept apart", () => {
  for (const [code, w] of Object.entries(listing)) {
    const mine = own(code);
    const expected = derivedProgress(mine);
    const conditions = mine.filter((i) => CONDITIONS.has(i.type));
    expect(w.progress, code).toBe(expected.percent); // activity progress
    expect([w.milestones_achieved, w.milestones_total]).toEqual([expected.achieved, expected.points]);
    expect([w.conditions_satisfied, w.conditions_total]).toEqual([conditions.filter((i) => i.status === "complete").length, conditions.length]); // readiness to close
  }
  expect(listing["WS-REG"]!.conditions_total).toBe(4);
  expect(listing["WS-DD"]!.conditions_total).toBe(0);
});

test("counts, lead and next milestone", () => {
  for (const [code, w] of Object.entries(listing)) {
    const mine = own(code);
    const counts: Record<string, number> = {};
    for (const i of mine) counts[i.status] = (counts[i.status] ?? 0) + 1;
    expect(w.items).toBe(mine.length);
    expect(w.item_statuses).toEqual(counts);
    expect(w.lead.code).toBe(SEED.raci[code].A);
    const points = mine.filter((i) => i.type !== "deadline" && !i.planned_start && i.status !== "complete")
      .sort((a, b) => (`${a.due}|${a.code}` < `${b.due}|${b.code}` ? -1 : 1));
    if (points.length) {
      expect(w.next_milestone.code).toBe(points[0]!.code);
      expect(w.next_milestone.days_remaining).toBe(diffDays(points[0]!.due, AS_OF));
    } else {
      expect(w.next_milestone).toBeNull();
    }
  }
});

test("deadlines the open work can affect", () => {
  const limits: Record<string, Set<string>> = {};
  for (const l of SEED.deadline_limits) (limits[l.item] ??= new Set()).add(l.deadline);
  for (const [code, w] of Object.entries(listing)) {
    const expected = new Set(own(code).filter((i) => i.type === "deadline").map((i) => i.code));
    for (const i of own(code)) {
      if (i.status !== "complete") for (const x of [i.code, ...reach(i.code, NEXT)]) for (const dl of limits[x] ?? []) expected.add(dl);
    }
    expect(new Set(w.deadlines.map((d: Rec) => d.code)), code).toEqual(expected);
    for (const d of w.deadlines) expect(d.days_remaining).toBe(diffDays(ITEMS[d.code]!.due, AS_OF));
  }
  expect(new Set(listing["WS-REG"]!.deadlines.map((d: Rec) => d.code))).toEqual(new Set(["DL-HELIX-WAIVER", "DL-LONGSTOP", "DL-FUNDS"]));
});

test("risks and organisations", () => {
  const people: Record<string, Rec> = Object.fromEntries(SEED.people.map((p: Rec) => [p.code, p]));
  for (const [code, w] of Object.entries(listing)) {
    const expected = new Set(SEED.risks.filter((r: Rec) => r.exposed.some((x: string) => ITEMS[x]?.workstream === code)).map((r: Rec) => r.code));
    expect(new Set(w.risks.map((r: Rec) => r.code)), code).toEqual(expected);
    for (const r of w.risks) {
      const src = SEED.risks.find((s: Rec) => s.code === r.code);
      expect(r.owner.code).toBe(src.owner);
      expect(r.severity).toBe(src.severity);
    }
    const orgs = new Set<string>();
    for (const item of [code, ...own(code).map((i) => i.code)]) {
      for (const hs of Object.values(SEED.raci[item] as Rec)) for (const h of holders(hs as string | string[])) orgs.add(h in people ? people[h]!.employer : h);
    }
    expect(new Set(w.organisations.map((o: Rec) => o.code)), code).toEqual(orgs);
  }
});

test("latest event and event counts", () => {
  for (const [code, w] of Object.entries(listing)) {
    const events = SEED.events.filter((e: Rec) => e.subject === code || ITEMS[e.subject]?.workstream === code)
      .sort((a: Rec, b: Rec) => (eventKey(a) < eventKey(b) ? 1 : -1));
    expect(w.events).toBe(events.length);
    expect(w.latest_event.code).toBe(events[0].code);
    expect(details[code]!.events.map((e: Rec) => e.code)).toEqual(events.map((e: Rec) => e.code)); // newest first
  }
  const total = Object.values(listing).reduce((s, w) => s + w.events, 0);
  expect(total).toBe(SEED.events.length);
  expect(total).toBe(118);
  const oversight = Object.values(details).flatMap((d) => d.events).filter((e: Rec) => e.item.code.startsWith("WS-"));
  expect(oversight).toHaveLength(7);
  expect(oversight.every((e: Rec) => e.type === "meeting" && e.agenda.length)).toBe(true);
});

test("the feed carries the event model", () => {
  const feed: Record<string, Rec> = Object.fromEntries(Object.values(details).flatMap((d) => d.events).map((e: Rec) => [e.code, e]));
  for (const e of SEED.events) {
    const got = feed[e.code]!;
    expect([got.type, got.actor.code, got.item.code]).toEqual([e.type, e.actor, e.subject]);
    expect(got.recipients.map((r: Rec) => r.code)).toEqual([...(e.recipients ?? [])].sort());
    expect(got.attendees.map((r: Rec) => r.code)).toEqual([...(e.attendees ?? [])].sort());
    expect(got.agenda.map((r: Rec) => r.code)).toEqual([...(e.agenda ?? [])].sort());
    expect(got.replies_to).toEqual([...(e.reply_to ?? [])].sort());
    expect(got.response_due).toBe(e.response_due ?? null);
    expect([got.previous_status, got.new_status]).toEqual([e.previous_status ?? null, e.new_status ?? null]);
  }
  const answered: Record<string, string[]> = {};
  for (const e of SEED.events) for (const q of e.reply_to ?? []) (answered[q] ??= []).push(e.code);
  for (const [code, got] of Object.entries(feed)) expect(got.answered_by.map((a: Rec) => a.code).sort()).toEqual([...(answered[code] ?? [])].sort());
  expect(feed["EV-INT-05"]!.answered_by).toEqual([]); // the deliberate unanswered request
});

test("items and open prerequisites at any depth", () => {
  for (const [code, d] of Object.entries(details)) {
    const key = (i: Rec) => `${i.planned_start || i.due}|${i.due}|${i.code}`;
    expect(d.items.map((i: Rec) => i.code)).toEqual(own(code).sort((a, b) => (key(a) < key(b) ? -1 : 1)).map((i) => i.code));
    for (const it of d.items) {
      const expected = new Set([...reach(it.code, PREV)].filter((u) => ITEMS[u]!.status !== "complete"));
      expect(new Set(it.open_prerequisites.map((u: Rec) => u.code)), it.code).toEqual(expected);
    }
  }
  const court = details["WS-LEG"]!.items.find((i: Rec) => i.code === "CP-COURT");
  expect(new Set(court.open_prerequisites.map((u: Rec) => u.workstream)).has("WS-REG")).toBe(true); // blocked from another workstream
});

test("dependencies and crossings", () => {
  for (const [code, d] of Object.entries(details)) {
    const expected = Object.fromEntries(SEED.dependencies.filter((x: Rec) => [ITEMS[x.from]!.workstream, ITEMS[x.to]!.workstream].includes(code))
      .map((x: Rec) => [`${x.from}|${x.to}`, ITEMS[x.from]!.workstream !== ITEMS[x.to]!.workstream]));
    expect(Object.fromEntries(d.dependencies.map((x: Rec) => [`${x.from}|${x.to}`, x.crosses])), code).toEqual(expected);
    expect(d.dependencies.every((x: Rec) => x.hard === HARD.has(x.kind))).toBe(true);
  }
});

test("open conditions offered for simulation", () => {
  for (const [code, d] of Object.entries(details)) {
    expect(new Set(d.open_conditions.map((x: Rec) => x.code))).toEqual(new Set(own(code).filter((i) => CONDITIONS.has(i.type) && i.status !== "complete").map((i) => i.code)));
  }
  expect(new Set(details["WS-REG"]!.open_conditions.map((x: Rec) => x.code))).toEqual(new Set(["CP-CMA"]));
});

test("obligations", () => {
  for (const [code, d] of Object.entries(details)) {
    const expected = new Set(own(code).filter((i) => CONDITIONS.has(i.type) || i.type === "covenant" || i.type === "deadline").map((i) => i.code));
    expect(new Set(d.obligations.map((o: Rec) => o.code)), code).toEqual(expected);
  }
  const longstop = details["WS-LEG"]!.obligations.find((o: Rec) => o.code === "DL-LONGSTOP");
  expect(longstop.consequence).toBeTruthy();
  expect(new Set(longstop.limits.map((x: Rec) => x.code))).toEqual(new Set(["MS-COMPLETION"]));
});

test("RACI is contextual per item", async () => {
  // One person, three different letters on different items of one workstream (plan §5.1).
  const cells = (await client().ok("/api/raci?workstream=WS-REG")).data.cells;
  const letters = new Set(cells.filter((x: Rec) => x.holder === "PER-OKAFOR").map((x: Rec) => x.letter));
  const expected = new Set<string>();
  for (const i of own("WS-REG")) for (const [letter, h] of Object.entries(SEED.raci[i.code] as Rec)) if (holders(h as string | string[]).includes("PER-OKAFOR")) expected.add(letter);
  expect(letters).toEqual(expected);
  expect(letters.size).toBeGreaterThanOrEqual(3);
});

test("an unknown workstream and read-only", async () => {
  const c = client();
  expect((await c.get("/api/workstreams/WS-NOPE")).status).toBe(404);
  expect((await c.get("/api/workstreams/not%20a%20code")).status).toBe(422);
  for (const url of ["/api/workstreams", "/api/workstreams/WS-REG"]) {
    const body = await c.ok(url);
    expect(body.typeql.some((q: string) => ["insert", "delete", "define", "update"].some((w) => q.includes(w)))).toBe(false);
    expect(body.capabilities).toContain("Recursive functions"); // downstream and upstream are really called
  }
});
