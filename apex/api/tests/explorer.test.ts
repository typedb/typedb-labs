// Relationship Explorer API, against a real seeded TypeDB database.
//
// Expected graphs are rebuilt from data/seed/*.yaml and the type hierarchy from schema/schema.tql
// text, sharing no code with src/, so a wrong query can't pass by agreeing with itself.

import { beforeAll, describe, expect, test } from "vitest";
import { client, drop, freshSeeded, write } from "./helpers.ts";
import { effectiveStakes, Exact, holders, ownershipRoutes, rawSeed, schemaText, type Rec } from "./oracle.ts";

const SEED = rawSeed();
const ORGS: Record<string, Rec> = Object.fromEntries(SEED.organisations.map((o: Rec) => [o.code, o]));
const DEAL = SEED.deal;
const SCHEMA = schemaText(); // base schema plus migrations, as TypeDB loads it

/** {type: parent} for the party types (people and organisations), parsed from the schema text. */
function schemaParents(): Record<string, string> {
  const parents: Record<string, string> = Object.fromEntries([...SCHEMA.matchAll(/entity ([\w-]+)(?: @abstract,)? sub ([\w-]+)/g)].map((m) => [m[1]!, m[2]!]));
  const isParty = (t: string) => {
    while (t in parents) t = parents[t]!;
    return t === "party";
  };
  return Object.fromEntries(Object.entries(parents).filter(([t]) => isParty(t)));
}

let c: ReturnType<typeof client>;
beforeAll(() => {
  c = client();
});

const relationKey = (type: string, players: [string, string][]) => `${type}:${players.map(([r, code]) => `${r}=${code}`).sort().join(",")}`;

function expectedRelations(): Set<string> {
  // Every relation in the seed linking two or more organisations, with all players and roles.
  const out = new Set([relationKey("acquisition", [["acquirer", DEAL.acquirer], ["target", DEAL.target]])]);
  for (const m of SEED.mandates) out.add(relationKey("mandate", [["client", m.client], ["adviser", m.adviser], ["engagement", DEAL.code]]));
  for (const f of SEED.financing) out.add(relationKey("financing", [["borrower", f.borrower], ["lender", f.lender], ["purpose", DEAL.code]]));
  for (const rv of SEED.reviews) out.add(relationKey("authority-review", [["reviewer", rv.reviewer], ["subject", rv.subject], ["applicant", rv.applicant]]));
  for (const o of SEED.ownership) out.add(relationKey("ownership", [["owner", o.owner], ["owned", o.owned]]));
  return out;
}

describe("the graph", () => {
  test("nodes are every organisation with its type path", async () => {
    const data = (await c.ok("/api/graph")).data;
    const parents = schemaParents();
    expect(new Set(data.nodes.map((n: Rec) => n.code))).toEqual(new Set(Object.keys(ORGS)));
    for (const n of data.nodes) {
      expect(n.type).toBe(ORGS[n.code]!.type);
      expect(n.name).toBe(ORGS[n.code]!.name);
      const path = [n.type];
      while (path[path.length - 1] in parents) path.push(parents[path[path.length - 1]!]!);
      expect(n.type_path).toEqual(path);
      expect(n.people).toBe(SEED.people.filter((p: Rec) => p.employer === n.code).length);
    }
    expect(data.types.parties).toEqual(parents);
  });

  test("relations keep every player and role", async () => {
    // n-ary relations come back whole: a mandate has its client, adviser AND the deal it is for.
    const data = (await c.ok("/api/graph")).data;
    expect(new Set(data.relations.map((r: Rec) => relationKey(r.type, r.players.map((p: Rec) => [p.role, p.code]))))).toEqual(expectedRelations());
    const review = data.relations.find((r: Rec) => r.type === "authority-review" && r.players.some((p: Rec) => p.code === "ORG-CMA"));
    expect(Object.fromEntries(review.players.map((p: Rec) => [p.role, p.code]))).toEqual({ reviewer: "ORG-CMA", subject: "CP-CMA", applicant: "ORG-NOV" });
    const mandate = data.relations.find((r: Rec) => r.key === "MAN-BWM");
    expect(Object.fromEntries(mandate.players.map((p: Rec) => [p.role, p.kind])).engagement).toBe("relation"); // the deal is a relation
    expect(mandate.attributes["mandate-type"]).toBe("Legal and competition counsel");
    const stakes = Object.fromEntries(data.relations.filter((r: Rec) => r.type === "ownership").map((r: Rec) =>
      [`${r.players.find((p: Rec) => p.role === "owner").code}|${r.players.find((p: Rec) => p.role === "owned").code}`, new Exact(r.attributes.stake).toString()]));
    expect(stakes).toEqual(Object.fromEntries(SEED.ownership.map((o: Rec) => [`${o.owner}|${o.owned}`, new Exact(o.stake).toString()])));
    expect(data.types.relations.mandate.roles).toEqual(["adviser", "client", "engagement"]);
    expect(data.types.relations.acquisition).toEqual({ parent: "transaction", roles: ["acquirer", "target"] });
  });

  test("clusters", async () => {
    const nodes: Record<string, string> = Object.fromEntries((await c.ok("/api/graph")).data.nodes.map((n: Rec) => [n.code, n.cluster]));
    const group = new Set(Object.keys(effectiveStakes(SEED, DEAL.target)));
    expect(nodes[DEAL.acquirer]).toBe("acquirer");
    expect(nodes[DEAL.target]).toBe("target");
    expect(new Set(Object.entries(nodes).filter(([, k]) => k === "target-group").map(([x]) => x))).toEqual(group);
    expect(new Set(Object.entries(nodes).filter(([, k]) => k === "outside-shareholders").map(([x]) => x))).toEqual(
      new Set(SEED.ownership.filter((o: Rec) => group.has(o.owned) && !group.has(o.owner) && o.owner !== DEAL.target).map((o: Rec) => o.owner)));
    for (const m of SEED.mandates) expect(nodes[m.adviser]).toBe(`advisers:${m.client}`);
    expect(new Set(Object.entries(nodes).filter(([, k]) => k === "lenders").map(([x]) => x))).toEqual(new Set(SEED.financing.map((f: Rec) => f.lender)));
    expect(new Set(Object.entries(nodes).filter(([, k]) => k === "authorities").map(([x]) => x))).toEqual(
      new Set(Object.entries(ORGS).filter(([, o]) => o.type === "regulator" || o.type === "court").map(([x]) => x)));
    expect(Object.values(nodes)).not.toContain("other");
  });
});

function letters(holder: string): Set<string> {
  const out = new Set<string>();
  for (const [item, ls] of Object.entries(SEED.raci as Record<string, Rec>)) {
    for (const [letter, hs] of Object.entries(ls)) if (holders(hs as string | string[]).includes(holder)) out.add(`${letter}|${item}`);
  }
  return out;
}

describe("one node", () => {
  test("node detail for an adviser", async () => {
    const body = await c.ok("/api/graph/node/ORG-BWM");
    const d = body.data;
    expect([d.name, d.type]).toEqual(["Blackwood Marsh LLP", "law-firm"]);
    const mandate = d.relations.find((r: Rec) => r.type === "mandate");
    expect(mandate.role).toBe("adviser");
    expect(new Set(mandate.others.map((o: Rec) => `${o.role}|${o.code}`))).toEqual(new Set(["client|ORG-NOV", "engagement|DEAL-APEX"]));
    const staff = SEED.people.filter((p: Rec) => p.employer === "ORG-BWM");
    expect(d.people.map((p: Rec) => p.code).sort()).toEqual(staff.map((p: Rec) => p.code).sort());
    for (const p of d.people) {
      expect(new Set(p.raci.map((r: Rec) => `${r.letter}|${r.item.code}`))).toEqual(letters(p.code));
      expect(new Set(p.raci.map((r: Rec) => r.via))).toEqual(new Set(["MAN-BWM"]));
    }
    expect(body.parameters).toEqual({ code: "ORG-BWM" });
    expect(body.typeql.every((q: string) => q.includes('"ORG-BWM"'))).toBe(true);
  });

  test("node detail for a person and an authority", async () => {
    const shaw = (await c.ok("/api/graph/node/PER-SHAW")).data;
    expect(shaw.type).toBe("person");
    expect(shaw.people).toEqual([]);
    expect(new Set(shaw.raci.map((r: Rec) => `${r.letter}|${r.item.code}`))).toEqual(letters("PER-SHAW"));
    const eventTypes = new Set(["deal-event", "response", "meeting", "delivery", "decision", "request", "notice", "status-change"]);
    expect(shaw.relations.some((r: Rec) => eventTypes.has(r.type))).toBe(false); // history belongs to the Parties page, not here
    const cma = (await c.ok("/api/graph/node/ORG-CMA")).data;
    const review = cma.relations.find((r: Rec) => r.type === "authority-review");
    expect(review.role).toBe("reviewer");
    expect(new Set(review.others.map((o: Rec) => `${o.role}|${o.code}`))).toEqual(new Set(["subject|CP-CMA", "applicant|ORG-NOV"]));
    const helix = (await c.ok("/api/graph/node/ORG-HELIX")).data;
    const types = new Set(helix.relations.map((r: Rec) => r.type));
    expect(types.has("ownership") && types.has("consent-right")).toBe(true);
    expect((await c.get("/api/graph/node/ORG-NOPE")).status).toBe(404);
    expect((await c.get("/api/graph/node/nope")).status).toBe(422);
  });
});

describe("group ownership", () => {
  test("defaults to the target and matches the oracle", async () => {
    const body = await c.ok("/api/ownership");
    const data = body.data;
    expect(data.parent).toBe(DEAL.target);
    expect(body.parameters).toEqual({});
    const stakes = effectiveStakes(SEED, DEAL.target);
    const routes = ownershipRoutes(SEED, DEAL.target);
    expect(Object.fromEntries(data.companies.map((x: Rec) => [x.code, [new Exact(x.stake).toString(), x.routes]]))).toEqual(
      Object.fromEntries(Object.entries(stakes).map(([k, [s, n]]) => [k, [s.toString(), n]])));
    for (const x of data.companies) {
      expect(x.paths.map((p: Rec) => new Exact(p.stake).toString()).sort()).toEqual(routes[x.code]!.map((r) => r.toString()).sort());
      for (const p of x.paths) {
        expect(p.steps[0].owner).toBe(DEAL.target);
        expect(p.steps.at(-1).owned).toBe(x.code);
        const product = p.steps.reduce((acc: Exact, s: Rec) => acc.times(new Exact(s.stake)), new Exact("1"));
        expect(product.equals(p.stake)).toBe(true);
      }
    }
  });

  test("headline figures", async () => {
    // The two figures the demo relies on: 90% of Atlas IP Holdings via two routes, 60% of the JV.
    const companies: Record<string, Rec> = Object.fromEntries((await c.ok("/api/ownership")).data.companies.map((x: Rec) => [x.code, x]));
    const ip = companies["ORG-ATL-IP"]!;
    expect([new Exact(ip.stake).toString(), ip.routes]).toEqual(["0.9", 2]);
    expect(ip.paths.map((p: Rec) => new Exact(p.stake).toString()).sort()).toEqual(["0.2", "0.7"]);
    expect(ip.paths.map((p: Rec) => p.steps.length).sort()).toEqual([2, 3]);
    const jv = companies["ORG-ATL-JV"]!;
    expect([new Exact(jv.stake).toString(), jv.routes]).toEqual(["0.6", 1]);
    expect(jv.paths[0].steps.map((s: Rec) => s.owned)).toEqual(["ORG-ATL-UK", "ORG-ATL-IE", "ORG-ATL-JV"]);
  });

  test("direct stakes and outside shareholders", async () => {
    const data = (await c.ok("/api/ownership")).data;
    const group = new Set(Object.keys(effectiveStakes(SEED, DEAL.target)));
    const expected = new Set(SEED.ownership.filter((o: Rec) => group.has(o.owned)).map((o: Rec) => `${o.owner}|${o.owned}|${new Exact(o.stake)}`));
    expect(new Set(data.direct.map((d: Rec) => `${d.owner}|${d.owned}|${new Exact(d.stake)}`))).toEqual(expected);
    expect(data.outside_shareholders.map((o: Rec) => o.code)).toEqual(["ORG-CALDER", "ORG-HELIX"]);
    expect(new Set(data.direct.filter((d: Rec) => !d.inside_group).map((d: Rec) => d.owner))).toEqual(new Set(["ORG-CALDER", "ORG-HELIX"]));
    const typeql: string[] = (await c.ok("/api/ownership")).typeql;
    const guards = typeql.map((q, i) => (q.includes("ownership_cycles()") || q.includes("> 1.0dec") ? i : -1)).filter((i) => i >= 0);
    const figures = typeql.map((q, i) => (q.includes("group_members(") ? i : -1)).filter((i) => i >= 0);
    expect(guards.length).toBeGreaterThanOrEqual(2);
    expect(guards[1]!).toBeLessThan(Math.min(...figures)); // both guards run before any figure
  });
});

describe("guards stay active", () => {
  test("a cycle blocks ownership figures but not the graph", async () => {
    const db = await freshSeeded();
    try {
      await write(db, `
        match $a isa company, has code "ORG-ATL-JV"; $b isa company, has code "ORG-ATL-UK";
        insert ownership (owner: $a, owned: $b), has stake 0.05dec;`);
      const own = await client(db).get("/api/ownership");
      const graph = await client(db).get("/api/graph");
      expect(own.status).toBe(409);
      expect(own.body).not.toHaveProperty("data");
      expect(own.body.cycles.length).toBeGreaterThan(0);
      expect(graph.status).toBe(200); // the network itself has no percentages to get wrong
      expect(graph.body.data.relations.filter((r: Rec) => r.type === "ownership")).toHaveLength(SEED.ownership.length + 1);
    } finally {
      await drop(db);
    }
  });

  test("an over-owned company blocks ownership figures", async () => {
    const db = await freshSeeded();
    try {
      await write(db, `
        match $a isa company, has code "ORG-HELIX"; $b isa company, has code "ORG-ATL-IP";
        insert ownership (owner: $a, owned: $b), has stake 0.3dec;`);
      const r = await client(db).get("/api/ownership");
      expect(r.status).toBe(409);
      expect(r.body.over_owned).toEqual({ "ORG-ATL-IP": "1.3" });
    } finally {
      await drop(db);
    }
  });
});
