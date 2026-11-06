// Connection paths (/api/connections) against a breadth-first search over the raw YAML (no src code):
// every simple path of up to three relations through entities, under the same rules.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, test } from "vitest";
import { parse } from "yaml";
import { client } from "./helpers.ts";
import { holders, rawSeed, ROOT, type Rec } from "./oracle.ts";

const SEED = rawSeed();
const POLICY = parse(readFileSync(join(ROOT, "config", "connection-policy.yaml"), "utf8")) as Rec;
const EVENTS = new Set(["request", "response", "meeting", "delivery", "decision", "notice", "status-change"]);
const LETTER: Record<string, string> = { A: "accountability", R: "responsibility", C: "consultation", I: "notification" };

type Relation = [string, Set<string>];

/**
 * Every relation instance with at least two entity players: [type, {entity codes}]. The deal itself,
 * mandates and events are relations, so they are never players here.
 */
function relations(workstreams = false): Relation[] {
  const out: Relation[] = [["acquisition", new Set([SEED.deal.acquirer, SEED.deal.target])]];
  for (const p of SEED.people) out.push(["employment", new Set([p.code, p.employer])]);
  for (const m of SEED.mandates) out.push(["mandate", new Set([m.client, m.adviser])]);
  for (const f of SEED.financing) out.push(["financing", new Set([f.lender, f.borrower])]);
  for (const r of SEED.reviews) out.push(["authority-review", new Set([r.reviewer, r.subject, r.applicant])]);
  for (const o of SEED.ownership) out.push(["ownership", new Set([o.owner, o.owned])]);
  for (const b of SEED.bound_by) out.push(["bound-by", new Set([b.obligor, b.obligation])]);
  for (const c of SEED.consents) out.push(["consent-right", new Set([c.grantor, c.obligation])]);
  for (const l of SEED.deadline_limits) out.push(["deadline-limit", new Set([l.item, l.deadline])]);
  for (const d of SEED.dependencies) out.push([d.kind, new Set([d.from, d.to])]);
  for (const [item, letters] of Object.entries(SEED.raci as Record<string, Rec>)) {
    for (const [letter, hs] of Object.entries(letters)) for (const h of holders(hs as string | string[])) out.push([LETTER[letter]!, new Set([h, item])]);
  }
  for (const r of SEED.risks) {
    out.push(["risk-ownership", new Set([r.owner, r.code])]);
    for (const x of r.exposed) out.push(["risk-exposure", new Set([r.code, x])]);
  }
  for (const e of SEED.events) out.push([e.type, new Set([e.actor, e.subject, ...(e.recipients ?? []), ...(e.attendees ?? []), ...(e.agenda ?? [])])]);
  if (workstreams) for (const i of SEED.items) out.push(["work-breakdown", new Set([i.code, i.workstream])]);
  return out.filter(([, players]) => players.size >= 2);
}

/** Every simple path a -> b as "types|stones" strings. */
function oraclePaths(a: string, b: string, maxHops = 3, activity = true, workstreams = false): string[] {
  const rels = relations(workstreams).map((r, i) => [i, ...r] as [number, string, Set<string>]);
  const touching: Record<string, [number, string, Set<string>][]> = {};
  for (const r of rels) for (const x of r[2]) (touching[x] ??= []).push(r);
  const found: string[] = [];
  const allowed = (t: string, hops: number) => !EVENTS.has(t) || (activity && hops <= POLICY.event_max_hops);

  const walk = (node: string, used: Set<number>, seen: Set<string>, types: string[], stones: string[], hops: number) => {
    for (const [i, t, players] of touching[node] ?? []) {
      if (used.has(i) || !allowed(t, hops)) continue;
      for (const nxt of players) {
        if (nxt === node) continue;
        if (nxt === b && types.length + 1 === hops) found.push(`${[...types, t].join(",")}|${stones.join(",")}`);
        else if (!seen.has(nxt) && nxt !== b && types.length + 1 < hops) {
          walk(nxt, new Set([...used, i]), new Set([...seen, nxt]), [...types, t], [...stones, nxt], hops);
        }
      }
    }
  };
  for (let hops = 1; hops <= maxHops; hops++) walk(a, new Set(), new Set([a]), [], [], hops);
  return found;
}

let c: ReturnType<typeof client>;
beforeAll(() => {
  c = client();
});

async function get(a: string, b: string, kw: Record<string, string | number> = {}) {
  const r = await c.get("/api/connections", { from: a, to: b, results: 50, ...kw });
  expect(r.status, r.text).toBe(200);
  return r.body;
}

const PAIRS: [string, string][] = [["PER-AINSWORTH", "ORG-CMA"], ["ORG-HELIX", "PER-OKAFOR"], ["PER-GRANT", "DL-LONGSTOP"], ["RK-HELIX", "ORG-ALB"],
  ["PER-HARTLEY", "ORG-HCJ"], ["PER-MENSAH", "CP-CMA"], ["ORG-CALDER", "PER-LINDQVIST"], ["AC-INT-INTERIM", "PER-DONNELLY"]];

describe.each(PAIRS)("%s to %s", (a, b) => {
  test("every path matches a breadth-first search", async () => {
    const body = (await get(a, b)).data;
    const expected = oraclePaths(a, b);
    expect(body.total).toBe(expected.length);
    const got = body.paths.map((p: Rec) => `${p.steps.map((s: Rec) => s.type).join(",")}|${p.nodes.slice(1, -1).map((n: Rec) => n.code).join(",")}`);
    expect(got.every((g: string) => expected.includes(g))).toBe(true);
    const costs = body.paths.map((p: Rec) => p.cost);
    expect(costs).toEqual([...costs].sort((x: number, y: number) => x - y)); // best first
  });
});

describe.each(PAIRS.slice(0, 4))("options for %s to %s", (a, b) => {
  test("change the search exactly as stated", async () => {
    expect((await get(a, b, { activity: "false" })).data.total).toBe(oraclePaths(a, b, 3, false).length);
    expect((await get(a, b, { workstreams: "true" })).data.total).toBe(oraclePaths(a, b, 3, true, true).length);
    for (const hops of [1, 2]) expect((await get(a, b, { max_hops: hops })).data.total).toBe(oraclePaths(a, b, hops).length);
  });
});

test("paths never go through the transaction or repeat anything", async () => {
  for (const [a, b] of PAIRS) {
    for (const p of (await get(a, b, { workstreams: "true" })).data.paths) {
      const codes = p.nodes.map((n: Rec) => n.code);
      expect(new Set(codes).size).toBe(codes.length);
      expect(p.nodes.some((n: Rec) => /^(DEAL-|MAN-|EV-)/.test(n.code))).toBe(false); // relations, never stones
      expect(p.steps.every((s: Rec) => s.type !== "deal-scope")).toBe(true);
      if (p.hops === 3) expect(p.steps.some((s: Rec) => EVENTS.has(s.type))).toBe(false); // activity: two steps at most
    }
  }
});

test("direct and indirect are distinguished and explained", async () => {
  const body = (await get("ORG-NOV", "PER-OKAFOR")).data;
  const first = body.paths[0];
  expect(first.direct).toBe(true);
  expect(first.hops).toBe(1);
  expect(first.steps[0].type).toBe("employment");
  expect(first.steps[0].sentence).toBe("Daniel Okafor works for Novacore plc as Director, Corporate Development");
  expect(body.paths.filter((p: Rec) => p.hops > 1).every((p: Rec) => !p.direct)).toBe(true);
  const meaningful = (await get("PER-AINSWORTH", "ORG-CMA")).data.paths[0];
  expect(meaningful.steps.map((s: Rec) => s.type)).toEqual(["employment", "mandate", "authority-review"]); // a standing chain first
  expect(meaningful.steps[2].sentence).toContain("applied for by Novacore plc");
  expect(meaningful.notes.some((n: string) => n.includes("hub"))).toBe(true); // through Novacore
});

test("n-ary relations stay whole", async () => {
  const review = (await get("PER-AINSWORTH", "ORG-CMA")).data.paths.flatMap((p: Rec) => p.steps).find((s: Rec) => s.type === "authority-review");
  expect(new Set([...review.others.map((o: Rec) => o.role), review.from_role, review.to_role])).toEqual(new Set(["reviewer", "subject", "applicant"]));
});

test("activity records are labelled", async () => {
  const body = (await get("ORG-HELIX", "PER-OKAFOR")).data;
  const event = body.paths.find((p: Rec) => p.steps.some((s: Rec) => s.type === "request"));
  expect(event.notes.some((n: string) => n.includes("activity record"))).toBe(true);
  expect(event.steps[0].sentence).toContain("sent");
});

test("results are bounded, grouped and stable", async () => {
  const small = (await c.ok("/api/connections", { from: "ORG-NOV", to: "PER-OKAFOR", results: 5 })).data;
  expect(small.paths).toHaveLength(5);
  expect(small.more.reduce((s: number, g: Rec) => s + g.count, 0)).toBe(small.total - 5);
  const again = (await c.ok("/api/connections", { from: "ORG-NOV", to: "PER-OKAFOR", results: 5 })).data;
  expect(again.paths.map((p: Rec) => p.text)).toEqual(small.paths.map((p: Rec) => p.text));
  expect(small.depths.map((d: Rec) => d.hops)).toEqual([1, 2, 3]);
});

test("fast enough on the full dataset", async () => {
  for (const [a, b] of [...PAIRS, ["ORG-NOV", "PER-OKAFOR"]] as [string, string][]) {
    const t = performance.now();
    await get(a, b);
    expect(performance.now() - t, `${a} ${b}`).toBeLessThan(1000); // generous for CI
  }
});

test("bad requests and read-only", async () => {
  expect((await c.get("/api/connections", { from: "PER-NOPE", to: "ORG-CMA" })).status).toBe(404);
  expect((await c.get("/api/connections", { from: "ORG-CMA", to: "ORG-CMA" })).status).toBe(422);
  expect((await c.get("/api/connections", { from: "ORG-CMA", to: "PER-GRANT", max_hops: 4 })).status).toBe(422);
  const body = (await c.get("/api/connections", { from: "ORG-CMA", to: "PER-GRANT" })).body;
  expect(body.typeql.length).toBeGreaterThan(0);
  expect(body.typeql.some((q: string) => ["insert", "delete", "define", "update"].some((w) => q.includes(w)))).toBe(false);
  expect(body.typeql.some((q: string) => q.includes("entity $mt"))).toBe(true);
  const nodes = (await c.ok("/api/connectables")).data;
  expect(new Set(nodes.map((n: Rec) => n.kind))).toEqual(new Set(["person", "organisation", "item", "workstream", "risk"]));
  expect(nodes.some((n: Rec) => /^(DEAL-|MAN-|EV-)/.test(n.code))).toBe(false);
});
