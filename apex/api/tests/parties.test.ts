// The Parties API (/api/register, /api/parties/{code}, /api/engagement-policy) against answers recomputed
// from the raw YAML with independent code: schedule float by brute force, and every party's engagement level.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, expect, test } from "vitest";
import { parse } from "yaml";
import { client } from "./helpers.ts";
import { bruteForceFloat, diffDays, holders, plusDays, rawSeed, ROOT, type Rec } from "./oracle.ts";

const SEED = rawSeed();
const AS_OF: string = SEED.deal.as_of;
const ITEMS: Record<string, Rec> = { ...Object.fromEntries(SEED.items.map((i: Rec) => [i.code, i])),
  ...Object.fromEntries(SEED.workstreams.map((w: Rec) => [w.code, { ...w, type: "workstream", workstream: null }])) };
const PEOPLE: Record<string, Rec> = Object.fromEntries(SEED.people.map((p: Rec) => [p.code, p]));
const ORGS: Record<string, Rec> = Object.fromEntries(SEED.organisations.map((o: Rec) => [o.code, o]));
const AUTHORITY_TYPES = new Set(["regulator", "court"]);
const POLICY = parse(readFileSync(join(ROOT, "config", "engagement-policy.yaml"), "utf8")) as Rec;
const ENGAGEMENT = new Set(["response", "meeting", "delivery", "decision"]);
const OUTREACH = new Set(["request", "notice"]);
const RACI: [string, string, string][] = Object.entries(SEED.raci as Record<string, Rec>).flatMap(([item, letters]) =>
  Object.entries(letters).flatMap(([letter, hs]) => holders(hs as string | string[]).map((h) => [h, item, letter] as [string, string, string])));
const LEVEL_RANK: Record<string, number> = { red: 0, amber: 1, green: 2 };

// ---- Oracles -------------------------------------------------------------------------------

/** The party's overall level, recomputed from the raw YAML. */
function oracleLevel(code: string): string {
  const person = PEOPLE[code];
  const employer = person ? person.employer : null;
  const authority = AUTHORITY_TYPES.has(ORGS[code]?.type) || Boolean(employer && AUTHORITY_TYPES.has(ORGS[employer]!.type));
  const members = new Set([code, ...(code in ORGS ? Object.entries(PEOPLE).filter(([, x]) => x.employer === code).map(([p]) => p) : [])]);
  const answered = new Set(SEED.events.flatMap((e: Rec) => e.reply_to ?? []));
  const mine = RACI.filter(([h]) => h === code).map(([, i, l]) => [i, l] as const);
  const assigned = new Set(mine.map(([i]) => i));
  const levels: string[] = [];
  for (const e of SEED.events) {
    if (e.type !== "request" || !e.response_due || answered.has(e.code)) continue;
    const to = new Set<string>(e.recipients ?? []);
    if (to.has(code) || (employer && to.has(employer) && assigned.has(e.subject))) {
      const days = diffDays(e.response_due, AS_OF);
      levels.push(days < 0 ? "red" : days <= POLICY.response_warning_days ? "amber" : "green");
    }
  }
  const worst = (ls: string[]) => ls.reduce((a, b) => (LEVEL_RANK[b]! < LEVEL_RANK[a]! ? b : a));
  if (authority) {
    for (const rv of SEED.reviews) {
      if (rv.reviewer === code && ITEMS[rv.subject]!.status !== "complete") {
        const days = diffDays(ITEMS[rv.subject]!.due, AS_OF);
        levels.push(days < 0 ? "red" : days <= POLICY.statutory_warning_days ? "amber" : "green");
      }
    }
    return levels.length ? worst(levels) : "none";
  }
  const engaged = SEED.events.filter((e: Rec) => !e.automated && (
    (ENGAGEMENT.has(e.type) && (members.has(e.actor) || (e.attendees ?? []).some((a: string) => members.has(a))))
    || (OUTREACH.has(e.type) && members.has(e.actor))));
  const other = new Set<string>();
  for (const [i, letter] of mine) {
    const it = ITEMS[i]!;
    if (it.status === "complete" || it.type === "deadline" || !(letter in POLICY.inactivity)) continue;
    const start = it.actual_start || it.planned_start;
    const active = start || plusDays(it.due, -POLICY.milestone_active_window_days);
    if (active > AS_OF) {
      other.add("not-yet-active");
      continue;
    }
    if (!engaged.length) {
      other.add("unknown");
      continue;
    }
    const on = it.type === "workstream" // oversight: the workstream or any of its items
      ? engaged.filter((e: Rec) => e.subject === i || ITEMS[e.subject]!.workstream === i)
      : engaged.filter((e: Rec) => e.subject === i || (e.agenda ?? []).includes(i)); // this item, or a meeting that discussed it
    const last = on.length ? on.map((e: Rec) => e.at.slice(0, 10)).sort().at(-1)! : null;
    const days = diffDays(AS_OF, last && last >= active ? last : active);
    const th = POLICY.inactivity[letter];
    const level = days >= th.red_from ? "red" : days >= th.amber_from ? "amber" : "green";
    const fl = it.type !== "workstream" ? bruteForceFloat(SEED, i) : null;
    const critical = (fl !== null && fl <= POLICY.critical_float_days) || it.criticality === "critical";
    const dueIn = diffDays(it.due, AS_OF);
    const urgent = (dueIn >= 0 && dueIn <= POLICY.urgent_window_days) || it.status === "at-risk" || it.status === "delayed";
    levels.push(level === "amber" && critical && urgent ? "red" : level);
  }
  if (levels.length) return worst(levels);
  return other.has("unknown") ? "unknown" : other.has("not-yet-active") ? "not-yet-active" : "none";
}

// ---- Fixtures --------------------------------------------------------------------------------

let c: ReturnType<typeof client>;
let register: Rec;
let profiles: Record<string, Rec>;
beforeAll(async () => {
  c = client();
  register = await c.ok("/api/register");
  profiles = {};
  for (const code of [...Object.keys(PEOPLE), ...Object.keys(ORGS)]) {
    const r = await c.get(`/api/parties/${code}`);
    expect(r.status, `${code}: ${r.text}`).toBe(200);
    profiles[code] = r.body;
  }
});

// ---- Tests -----------------------------------------------------------------------------------

test("float matches a brute-force search and the Impact Explorer", () => {
  const floats: Record<string, number | null> = {};
  for (const p of Object.values(profiles)) {
    for (const a of p.data.assignments) {
      if (ITEMS[a.item]!.status !== "complete" && ITEMS[a.item]!.type !== "workstream") floats[a.item] = a.float;
    }
  }
  expect(floats["CP-CMA"]).toBe(60); // Impact: Helix breaks at 61 days
  for (const [code, value] of Object.entries(floats)) expect(value, code).toBe(bruteForceFloat(SEED, code));
});

test("every party's level matches the oracle", () => {
  const people: Record<string, Rec> = Object.fromEntries(register.data.people.map((p: Rec) => [p.code, p]));
  const orgs: Record<string, Rec> = Object.fromEntries(register.data.organisations.map((o: Rec) => [o.code, o]));
  expect(new Set(Object.keys(people))).toEqual(new Set(Object.keys(PEOPLE)));
  expect(new Set(Object.keys(orgs))).toEqual(new Set(Object.keys(ORGS)));
  for (const code of [...Object.keys(PEOPLE), ...Object.keys(ORGS)]) {
    const row = people[code] ?? orgs[code]!;
    expect(row.engagement.level, code).toBe(oracleLevel(code));
    expect(profiles[code]!.data.engagement.level, code).toBe(oracleLevel(code));
  }
});

test("deliberate scenarios", () => {
  const top = (code: string) => profiles[code]!.data.assessments[0];
  expect([top("PER-DONNELLY").category, top("PER-DONNELLY").evidence[0].code]).toEqual(["overdue-response", "EV-INT-05"]);
  expect([top("PER-OSULLIVAN").category, top("PER-OSULLIVAN").evidence[0].code]).toEqual(["overdue-response", "EV-PPL-04"]);
  const grant = profiles["PER-GRANT"]!.data.assessments.find((a: Rec) => a.item === "AC-COM-DAY1");
  expect([grant.level, grant.days]).toEqual(["red", 13]);
  const menon = profiles["PER-MENON"]!.data.assessments.find((a: Rec) => a.item === "CV-CONDUCT");
  expect(menon.category).toBe("inactivity");
  expect(menon.days).toBe(10);
  expect(profiles["PER-MENSAH"]!.data.engagement.no_engagement_recorded).toBe(true);
});

test("authorities follow their statutory timetable", () => {
  const cma = profiles["ORG-CMA"]!.data;
  expect(cma.authority).toBe(true);
  expect(cma.engagement.profile).toBe("Statutory timetable");
  expect(cma.engagement.level).toBe("amber"); // Novacore's request EV-REG-13, reply due 27 Oct
  const categories = new Set(cma.assessments.map((a: Rec) => a.category));
  expect(categories.has("statutory-timetable") && categories.has("response-due")).toBe(true);
  expect(profiles["ORG-HCJ"]!.data.engagement.level).toBe("green");
  const authorityOrgs = new Set(Object.entries(ORGS).filter(([, o]) => AUTHORITY_TYPES.has(o.type)).map(([x]) => x));
  expect(SEED.people.some((p: Rec) => authorityOrgs.has(p.employer))).toBe(false); // D7
  expect(profiles["ORG-CMA"]!.data.people).toEqual([]);
});

test("outstanding responsibilities, letters and delivery risk", () => {
  for (const row of register.data.people) {
    const code = row.code;
    const open = RACI.filter(([h, i]) => h === code && ITEMS[i]!.status !== "complete").map(([, i, l]) => [i, l] as const);
    expect(row.letters, code).toEqual(Object.fromEntries([..."ARCI"].map((l) => [l, open.filter(([, x]) => x === l).length])));
    expect(row.outstanding).toBe(open.filter(([, l]) => l === "A" || l === "R").length);
    const risky = new Set(open.filter(([i, l]) => (l === "A" || l === "R") && ITEMS[i]!.type !== "deadline"
      && (["at-risk", "delayed"].includes(ITEMS[i]!.status) || ITEMS[i]!.due < AS_OF)).map(([i]) => i));
    expect(new Set(row.delivery_risk.map((d: Rec) => d.code)), code).toEqual(risky);
  }
});

test("profile assignments, requests and history", () => {
  for (const [code, body] of Object.entries(profiles)) {
    const p = body.data;
    expect(new Set(p.assignments.map((a: Rec) => `${a.item}|${a.letter}`)), code).toEqual(new Set(RACI.filter(([h]) => h === code).map(([, i, l]) => `${i}|${l}`)));
    const members = new Set([code, ...(code in ORGS ? Object.entries(PEOPLE).filter(([, y]) => y.employer === code).map(([x]) => x) : [])]);
    const addressed = new Set([...members, ...(code in PEOPLE ? [PEOPLE[code]!.employer] : [])]);
    const hits = (list: string[] | undefined, set: Set<string>) => (list ?? []).some((x) => set.has(x));
    const expected = new Set(SEED.events.filter((e: Rec) => members.has(e.actor) || hits(e.attendees, members) || hits(e.recipients, addressed)).map((e: Rec) => e.code));
    expect(new Set(p.history.map((e: Rec) => e.code)), code).toEqual(expected);
    const whens = p.history.map((e: Rec) => e.when);
    expect(whens).toEqual([...whens].sort().reverse());
    expect(new Set(p.requests_to.map((e: Rec) => e.code))).toEqual(new Set(SEED.events.filter((e: Rec) => e.type === "request" && hits(e.recipients, addressed)).map((e: Rec) => e.code)));
  }
});

test("every finding is explained with records", () => {
  const known = new Set([...Object.keys(ITEMS), ...SEED.events.map((e: Rec) => e.code)]);
  for (const [code, body] of Object.entries(profiles)) {
    for (const a of body.data.assessments) {
      expect(a.reason, code).toBeTruthy();
      expect(a.evidence.length, code).toBeGreaterThan(0);
      expect(a.evidence.every((ev: Rec) => known.has(ev.code)), code).toBe(true);
    }
  }
});

test("contacts are masked everywhere", async () => {
  const secrets = [...SEED.people.map((p: Rec) => p.email), ...SEED.people.map((p: Rec) => p.phone)];
  const bodies = [(await c.get("/api/register")).text];
  for (const code of [...Object.keys(PEOPLE), ...Object.keys(ORGS)]) bodies.push((await c.get(`/api/parties/${code}`)).text);
  for (const text of bodies) expect(secrets.filter((s) => text.includes(s))).toEqual([]);
  for (const row of register.data.people) {
    const src = PEOPLE[row.code]!;
    expect(row.contact.email.endsWith("@" + src.email.split("@")[1])).toBe(true);
    expect(row.contact.email).toContain("•");
    expect(row.contact.phone).toMatch(/^07700 900•••$/);
  }
});

test("the policy is served as configured", async () => {
  const body = (await c.get("/api/engagement-policy")).body;
  expect(body.data).toEqual(POLICY);
  expect(body.source).toBe("config/engagement-policy.yaml");
});

test("an unknown party and read-only", async () => {
  expect((await c.get("/api/parties/ORG-NOPE")).status).toBe(404);
  expect((await c.get("/api/parties/not%20a%20code")).status).toBe(422);
  for (const url of ["/api/register", "/api/parties/PER-OKAFOR"]) {
    const body = await c.ok(url);
    expect(body.typeql.some((q: string) => ["insert", "delete", "define", "update"].some((w) => q.includes(w)))).toBe(false);
    expect(body.typeql.some((q: string) => q.includes("sub engagement"))).toBe(true); // what counts comes from the schema
  }
});
