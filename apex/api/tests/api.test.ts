// The HTTP API, against a real seeded TypeDB database (a throwaway apex-test-* one).
//
// Expected answers are recomputed from data/seed/*.yaml with plain TypeScript (tests/oracle.ts style),
// never taken from the app's own code, so a wrong query can't pass by agreeing with itself.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, test } from "vitest";
import { ROUTES, UNAVAILABLE } from "../src/app.ts";
import { client, connection, drop, freshSeeded, seeded, write } from "./helpers.ts";
import { derivedProgress, effectiveStakes, Exact, holders, rawSeed, ROOT, type Rec } from "./oracle.ts";

const SEED = rawSeed();
const ITEMS: Record<string, Rec> = Object.fromEntries(SEED.items.map((i: Rec) => [i.code, i]));
const CONDITIONS = new Set(Object.entries(ITEMS).filter(([, i]) => ["regulatory-clearance", "shareholder-approval", "court-sanction"].includes(i.type)).map(([c]) => c));
const LETTER_ORDER = "ARCI";

let c: ReturnType<typeof client>;
beforeAll(() => {
  c = client();
});

describe("every endpoint, checked against the YAML", () => {
  test("deal summary matches seed", async () => {
    const d = (await c.ok("/api/deal")).data;
    const deal = SEED.deal;
    const orgs: Record<string, Rec> = Object.fromEntries(SEED.organisations.map((o: Rec) => [o.code, o]));
    expect([d.code, d.name]).toEqual([deal.code, deal.name]);
    expect(new Exact(d.value).equals(deal.value)).toBe(true);
    expect(d.currency).toBe(deal.currency);
    expect([d.as_of, d.structure]).toEqual([deal.as_of, deal.structure]);
    expect(d.acquirer.name).toBe(orgs[deal.acquirer]!.name);
    expect(d.target.name).toBe(orgs[deal.target]!.name);
  });

  test("deal status and metrics match seed", async () => {
    const d = (await c.ok("/api/deal")).data;
    const statuses = Object.fromEntries([...CONDITIONS].map((x) => [x, ITEMS[x]!.status]));
    const done = Object.values(statuses).filter((s) => s === "complete").length;
    const risky = Object.entries(statuses).filter(([, s]) => s === "at-risk" || s === "delayed").map(([x]) => x).sort();
    expect(d.status.conditions_total).toBe(CONDITIONS.size);
    expect(CONDITIONS.size).toBe(6);
    expect(d.status.conditions_satisfied).toBe(done);
    expect(done).toBe(4);
    expect(d.status.at_risk.map((a: Rec) => a.code).sort()).toEqual(risky);
    expect(risky).toEqual(["CP-CMA"]);
    expect(d.status.state).toBe("at-risk");

    const expected = derivedProgress(Object.values(ITEMS)); // D5: duration-weighted, never a plain mean
    const m = d.metrics;
    expect(m.progress_percent).toBe(expected.percent);
    expect(m.progress_items).toBe(expected.activities);
    expect([m.milestones_achieved, m.milestones_total]).toEqual([expected.achieved, expected.points]);
    expect(m.progress_basis).toContain("Duration-weighted");
    const total = SEED.financing.reduce((s: Exact, f: Rec) => s.plus(new Exact(f.value)), new Exact("0"));
    expect(m.committed_financing).toEqual([{ currency: "GBP", total: total.toString() }]);

    const asOf = SEED.deal.as_of;
    const deadlines = Object.values(ITEMS).filter((i) => i.type === "deadline" && i.due >= asOf).sort((a, b) => (a.due < b.due ? -1 : 1));
    const first = deadlines[0]!;
    const limited = SEED.deadline_limits.filter((dl: Rec) => dl.deadline === first.code).map((dl: Rec) => ITEMS[dl.item]!.due as string);
    const dayDiff = (a: string, b: string) => (Date.parse(a) - Date.parse(b)) / 86_400_000;
    expect(m.next_deadline).toEqual({ code: first.code, name: first.name, due: first.due,
      days_remaining: dayDiff(first.due, asOf), headroom_days: dayDiff(first.due, limited.sort().at(-1)!) });
  });

  test("deadline headroom matches the Impact answer key", async () => {
    // The Overview's headroom is one day short of the Impact Explorer's breach thresholds
    // (dataset.md: Helix from 61 days' delay, long-stop from 120, certain funds from 136).
    const dls: Record<string, Rec> = Object.fromEntries((await c.ok("/api/milestones")).data.deadlines.map((d: Rec) => [d.code, d]));
    expect(Object.fromEntries(Object.entries(dls).map(([k, d]) => [k, d.headroom_days]))).toEqual({ "DL-HELIX-WAIVER": 60, "DL-LONGSTOP": 119, "DL-FUNDS": 135 });
    expect(dls["DL-HELIX-WAIVER"]!.consent_from).toEqual([{ code: "ORG-HELIX", name: "Helix Contract Services Ltd" }]);
    expect(dls["DL-HELIX-WAIVER"]!.bound[0].code).toBe("ORG-ATL-IE");
    for (const [k, d] of Object.entries(dls)) expect(d.consequence).toBe(ITEMS[k]!.consequence);
  });

  test("milestones timeline matches seed", async () => {
    const data = (await c.ok("/api/milestones")).data;
    const expected = Object.entries(ITEMS).filter(([x, i]) => i.type === "milestone" || CONDITIONS.has(x)).map(([x]) => x);
    expect(data.items.map((i: Rec) => i.code).sort()).toEqual(expected.sort());
    expect(data.items.map((i: Rec) => i.due)).toEqual(expected.map((x) => ITEMS[x]!.due).sort());
    for (const i of data.items) {
      expect(i.accountable.code).toBe(SEED.raci[i.code].A);
      expect(i.workstream.code).toBe(ITEMS[i.code]!.workstream);
    }
  });

  test("milestones criticality filter", async () => {
    const body = await c.ok("/api/milestones?criticality=critical&criticality=high");
    const expected = new Set(Object.entries(ITEMS).filter(([x, i]) => (i.type === "milestone" || CONDITIONS.has(x))
      && ["critical", "high"].includes(i.criticality ?? "medium")).map(([x]) => x));
    expect(new Set(body.data.items.map((i: Rec) => i.code))).toEqual(expected);
    expect(body.parameters).toEqual({ criticality: ["critical", "high"] });
    expect(body.typeql[1]).toContain('like "^(critical|high)$"');
    expect((await c.get("/api/milestones?criticality=urgent")).status).toBe(422);
  });

  test("approvals match seed", async () => {
    const data = (await c.ok("/api/approvals")).data;
    const clearances = Object.entries(ITEMS).filter(([, i]) => i.type === "regulatory-clearance").sort((a, b) => (a[1].due < b[1].due ? -1 : 1)).map(([x]) => x);
    expect(data.map((a: Rec) => a.code)).toEqual(clearances);
    const reviewers: Record<string, Set<string>> = {};
    for (const rv of SEED.reviews) (reviewers[rv.subject] ??= new Set()).add(rv.reviewer);
    for (const a of data) {
      expect(a.status).toBe(ITEMS[a.code]!.status);
      expect(new Set(a.reviews.map((r: Rec) => r.code))).toEqual(reviewers[a.code]);
      expect(a.reviews.every((r: Rec) => r.applicant === "Novacore plc")).toBe(true);
    }
    const byCode: Record<string, Rec> = Object.fromEntries(data.map((a: Rec) => [a.code, a]));
    expect(new Set(byCode["CP-HSR"]!.reviews.map((r: Rec) => r.code))).toEqual(new Set(["ORG-FTC", "ORG-DOJ"]));
    const latestCma = SEED.events.filter((e: Rec) => e.subject === "CP-CMA").sort((a: Rec, b: Rec) => (a.at < b.at ? 1 : -1))[0];
    expect(byCode["CP-CMA"]!.latest.summary).toBe(latestCma.summary);
  });

  test("activity newest first", async () => {
    const body = await c.ok("/api/activity?limit=5");
    const expected = [...SEED.events].sort((a: Rec, b: Rec) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0)).slice(0, 5);
    expect(body.data.map((a: Rec) => a.summary)).toEqual(expected.map((e: Rec) => e.summary));
    expect(body.data.map((a: Rec) => a.when)).toEqual(expected.map((e: Rec) => e.at));
    expect(body.parameters).toEqual({ limit: 5 });
    expect(body.typeql[0]).toContain("limit 5;");
    expect((await c.ok("/api/activity")).data).toHaveLength(10);
    expect((await c.get("/api/activity?limit=0")).status).toBe(422);
    expect((await c.get("/api/activity?limit=51")).status).toBe(422);
  });

  const team = (org: string) => {
    const hs = new Set(Object.values(SEED.raci as Record<string, Rec>).flatMap((v) => Object.values(v).flatMap((x) => holders(x as string | string[]))));
    return SEED.people.filter((p: Rec) => p.employer === org && hs.has(p.code)).map((p: Rec) => p.code).sort();
  };

  test("parties match seed", async () => {
    const data = (await c.ok("/api/parties")).data;
    const deal = SEED.deal;
    expect(data.principals.map((p: Rec) => [p.role, p.organisation.code])).toEqual([["Acquirer", deal.acquirer], ["Target", deal.target]]);
    for (const p of data.principals) expect(p.team.map((m: Rec) => m.code)).toEqual(team(p.organisation.code));
    expect(new Set(data.advisers.map((a: Rec) => [a.mandate, a.client.code, a.organisation.code, a.mandate_type].join("|")))).toEqual(
      new Set(SEED.mandates.map((m: Rec) => [m.code, m.client, m.adviser, m.type].join("|"))));
    for (const a of data.advisers) expect(a.team.map((m: Rec) => m.code)).toEqual(team(a.organisation.code));
    expect(new Set(data.lenders.map((l: Rec) => [l.facility.code, l.organisation.code, l.facility.value].join("|")))).toEqual(
      new Set(SEED.financing.map((f: Rec) => [f.code, f.lender, f.value].join("|"))));
    const authorities = new Set(SEED.organisations.filter((o: Rec) => o.type === "regulator" || o.type === "court").map((o: Rec) => o.code));
    expect(new Set(data.authorities.map((a: Rec) => a.organisation.code))).toEqual(authorities);
    const panel = data.authorities.find((a: Rec) => a.organisation.code === "ORG-PANEL");
    expect(panel.reviews).toEqual([]);
    expect(new Set(panel.raci.map((r: Rec) => r.letter))).toEqual(new Set(["I"]));
  });

  test("progress matches seed", async () => {
    const data = (await c.ok("/api/progress")).data;
    expect(data.map((w: Rec) => w.code)).toEqual([...SEED.workstreams].sort((a: Rec, b: Rec) => (a.planned_start < b.planned_start ? -1 : 1)).map((w: Rec) => w.code));
    for (const w of data) {
      const src = SEED.workstreams.find((s: Rec) => s.code === w.code);
      const own = Object.values(ITEMS).filter((i) => i.workstream === w.code);
      const expected = derivedProgress(own);
      expect([w.status, w.description]).toEqual([src.status, src.description]);
      expect(w.progress).toBe(expected.percent); // derived from items, not stored
      expect([w.milestones_achieved, w.milestones_total]).toEqual([expected.achieved, expected.points]);
      const counts: Record<string, number> = {};
      for (const i of own) counts[i.status] = (counts[i.status] ?? 0) + 1;
      expect(w.item_statuses).toEqual(counts);
    }
  });

  test("raci matrix matches seed", async () => {
    const body = await c.ok("/api/raci?workstream=WS-REG");
    const data = body.data;
    const items = Object.entries(ITEMS).filter(([, i]) => i.workstream === "WS-REG").map(([x]) => x);
    expect(data.items.map((i: Rec) => i.code).sort()).toEqual([...items].sort());
    const expected = new Set<string>();
    for (const code of items) for (const [letter, hs] of Object.entries(SEED.raci[code])) for (const h of holders(hs as string | string[])) expected.add(`${code}|${h}|${letter}`);
    expect(new Set(data.cells.map((x: Rec) => `${x.item}|${x.holder}|${x.letter}`))).toEqual(expected);
    // Benedict Shaw (Blackwood Marsh) acts under Blackwood Marsh's mandate.
    expect(new Set(data.cells.filter((x: Rec) => x.holder === "PER-SHAW").map((x: Rec) => x.via))).toEqual(new Set(["MAN-BWM"]));
    // Columns: strongest letter first.
    const strongest = data.holders.map((h: Rec) => Math.min(...data.cells.filter((x: Rec) => x.holder === h.code).map((x: Rec) => LETTER_ORDER.indexOf(x.letter))));
    expect(strongest).toEqual([...strongest].sort((a, b) => a - b));
    expect(body.typeql[0]).toContain('"WS-REG"');
    expect(body.parameters).toEqual({ workstream: "WS-REG" });
    expect((await c.get("/api/raci?workstream=WS-NONE")).status).toBe(404);
    expect((await c.get('/api/raci?workstream=WS-REG";')).status).toBe(422);
  });

  test("checks pass on seed", async () => {
    const data = (await c.ok("/api/checks")).data;
    expect(data.passed).toBe(true);
    expect(data.checks.map((x: Rec) => x.check)).toEqual(["no_accountable", "overdue", "clearance_without_authority"]);
    expect(data.checks.every((x: Rec) => x.items.length === 0)).toBe(true);
  });

  test("ownership matches the independent oracle", async () => {
    const data = (await c.ok("/api/ownership?parent=ORG-ATL")).data;
    const expected = effectiveStakes(SEED, "ORG-ATL");
    expect(Object.fromEntries(data.companies.map((x: Rec) => [x.code, [new Exact(x.stake).toString(), x.routes]]))).toEqual(
      Object.fromEntries(Object.entries(expected).map(([k, [s, n]]) => [k, [s.toString(), n]])));
    expect(new Set(data.consents.map((x: Rec) => x.obligation))).toEqual(new Set(["CV-COC-CALDER", "CV-COC-HELIX", "DL-HELIX-WAIVER"]));
    expect((await c.get("/api/ownership?parent=ORG-NOPE")).status).toBe(404);
  });
});

describe("planted problems (each test commits to its own throwaway database)", () => {
  test("checks report planted problems", async () => {
    const db = await freshSeeded();
    try {
      await write(db, `
        match $x isa milestone, has code "IN-SYNERGY"; $a isa accountability (accountable-item: $x); delete $a;`);
      await write(db, `
        match $x isa milestone, has code "MS-COMMS-PLAN", has due-date $d; delete has $d of $x;
        insert $x has due-date 2026-10-01;`);
      await write(db, `
        match $ws isa workstream, has code "WS-REG"; $o isa person, has code "PER-OKAFOR";
        insert $c isa regulatory-clearance, has code "CP-IE-SCREEN", has name "Irish investment screening",
               has status "in-progress", has due-date 2026-11-20;
               work-breakdown (whole: $ws, part: $c); accountability (holder: $o, accountable-item: $c);`);
      const own = client(db);
      const data = (await own.ok("/api/checks")).data;
      const approvals = (await own.ok("/api/approvals")).data;
      const found = Object.fromEntries(data.checks.map((ch: Rec) => [ch.check, ch.items.map((i: Rec) => i.code)]));
      expect(data.passed).toBe(false);
      expect(found).toEqual({ no_accountable: ["IN-SYNERGY"], overdue: ["MS-COMMS-PLAN"], clearance_without_authority: ["CP-IE-SCREEN"] });
      // The new kind of clearance shows up in the approvals panel with no query changed.
      expect(approvals.find((a: Rec) => a.code === "CP-IE-SCREEN").reviews).toEqual([]);
    } finally {
      await drop(db);
    }
  });

  test("ownership refuses figures on a cycle", async () => {
    const db = await freshSeeded();
    try {
      await write(db, `
        match $a isa company, has code "ORG-ATL-DE"; $b isa company, has code "ORG-ATL";
        insert ownership (owner: $a, owned: $b), has stake 0.05dec;`);
      const r = await client(db).get("/api/ownership?parent=ORG-ATL");
      expect(r.status).toBe(409);
      expect(r.body.cycles).toContain("ORG-ATL");
      expect(r.body).not.toHaveProperty("companies");
      expect(r.body).not.toHaveProperty("data");
      expect(r.body.typeql.some((q: string) => q.includes("ownership_cycles()"))).toBe(true); // the guard that fired is shown
    } finally {
      await drop(db);
    }
  });
});

const ENDPOINTS = ["/api/deal", "/api/impact?delay_days=61", "/api/milestones", "/api/approvals", "/api/activity", "/api/parties",
  "/api/progress", "/api/raci?workstream=WS-REG", "/api/checks", "/api/ownership?parent=ORG-ATL",
  "/api/ownership", "/api/graph", "/api/graph/node/ORG-BWM", "/api/graph/node/PER-SHAW"];

describe("the TypeQL drawer shows exactly what ran", () => {
  test("recorded typeql reruns to the same answer", async () => {
    // Every query in a response's typeql list runs as-is in a READ transaction (as it would in
    // Studio). The guards and checks are included, so the drawer hides nothing.
    for (const url of ENDPOINTS) {
      const body = await c.ok(url);
      expect(body.typeql.length, url).toBeGreaterThan(0);
      expect(body.database).toBe(seeded());
      await connection.read(async (tx) => {
        for (const q of body.typeql) await tx.run(q);
      }, seeded());
    }
    const ownership = (await c.ok("/api/ownership?parent=ORG-ATL")).typeql;
    expect(ownership.some((q: string) => q.includes("ownership_cycles()"))).toBe(true);
    expect(ownership.some((q: string) => q.includes("group_members"))).toBe(true);
    const approvals = (await c.ok("/api/approvals")).typeql[0];
    const { result } = await connection.read((tx) => tx.docs(approvals), seeded());
    expect(result.map((d) => d.clearance.code)).toEqual((await c.ok("/api/approvals")).data.map((a: Rec) => a.code));
  });
});

describe("read-only, robust", () => {
  test("the API is read-only", async () => {
    expect(ROUTES.every((r) => r.startsWith("/api/") || r.startsWith("^\\/api\\/"))).toBe(true);
    expect((await c.request("POST", "/api/deal")).status).toBe(405);
    expect((await c.request("DELETE", "/api/checks")).status).toBe(405);
    for (const file of ["app.ts", "overview.ts"]) {
      const source = readFileSync(join(ROOT, "api", "src", file), "utf8");
      expect(source).not.toContain('"write"');
      expect(source).not.toContain('"schema"');
      expect(source).not.toContain("commitTransaction");
    }
  });

  test("concurrent requests", async () => {
    const codes = await Promise.all([...ENDPOINTS, ...ENDPOINTS, ...ENDPOINTS].map(async (u) => (await c.get(u)).status));
    expect(codes).toEqual(codes.map(() => 200));
  });

  test("an unreachable database gives a plain 503", async () => {
    const started = performance.now();
    const bad = client(seeded(), { address: "127.0.0.1:1" });
    const h = await bad.get("/api/health");
    const r = await bad.get("/api/deal");
    expect(h.status).toBe(503);
    expect(h.body.status).toBe("unavailable");
    expect(r.status).toBe(503);
    expect(r.body.detail).toBe(UNAVAILABLE);
    expect(performance.now() - started).toBeLessThan(30_000);
  });

  test("a missing database gives a plain 503", async () => {
    const r = await client("apex-test-doesnotexist").get("/api/deal");
    expect(r.status).toBe(503);
    expect(r.body.detail).toContain("doesn't exist yet");
  });

  test("health asks the server each time", async () => {
    // Health must ask the server each time, not trust a connection opened earlier.
    expect((await c.get("/api/health")).body.status).toBe("ok");
    const r = await client(seeded(), { address: "127.0.0.1:1" }).get("/api/health");
    expect(r.status).toBe(503);
    expect(r.body.status).toBe("unavailable");
  });

  test("no contact details leave the API", async () => {
    // Contacts are stored but masked server-side (D7): no full email or phone appears in any response.
    const people = rawSeed().people as Rec[];
    const secrets = [...people.map((p) => p.email), ...people.map((p) => p.phone)];
    const urls = ["/api/deal", "/api/milestones", "/api/approvals", "/api/activity", "/api/parties", "/api/progress",
      "/api/raci", "/api/checks", "/api/ownership", "/api/graph", "/api/impact?item=CP-CMA&delay_days=61",
      ...people.map((p) => `/api/graph/node/${p.code}`)];
    for (const url of urls) {
      const body = (await c.get(url)).text;
      expect(secrets.filter((s) => body.includes(s)), url).toEqual([]);
    }
  });
});
