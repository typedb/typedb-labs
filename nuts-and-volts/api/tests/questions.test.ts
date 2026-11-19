// The Questions tab's answers against oracles worked out from the seed files.

import { describe, expect, it } from "vitest";
import type { Doc } from "../src/queries.ts";
import { client, database, setEqual } from "./helpers.ts";
import { COMPONENTS, oracle, pair, RESOLVED, SEED } from "./oracle.ts";

const PROPS = RESOLVED.properties;

async function ask(qid: string): Promise<Doc> {
  const body = await client(database()).get(`/api/questions/${qid}`);
  expect(body.typeql.length).toBeGreaterThan(0);
  expect(body["timings-ms"].length).toBe(body.typeql.length);
  return body.data;
}

function counter(items: Iterable<string>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const i of items) out[i] = (out[i] ?? 0) + 1;
  return out;
}

describe("questions", () => {
  it("question list", async () => {
    const ids = ((await client(database()).get("/api/questions")).data as Doc[]).map((q) => q.id);
    expect(ids.length).toBe(9);
    expect(new Set(ids).size).toBe(9);
  });

  it("pack energy", async () => {
    const modules = [...COMPONENTS].filter(([, x]) => x.type === "battery-module").map(([id]) => id);
    const data = await ask("pack-energy");
    expect(data.rows).toEqual([[modules.length, modules.reduce((n, m) => n + Number(PROPS.get(m)!["energy-capacity-kwh"]), 0),
      modules.reduce((n, m) => n + Number(PROPS.get(m)!["nominal-voltage-v"]), 0)]]);
    expect(setEqual(data.highlight, modules)).toBe(true);
  });

  it("drive power", async () => {
    const motors = [...COMPONENTS].filter(([, x]) => x.type === "electric-motor").map(([id]) => id);
    const data = await ask("drive-power");
    expect(data.rows.reduce((n: number, r: number[]) => n + r[1], 0)).toBe(motors.reduce((n, m) => n + Number(PROPS.get(m)!["peak-power-kw"]), 0));
  });

  it("sensors by type", async () => {
    const sensorTypes = new Set(["camera", "radar", "lidar", "gnss-receiver", "wheel-speed-sensor", "position-sensor", "current-sensor", "cell-monitor", "torque-sensor"]);
    const expected = counter(SEED.components.filter((x) => sensorTypes.has(x.type)).map((x) => x.type));
    expect(Object.fromEntries((await ask("sensors-by-type")).rows)).toEqual(expected);
  });

  it("multi-system", async () => {
    const memberships = counter([...RESOLVED.members.values()].flat());
    expect(setEqual((await ask("multi-system")).highlight, Object.entries(memberships).filter(([, n]) => n > 1).map(([x]) => x))).toBe(true);
  });

  it("shared sensors", async () => {
    const counts = counter(RESOLVED.loops.flatMap((loop) => loop.sensors as string[]));
    expect(setEqual((await ask("shared-sensors")).highlight, Object.entries(counts).filter(([, n]) => n > 1).map(([s]) => s))).toBe(true);
  });

  it("connections by kind", async () => {
    const expected = counter(RESOLVED.connections.map((x) => x.kind));
    expect(Object.fromEntries((await ask("connections-by-kind")).rows)).toEqual(expected);
  });

  it("battery to wheel is a real chain", async () => {
    const deps = new Set(RESOLVED.dependencies.map((d) => [d.provider, d.needs, d.dependent, d.function].join(" | ")));
    const names = new Map<string, string>(SEED.components.map((x) => [x.name, x.id]));
    const split = (cell: string) => {
      const at = cell.lastIndexOf(": ");
      return [cell.slice(0, at), cell.slice(at + 2)];
    };
    const rows = ((await ask("battery-to-wheel")).rows as [number, string, string][]).map(([step, a, b]) => [step, ...split(a), ...split(b)] as const);
    expect(names.get(rows[0][1])!.startsWith("battery-module-")).toBe(true);
    expect(names.get(rows[rows.length - 1][3])).toBe("tyre-fl");
    for (const [, provider, supplies, dependent, fn] of rows) {
      expect(deps.has([names.get(provider), supplies, names.get(dependent), fn].join(" | "))).toBe(true);
    }
    for (let i = 1; i < rows.length; i++) expect(rows[i - 1][3]).toBe(rows[i][1]); // each step's dependent supplies the next step
  });

  it("propulsion single points match the failure oracle", async () => {
    const tyres = ["fl", "fr", "rl", "rr"].map((x) => pair(`tyre-${x}`, "drive torque"));
    const expected = [...COMPONENTS.keys()].filter((x) => {
      const o = oracle(x);
      return tyres.every((t) => o.get(t) === "lost");
    });
    expect(setEqual((await ask("propulsion-single-points")).highlight, expected)).toBe(true);
  });

  it("unknown question", async () => {
    expect((await client(database()).get("/api/questions/nonsense", 404)).error).toBe("not-found");
  });
});
