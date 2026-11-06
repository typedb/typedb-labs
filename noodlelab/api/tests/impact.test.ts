// Failure impact, function by function (docs/dependency-semantics.md, C1).
//
// 1. The ten representative failures, exactly as written in the expected-outcomes table before implementation.
// 2. An independent oracle: the same rules worked out from the seed files, for EVERY component as the
//    failed part, compared with TypeDB's answer. The oracle checks fallbacks exactly (a backup only counts if it
//    keeps all its functions in that failure), so agreement also confirms the simpler rule in TypeDB is sound here.

import { describe, expect, it } from "vitest";
import type { Doc } from "../src/queries.ts";
import { value } from "../src/typedb.ts";
import { client, connection, database, subset } from "./helpers.ts";
import { CORNERS, DEPS, IDS, oracle, pair, triple } from "./oracle.ts";

type Sets = { lost: Set<string>; degraded: Set<string>; fallbacks: Set<string> };

async function impact(cid: string): Promise<Sets> {
  const data = (await client(database()).get(`/api/components/${cid}/impact`)).data;
  return {
    lost: new Set((data.lost as Doc[]).map((x) => pair(x.id, x.function))),
    degraded: new Set((data.degraded as Doc[]).map((x) => pair(x.id, x.function))),
    fallbacks: new Set((data.fallbacks as Doc[]).map((f) => triple(f.id, f.function, f.backup))),
  };
}

const union = (...sets: Set<string>[]) => new Set(sets.flatMap((s) => [...s]));
const allCorners = (component: string, fn: string) => new Set(CORNERS.map((c) => pair(`${component}-${c}`, fn)));
const set = (...pairs: [string, string][]) => new Set(pairs.map(([c, f]) => pair(c, f)));
const componentOf = (key: string) => key.split(" | ")[0];
const functionOf = (key: string) => key.split(" | ")[1];
const sortedList = (s: Iterable<string>) => [...s].sort();
/** Python's `a <= b`: a is a subset of b. */
const expectSubset = (a: Set<string>, b: Set<string>) => expect(sortedList([...a].filter((x) => !b.has(x))), "missing").toEqual([]);
const expectSame = (a: Set<string>, b: Set<string>) => expect(sortedList(a)).toEqual(sortedList(b));
const expectNone = (items: Iterable<string>) => expect(sortedList(items)).toEqual([]);

async function propulsion(cid: string): Promise<[Record<string, string>, string]> {
  const p = (await client(database()).get(`/api/components/${cid}/impact`)).data.propulsion;
  return [Object.fromEntries(p.axles.map((a: Doc) => [a.system, a.state])), p.vehicle];
}

function rearOrFront(keys: Set<string>, axle: "front" | "rear"): string[] {
  const ends = axle === "rear" ? ["-rl", "-rr"] : ["-fl", "-fr"];
  return [...keys].filter((k) => componentOf(k).startsWith(`${axle}-`) || ends.some((e) => componentOf(k).endsWith(e)));
}

/** Affected (component, function) pairs belonging to any other wheel corner. */
function others(keys: Set<string>, corner: string): string[] {
  return [...keys].filter((k) => CORNERS.some((c) => c !== corner && componentOf(k).endsWith(`-${c}`)));
}

// ---- 1. The expected-outcomes table ---------------------------------------------------------------------------

describe("failure impact: the expected-outcomes table", () => {
  it("1. wheel speed sensor", async () => {
    const { lost, degraded } = await impact("wheel-speed-sensor-fl");
    expectSame(lost, set(["esc-module", "anti-lock braking"], ["esc-module", "stability control"],
      ["vcu", "traction control"], ["ad-compute", "automated driving"]));
    expect(degraded.size).toBe(0);
    expect(union(lost, degraded).has(pair("esc-module", "brake pressure"))).toBe(false);
    expectNone([...lost].filter((k) => ["clamping force", "drive torque", "friction braking"].includes(functionOf(k))));
  });

  it("2. brake booster", async () => {
    const { lost, degraded, fallbacks } = await impact("brake-booster");
    expectSame(lost, set(["ad-compute", "automated driving"]));
    expectSubset(allCorners("caliper", "clamping force"), degraded);
    expectSubset(set(["master-cylinder", "brake pressure"], ["esc-module", "brake pressure"]), degraded);
    expectSubset(allCorners("brake-hose", "brake pressure"), degraded);
    expect(fallbacks.has(triple("master-cylinder", "brake pressure", "brake-pedal"))).toBe(true);
  });

  it("3. twelve volt battery", async () => {
    const { lost, degraded, fallbacks } = await impact("lv-battery");
    expectSubset(set(["lv-harness", "12 V distribution"], ["bms", "battery supervision"], ["hv-junction-box", "HV supply"],
      ["esc-module", "anti-lock braking"], ["brake-booster", "brake assistance"],
      ["steering-rack", "steering assistance"], ["ad-compute", "automated driving"]), lost);
    expectSubset(allCorners("tyre", "drive torque"), lost);
    expectSubset(allCorners("caliper", "clamping force"), degraded);
    expectNone([...lost].filter((k) => ["clamping force", "friction braking", "steering motion"].includes(functionOf(k))));
    expect(fallbacks.has(triple("master-cylinder", "brake pressure", "brake-pedal"))).toBe(true);
  });

  it("4. coolant pump", async () => {
    const { lost, degraded } = await impact("coolant-pump");
    // revised in C3a: the drive units' oil coolers reject their heat into the same coolant;
    // revised in C3c step 5: separate coolant lines to each drive unit
    expectSame(lost, set(["coolant-lines", "coolant flow"], ["front-coolant-lines", "coolant flow"], ["rear-coolant-lines", "coolant flow"],
      ["battery-coolant-manifold", "coolant flow"], ["battery-cooling-plate", "cell cooling"],
      ["front-oil-cooler", "oil cooling"], ["rear-oil-cooler", "oil cooling"]));
    expectSubset(new Set(Array.from({ length: 16 }, (_, i) => pair(`battery-module-${i + 1}`, "cell power"))), degraded);
    expectSubset(set(["front-stator", "magnetic field"], ["rear-stator", "magnetic field"]), degraded);
    expectSubset(allCorners("tyre", "drive torque"), degraded);
  });

  it("5. power steering motor", async () => {
    const { lost, degraded } = await impact("eps-motor");
    expectSame(lost, set(["steering-rack", "steering assistance"], ["ad-compute", "automated driving"]));
    expect(degraded.size).toBe(0);
  });

  it("6. front gate driver", async () => {
    const { lost, degraded } = await impact("front-gate-driver");
    expectSubset(set(["tyre-fl", "drive torque"], ["tyre-fr", "drive torque"], ["front-power-module", "phase current"]), lost);
    expectNone([...union(lost, degraded)].filter((k) => componentOf(k).startsWith("rear-") || componentOf(k).endsWith("-rl") || componentOf(k).endsWith("-rr")));
  });

  it("7. one battery module", async () => {
    const { lost, degraded } = await impact("battery-module-5");
    expectSubset(set(["battery-busbar-l", "pack current"], ["hv-junction-box", "HV supply"]), lost);
    expectSubset(allCorners("tyre", "drive torque"), lost);
    expect(degraded.has(pair("battery-cooling-plate", "cell cooling"))).toBe(true);
    expectNone([...union(lost, degraded)].filter((k) => componentOf(k).startsWith("battery-module-")));
  });

  it("8. ESC module", async () => {
    // Revised in C3c step 4: the fail-open fallback sits on the rigid lines; the module also drives the parking brake.
    const { lost, degraded, fallbacks } = await impact("esc-module");
    expectSame(lost, set(["ad-compute", "automated driving"], ["epb-actuator-rl", "parking hold"], ["epb-actuator-rr", "parking hold"],
      ["caliper-rl", "parking clamp"], ["caliper-rr", "parking clamp"]));
    expectSubset(allCorners("caliper", "clamping force"), degraded);
    expectSubset(set(["tyre-rl", "vehicle holding"], ["tyre-rr", "vehicle holding"]), degraded);
    expectSubset(new Set(CORNERS.map((c) => triple(`brake-line-${c}`, "brake pressure", "master-cylinder"))), fallbacks);
  });

  it("9. one brake hose", async () => {
    const { lost, degraded } = await impact("brake-hose-fl");
    expectSame(lost, set(["caliper-fl", "clamping force"], ["brake-pad-inner-fl", "friction braking"], ["brake-pad-outer-fl", "friction braking"]));
    expect(degraded.size).toBe(0);
  });

  it("10. steering rack", async () => {
    // Revised in C3c step 2: without the rack the front wheels' steer angle is no longer held.
    const { lost } = await impact("steering-rack");
    expectSame(lost, set(["tie-rod-fl", "steering motion"], ["tie-rod-fr", "steering motion"], ["ad-compute", "automated driving"],
      ["knuckle-fl", "wheel alignment"], ["knuckle-fr", "wheel alignment"], ["tyre-fl", "road holding"], ["tyre-fr", "road holding"]));
  });
});

// ---- C3a: the drive units in detail (docs/dependency-semantics.md, scenarios 11-16) ---------------------------------

describe("failure impact: drive units (C3a)", () => {
  it("11. front resolver", async () => {
    const { lost, degraded } = await impact("front-resolver");
    expectSubset(set(["front-control-board", "motor control"], ["front-gate-driver", "switching control"],
      ["front-power-module", "phase current"], ["tyre-fl", "drive torque"], ["tyre-fr", "drive torque"]), lost);
    expectNone(rearOrFront(union(lost, degraded), "rear"));
  });

  it("12. rear oil pump", async () => {
    const { lost, degraded } = await impact("rear-oil-pump");
    expectSame(lost, set(["rear-oil-cooler", "oil cooling"]));
    expectSubset(set(["rear-stator", "magnetic field"], ["rear-intermediate-shaft", "drive torque"], ["rear-reduction-gear", "drive torque"],
      ["tyre-rl", "drive torque"], ["tyre-rr", "drive torque"]), degraded);
    expectNone(rearOrFront(union(lost, degraded), "front"));
  });

  it("13. front disconnect", async () => {
    const { lost, degraded } = await impact("front-disconnect");
    expectSubset(set(["front-intermediate-shaft", "drive torque"], ["front-reduction-gear", "drive torque"], ["front-differential", "drive torque"],
      ["front-halfshaft-l", "drive torque"], ["front-halfshaft-r", "drive torque"], ["tyre-fl", "drive torque"], ["tyre-fr", "drive torque"]), lost);
    expectNone([...union(lost, degraded)].filter((k) => ["front-stator", "front-rotor", "front-rotor-shaft"].includes(componentOf(k))));
    expectNone(rearOrFront(union(lost, degraded), "rear"));
  });

  it("14. rear left side gear (open differential)", async () => {
    // Revised in C3b: an open differential cannot drive either wheel when one side spins free.
    const { lost, degraded } = await impact("rear-side-gear-l");
    expectSubset(set(["rear-differential", "drive torque"], ["rear-spider-gears", "drive torque"], ["rear-side-gear-r", "drive torque"],
      ["rear-halfshaft-l", "drive torque"], ["rear-halfshaft-r", "drive torque"], ["rear-halfshaft-l", "reaction path"]), lost);
    expectSubset(new Set(["hub", "wheel", "tyre"].flatMap((p) => ["rl", "rr"].map((c) => pair(`${p}-${c}`, "drive torque")))), lost);
    expect(lost.has(pair("rear-halfshaft-r", "reaction path"))).toBe(false);
    expectNone([...union(lost, degraded)].filter((k) => ["wheel rotation", "clamping force", "friction braking", "steering motion"].includes(functionOf(k))));
    expectNone(rearOrFront(union(lost, degraded), "front"));
    expect(await propulsion("rear-side-gear-l")).toEqual([{ "front-axle-drive": "kept", "rear-axle-drive": "lost" }, "reduced"]);
  });

  it("17. front right drive shaft", async () => {
    const { lost, degraded } = await impact("front-halfshaft-r");
    expectSubset(set(["tyre-fl", "drive torque"], ["tyre-fr", "drive torque"], ["front-differential", "drive torque"]), lost);
    expectNone([...union(lost, degraded)].filter((k) => ["wheel rotation", "clamping force", "friction braking", "steering motion"].includes(functionOf(k))));
    expectNone(rearOrFront(union(lost, degraded), "rear"));
    expect(await propulsion("front-halfshaft-r")).toEqual([{ "front-axle-drive": "lost", "rear-axle-drive": "kept" }, "reduced"]);
    const components = (await client(database()).get("/api/components/front-halfshaft-r/impact")).data.components as Doc[];
    const hub = components.find((x) => x.id === "hub-fl")!;
    expect(hub.lost).toEqual(["drive torque"]);
    expect(hub.kept).toContain("wheel rotation");
  });

  it("18. rear left wheel bearing", async () => {
    const { lost, degraded } = await impact("wheel-bearing-rl");
    expectSame(lost, set(["hub-rl", "wheel rotation"]));
    expect(degraded.size).toBe(0);
    expect(await propulsion("wheel-bearing-rl")).toEqual([{ "front-axle-drive": "kept", "rear-axle-drive": "kept" }, "kept"]);
  });

  it("vehicle-level propulsion for earlier scenarios", async () => {
    expect(await propulsion("lv-battery")).toEqual([{ "front-axle-drive": "lost", "rear-axle-drive": "lost" }, "lost"]);
    expect(await propulsion("coolant-pump")).toEqual([{ "front-axle-drive": "reduced", "rear-axle-drive": "reduced" }, "reduced"]);
    expect((await propulsion("battery-module-5"))[1]).toBe("lost");
    expect(await propulsion("brake-hose-fl")).toEqual([{ "front-axle-drive": "kept", "rear-axle-drive": "kept" }, "kept"]);
  });

  it("15. rear park lock", async () => {
    // Revised in C3c step 4 (scenario 40): the park lock now holds the parked car, with the parking brake as backup;
    // driving is still unaffected.
    const { lost, degraded } = await impact("rear-park-lock");
    expect(lost.size).toBe(0);
    expectNone([...degraded].filter((k) => functionOf(k) !== "vehicle holding"));
  });

  it("16. front HV connector", async () => {
    const { lost, degraded } = await impact("front-hv-connector");
    expectSubset(set(["front-inverter-busbars", "DC supply"], ["front-dc-link-capacitor", "DC supply"], ["front-power-module", "phase current"],
      ["tyre-fl", "drive torque"], ["tyre-fr", "drive torque"]), lost);
    expectNone(rearOrFront(union(lost, degraded), "rear"));
  });
});

// ---- C3b: battery and high-voltage distribution (docs/dependency-semantics.md, scenarios 19-27) -----------------

const ALL_TYRES = allCorners("tyre", "drive torque");

describe("failure impact: battery and high voltage (C3b)", () => {
  it("19. pack fuse", async () => {
    const { lost, degraded } = await impact("pack-fuse");
    expectSubset(set(["main-contactor-pos", "HV switching"], ["hv-junction-box", "HV supply"], ["hv-harness-front", "HV distribution"],
      ["battery-rear-feed", "HV distribution"], ["pdu", "HV distribution"], ["hv-junction-box", "battery charging"]), lost);
    expectSubset(ALL_TYRES, lost);
    expectNone([...union(lost, degraded)].filter((k) => componentOf(k).startsWith("battery-module-") || componentOf(k) === "bms"));
    expect((await propulsion("pack-fuse"))[1]).toBe("lost");
  });

  it("20. module monitor", async () => {
    const { lost, degraded } = await impact("battery-monitor-3");
    expectSubset(set(["bms", "battery supervision"], ["main-contactor-pos", "HV switching"], ["main-contactor-neg", "HV switching"],
      ["hv-junction-box", "HV supply"]), lost);
    expectSubset(ALL_TYRES, lost);
    expectNone([...union(lost, degraded)].filter((k) => ["battery-module-5", "battery-module-6"].includes(componentOf(k))));
    expect((await propulsion("battery-monitor-3"))[1]).toBe("lost");
  });

  it("21. pack current sensor", async () => {
    const { lost, degraded } = await impact("pack-current-sensor");
    expect(lost.size).toBe(0);
    expectSubset(union(set(["bms", "battery supervision"], ["hv-junction-box", "HV supply"]), ALL_TYRES), degraded);
    expect(await propulsion("pack-current-sensor")).toEqual([{ "front-axle-drive": "reduced", "rear-axle-drive": "reduced" }, "reduced"]);
  });

  it("22. DC charge harness", async () => {
    const { lost, degraded, fallbacks } = await impact("hv-harness-charge");
    expectSame(lost, set(["battery-rear-feed", "DC charging"]));
    expectSame(degraded, set(["hv-junction-box", "battery charging"]));
    expect(fallbacks.has(triple("hv-junction-box", "battery charging", "obc"))).toBe(true);
    expect((await propulsion("hv-harness-charge"))[1]).toBe("kept");
  });

  it("22b. the charge port is a shared cause", async () => {
    // The on-board charger cannot stand in for DC charging when the charge port itself fails.
    const { lost, fallbacks } = await impact("charge-port");
    expectSubset(set(["hv-harness-charge", "DC charging"], ["battery-rear-feed", "DC charging"], ["obc", "AC charging"],
      ["hv-junction-box", "battery charging"]), lost);
    expect(fallbacks.size).toBe(0);
  });

  it("23. precharge", async () => {
    const { lost } = await impact("precharge-circuit");
    expectSubset(union(set(["main-contactor-pos", "HV switching"], ["hv-junction-box", "HV supply"]), ALL_TYRES), lost);
    expect((await propulsion("precharge-circuit"))[1]).toBe("lost");
  });

  it("24. rear feed", async () => {
    const { lost, degraded, fallbacks } = await impact("battery-rear-feed");
    expectSubset(set(["hv-harness-rear", "HV distribution"], ["tyre-rl", "drive torque"], ["tyre-rr", "drive torque"]), lost);
    expectNone([...union(lost, degraded)].filter((k) => ["tyre-fl", "tyre-fr"].includes(componentOf(k))));
    expect(await propulsion("battery-rear-feed")).toEqual([{ "front-axle-drive": "kept", "rear-axle-drive": "lost" }, "reduced"]);
    expect(degraded.has(pair("hv-junction-box", "battery charging"))).toBe(true);
    expect(fallbacks.has(triple("hv-junction-box", "battery charging", "obc"))).toBe(true);
  });

  it("25. LV fuse box", async () => {
    const { lost } = await impact("lv-fuse-box");
    expectSubset(union(set(["lv-harness", "12 V distribution"], ["bms", "battery supervision"], ["hv-junction-box", "HV supply"]), ALL_TYRES), lost);
    expect((await propulsion("lv-fuse-box"))[1]).toBe("lost");
  });

  it("26. DC-DC", async () => {
    const { lost, degraded } = await impact("dc-dc");
    expect(lost.size).toBe(0);
    expectSame(degraded, set(["lv-battery", "12 V supply"]));
    expect((await propulsion("dc-dc"))[1]).toBe("kept");
  });

  it("27. auxiliary harness", async () => {
    const { lost, degraded } = await impact("hv-harness-aux");
    expectSubset(set(["pdu", "HV distribution"], ["dc-dc", "12 V charging"], ["heat-pump-compressor", "refrigerant compression"],
      ["obc", "AC charging"]), lost);
    expectSubset(set(["lv-battery", "12 V supply"], ["battery-cooling-plate", "cell cooling"]), degraded);
    // corrected expectation (docs/dependency-semantics.md): degraded chilling does not reach the modules (C1 rule)
    expectNone([...union(lost, degraded)].filter((k) => functionOf(k) === "drive torque"));
    expect(await propulsion("hv-harness-aux")).toEqual([{ "front-axle-drive": "kept", "rear-axle-drive": "kept" }, "kept"]);
  });
});

// ---- C3c step 2: suspension (docs/dependency-semantics.md, scenarios 28-35) ----------------------------------------

describe("failure impact: suspension (C3c step 2)", () => {
  it("28. lower arm loses wheel location", async () => {
    const { lost, degraded } = await impact("lower-arm-fl");
    expectSame(lost, set(["knuckle-fl", "wheel location"], ["tyre-fl", "road holding"]));
    expect(degraded.size).toBe(0);
    expectNone([...lost].filter((k) => ["drive torque", "clamping force", "friction braking", "steering motion"].includes(functionOf(k))));
    expect((await propulsion("lower-arm-fl"))[1]).toBe("kept");
  });

  it("29. spring only degrades", async () => {
    const { lost, degraded } = await impact("spring-rr");
    expect(lost.size).toBe(0);
    expectSame(degraded, set(["tyre-rr", "road holding"]));
  });

  it("30. damper only degrades", async () => {
    const { lost, degraded } = await impact("coilover-fl");
    expect(lost.size).toBe(0);
    expectSame(degraded, set(["tyre-fl", "road holding"]));
  });

  it("31. drop link loses roll control, degrades the axle", async () => {
    const { lost, degraded } = await impact("drop-link-rl");
    expectSame(lost, set(["rear-anti-roll-bar", "roll control"]));
    expectSame(degraded, set(["tyre-rl", "road holding"], ["tyre-rr", "road holding"]));
  });

  it("32. subframe mount degrades the axle", async () => {
    const { lost, degraded } = await impact("front-subframe-mount-2");
    expect(lost.size).toBe(0);
    expectSubset(set(["front-subframe", "subframe location"], ["lower-arm-fl", "knuckle location"], ["lower-arm-fr", "knuckle location"],
      ["knuckle-fl", "wheel location"], ["knuckle-fr", "wheel location"], ["tyre-fl", "road holding"], ["tyre-fr", "road holding"]), degraded);
    expectNone([...degraded].filter((k) => componentOf(k).endsWith("-rl") || componentOf(k).endsWith("-rr") || componentOf(k).startsWith("rear-")));
  });

  it("33. tie rod loses that wheel's alignment", async () => {
    const { lost, degraded } = await impact("tie-rod-fr");
    expectSubset(set(["knuckle-fr", "wheel alignment"], ["tyre-fr", "road holding"]), lost);
    expectNone(others(union(lost, degraded), "fr"));
  });

  it("34. toe link loses that wheel's alignment", async () => {
    const { lost, degraded } = await impact("toe-link-rr");
    expectSame(lost, set(["knuckle-rr", "wheel alignment"], ["tyre-rr", "road holding"]));
    expect(degraded.size).toBe(0);
  });

  it("35. top mount", async () => {
    const { lost, degraded } = await impact("top-mount-fl");
    expectSame(lost, set(["spring-fl", "load support"], ["coilover-fl", "damping"]));
    expectSame(degraded, set(["tyre-fl", "road holding"]));
  });
});

// ---- C3c step 5: thermal circuits (docs/dependency-semantics.md, scenarios 45-49) -----------------------------------

const TEMPERATURE_CONSUMERS = set(["battery-coolant-manifold", "coolant flow"], ["front-power-module", "phase current"],
  ["rear-power-module", "phase current"], ["front-oil-cooler", "oil cooling"], ["rear-oil-cooler", "oil cooling"]);

describe("failure impact: thermal circuits (C3c step 5)", () => {
  it("45. radiator degrades coolant temperature", async () => {
    const { lost, degraded } = await impact("radiator");
    expect(lost.size).toBe(0);
    expectSubset(union(set(["coolant-valve", "coolant temperature"]), TEMPERATURE_CONSUMERS), degraded);
  });

  it("46. valve", async () => {
    const { lost, degraded } = await impact("coolant-valve");
    expect(lost.size).toBe(0);
    expectSubset(TEMPERATURE_CONSUMERS, degraded);
  });

  it("47. condenser", async () => {
    const { lost, degraded } = await impact("condenser");
    expectSubset(set(["refrigerant-lines", "refrigerant flow"], ["battery-chiller", "coolant chilling"], ["hvac-module", "cabin climate"]), lost);
    expect(degraded.has(pair("battery-cooling-plate", "cell cooling"))).toBe(true);
    expectNone([...union(lost, degraded)].filter((k) => functionOf(k) === "drive torque"));
  });

  it("48. coolant reservoir", async () => {
    const { lost, degraded } = await impact("coolant-reservoir");
    expect(lost.size).toBe(0);
    expectSubset(set(["coolant-pump", "coolant flow"], ["coolant-lines", "coolant flow"], ["front-coolant-lines", "coolant flow"],
      ["rear-coolant-lines", "coolant flow"]), degraded);
  });

  it("49. front coolant lines", async () => {
    const { lost, degraded } = await impact("front-coolant-lines");
    expectSame(lost, set(["front-oil-cooler", "oil cooling"]));
    expectSubset(set(["front-power-module", "phase current"], ["front-stator", "magnetic field"]), degraded);
    expectNone([...union(lost, degraded)].filter((k) => componentOf(k).startsWith("rear-") || componentOf(k).startsWith("battery-")
      || componentOf(k).endsWith("-rl") || componentOf(k).endsWith("-rr")));
  });
});

// ---- C3c step 4: braking supply and parking (docs/dependency-semantics.md, scenarios 40-44) -------------------------

const HOLDING = set(["tyre-rl", "vehicle holding"], ["tyre-rr", "vehicle holding"]);
const PARKING = new Set(["rear-park-lock", "epb-actuator-rl", "epb-actuator-rr"]);
const SERVICE = ["clamping force", "friction braking", "brake pressure"];

describe("failure impact: braking supply and parking (C3c step 4)", () => {
  it("40. park lock only degrades holding", async () => {
    const { lost, degraded, fallbacks } = await impact("rear-park-lock");
    expect(lost.size).toBe(0);
    expectSame(degraded, HOLDING);
    expectSubset(new Set([triple("tyre-rl", "vehicle holding", "epb-actuator-rl"), triple("tyre-rr", "vehicle holding", "epb-actuator-rr")]), fallbacks);
  });

  it("41. one parking brake", async () => {
    const { lost, degraded } = await impact("epb-actuator-rl");
    expectSame(lost, set(["caliper-rl", "parking clamp"]));
    expectSame(degraded, set(["tyre-rl", "vehicle holding"]));
  });

  it("42. twelve volt loses both parking mechanisms", async () => {
    const { lost } = await impact("lv-battery");
    expectSubset(union(HOLDING, set(["rear-park-lock", "parking hold"], ["epb-actuator-rl", "parking hold"], ["epb-actuator-rr", "parking hold"])), lost);
  });

  it("43. reservoir", async () => {
    const { lost, degraded } = await impact("brake-fluid-reservoir");
    expectSubset(set(["master-cylinder", "brake pressure"], ["esc-module", "brake pressure"]), lost);
    expectSubset(union(allCorners("brake-line", "brake pressure"), allCorners("caliper", "clamping force")), lost);
    expectNone([...union(lost, degraded)].filter((k) => ["vehicle holding", "parking hold", "parking clamp"].includes(functionOf(k))));
  });

  it("44. one brake line", async () => {
    const { lost, degraded } = await impact("brake-line-fl");
    expectSame(lost, set(["brake-hose-fl", "brake pressure"], ["caliper-fl", "clamping force"], ["brake-pad-inner-fl", "friction braking"],
      ["brake-pad-outer-fl", "friction braking"]));
    expect(degraded.size).toBe(0);
  });

  it("parking never backs up service braking", async () => {
    for (const d of DEPS) {
      if (SERVICE.includes(d.function)) expect(PARKING.has(d.fallback?.backup), JSON.stringify(d)).toBe(false);
    }
    for (const failed of ["master-cylinder", "esc-module", "brake-booster", "brake-hose-rl"]) {
      const { fallbacks } = await impact(failed);
      expectNone([...fallbacks].filter((f) => SERVICE.includes(f.split(" | ")[1]) && PARKING.has(f.split(" | ")[2])));
    }
  });
});

// ---- C3c step 3: steering (docs/dependency-semantics.md, scenarios 36-39) --------------------------------------------

const FRONT_STEERING_CHAIN = set(["steering-rack", "steering motion"], ["tie-rod-fl", "steering motion"], ["tie-rod-fr", "steering motion"],
  ["knuckle-fl", "wheel alignment"], ["knuckle-fr", "wheel alignment"], ["tyre-fl", "road holding"],
  ["tyre-fr", "road holding"], ["ad-compute", "automated driving"]);
const ASSISTANCE = set(["steering-ecu", "steering control"], ["eps-motor", "power assistance"], ["steering-rack", "steering assistance"]);

describe("failure impact: steering (C3c step 3)", () => {
  it("36. torque sensor stops assistance, not steering", async () => {
    const { lost, degraded } = await impact("steering-torque-sensor");
    expectSame(lost, union(ASSISTANCE, set(["ad-compute", "automated driving"])));
    expect(degraded.size).toBe(0);
  });

  it("37. intermediate shaft", async () => {
    const { lost, degraded } = await impact("steering-intermediate-shaft");
    expectSame(lost, union(FRONT_STEERING_CHAIN, ASSISTANCE, set(["steering-torque-sensor", "steering torque"])));
    expectNone([...union(lost, degraded)].filter((k) => componentOf(k).endsWith("-rl") || componentOf(k).endsWith("-rr")
      || ["caliper", "brake", "front-motor", "rear-"].some((p) => componentOf(k).startsWith(p))));
  });

  it("38. one rack mount only degrades", async () => {
    const { lost, degraded } = await impact("steering-rack-mount-l");
    expect(lost.size).toBe(0);
    expectSame(degraded, set(["steering-rack", "steering motion"]));
  });

  it("39. steering wheel", async () => {
    const { lost } = await impact("steering-wheel");
    expectSame(lost, union(FRONT_STEERING_CHAIN, ASSISTANCE, set(["steering-torque-sensor", "steering torque"],
      ["steering-column", "driver steering input"], ["steering-intermediate-shaft", "driver steering input"])));
  });

  it("the power steering loop has its sensor", async () => {
    const data = (await client(database()).get("/api/components/steering-torque-sensor/relationships")).data;
    expect(new Set(data["control-loops"].map((loop: Doc) => `${loop.name} / ${loop.role}`))).toEqual(new Set(["Electric power steering / sensor"]));
  });
});

// ---- D1.2: body structure load paths (docs/dependency-semantics.md, scenarios 50-54) --------------------------------

const towerLosses = (c: string) => set([`top-mount-${c}`, "body attachment"], [`upper-arm-${c}`, "knuckle location"], [`spring-${c}`, "load support"],
  [`coilover-${c}`, "damping"], [`knuckle-${c}`, "wheel location"], [`tyre-${c}`, "road holding"]);

describe("failure impact: body structure load paths (D1.2)", () => {
  it("50. front tower loses that corner", async () => {
    const { lost, degraded } = await impact("front-tower-r");
    expectSame(lost, towerLosses("fr"));
    expect(degraded.size).toBe(0);
  });

  it("51. front rail degrades the front axle", async () => {
    const { lost, degraded } = await impact("front-rail-r");
    expectSame(lost, set(["front-subframe-mount-2", "body mounting"]));
    expectSubset(set(["front-tower-r", "suspension mounting"], ["top-mount-fr", "body attachment"], ["upper-arm-fr", "knuckle location"],
      ["front-subframe", "subframe location"], ["knuckle-fl", "wheel location"], ["knuckle-fr", "wheel location"],
      ["tyre-fl", "road holding"], ["tyre-fr", "road holding"]), degraded);
    expectNone([...degraded].filter((k) => componentOf(k).endsWith("-rl") || componentOf(k).endsWith("-rr") || componentOf(k).startsWith("rear-")));
  });

  it("52. rear tower loses that corner", async () => {
    const { lost, degraded } = await impact("rear-tower-l");
    expectSame(lost, towerLosses("rl"));
    expect(degraded.size).toBe(0);
  });

  it("53. rear seat crossmember degrades the rear axle", async () => {
    const { lost, degraded } = await impact("floor-crossmember-3");
    expectSame(lost, set(["rear-subframe-mount-1", "body mounting"], ["rear-subframe-mount-2", "body mounting"]));
    expectSubset(set(["rear-subframe", "subframe location"], ["tyre-rl", "road holding"], ["tyre-rr", "road holding"]), degraded);
    expectSame(new Set([...allCorners("knuckle", "wheel location")].filter((k) => !degraded.has(k))),
      set(["knuckle-fl", "wheel location"], ["knuckle-fr", "wheel location"]));
    expectNone([...degraded].filter((k) => componentOf(k).endsWith("-fl") || componentOf(k).endsWith("-fr") || componentOf(k).startsWith("front-")));
  });

  it("54. front floor rail", async () => {
    const { lost, degraded } = await impact("front-floor-rail-r");
    expectSame(lost, set(["front-subframe-mount-4", "body mounting"]));
    expectSubset(set(["front-subframe", "subframe location"], ["tyre-fl", "road holding"], ["tyre-fr", "road holding"]), degraded);
    expectNone([...degraded].filter((k) => componentOf(k).includes("tower") || componentOf(k).endsWith("-rl") || componentOf(k).endsWith("-rr")));
  });

  it("the load-path question reaches the body", async () => {
    const data = (await client(database()).get("/api/questions/load-path")).data;
    const ids = new Set<string>(data.highlight);
    expect(subset(["tyre-fr", "knuckle-fr", "upper-arm-fr", "lower-arm-fr", "spring-fr", "top-mount-fr", "front-tower-r", "front-rail-r",
      "front-subframe", "front-floor-rail-r", "front-rail-l", "front-floor-rail-l"], ids)).toBe(true);
    expectNone([...ids].filter((i) => i.endsWith("-rl") || i.endsWith("-rr") || i.startsWith("rear-")));
    expect(data.summary.endsWith("Left front floor rail, Left front longitudinal rail, Right front floor rail, "
      + "Right front longitudinal rail")).toBe(true);
  });
});

// ---- 2. Independent oracle for every component ------------------------------------------------------------------

describe("failure impact: the oracle", () => {
  it("TypeDB matches the oracle for every failure", async () => {
    const mismatches: [string, string[]][] = [];
    // one read transaction per component: 850 recursive queries in one transaction can outlive its 60 s timeout
    for (const cid of IDS) {
      await connection.read(async (tx) => {
        const got = new Map<string, "lost" | "degraded">();
        for (const [fn, label] of [["degraded_steps", "degraded"], ["lost_steps", "lost"]] as const) {
          for (const r of await tx.docs<Doc>(`match $s isa component, has component-id "${cid}"; let $p, $g, $c, $f in ${fn}($s); `
            + 'fetch { "c": $c.component-id, "f": $f.function-name };')) {
            if (r.c !== cid) got.set(pair(r.c, r.f), label); // lost is written last, so it wins
          }
        }
        const expected = oracle(cid);
        const a = new Set([...got].map(([k, v]) => `${k} = ${v}`));
        const b = new Set([...expected].map(([k, v]) => `${k} = ${v}`));
        const diff = [...[...a].filter((x) => !b.has(x)), ...[...b].filter((x) => !a.has(x))].sort().slice(0, 4);
        if (diff.length) mismatches.push([cid, diff]);
      }, database());
    }
    expect(mismatches.slice(0, 5)).toEqual([]);
  });
});

// ---- 3. Model integrity -----------------------------------------------------------------------------------------

describe("failure impact: model integrity", () => {
  it("every dependency has a family, effect and functions", async () => {
    await connection.read(async (tx) => {
      const count = async (q: string) => value<number>((await tx.rows(`match ${q} reduce $n = count;`))[0], "n");
      const total = await count("$d isa dependency;");
      expect(total).toBe(DEPS.length);
      expect(await count("$d isa physical-dependency;") + await count("$d isa operational-dependency;") + await count("$d isa control-dependency;")).toBe(total);
      expect(await count("$d isa dependency, has loss-effect $e;")).toBe(total);
      expect(await count("$d isa dependency (affected-function: $f, required-function: $g);")).toBe(total);
    }, database());
  });

  it("fallbacks protect a loss", () => {
    const withFallback = DEPS.filter((d) => "fallback" in d);
    expect(withFallback.length).toBeGreaterThan(0);
    for (const dep of withFallback) {
      expect(dep.loss, `${dep.dependent}<-${dep.provider}`).toBe("lost");
      expect(dep.fallback.backup, `${dep.dependent}<-${dep.provider}`).not.toBe(dep.provider);
    }
  });

  it("function-level consequences per component", async () => {
    // A failure takes functions, not whole components: the ESC module keeps its brake pressure when a
    // wheel-speed sensor fails; the failed part itself loses everything it provides.
    const data = (await client(database()).get("/api/components/wheel-speed-sensor-fl/impact")).data;
    const esc = (data.components as Doc[]).find((x) => x.id === "esc-module")!;
    expect(new Set(esc.lost)).toEqual(new Set(["anti-lock braking", "stability control"]));
    expect(esc.kept).toContain("brake pressure");
    expect(esc.degraded).toEqual([]);
    expect(data.failed.functions).toEqual(["wheel speed"]);
    const rack = ((await client(database()).get("/api/components/eps-motor/impact")).data.components as Doc[]).find((x) => x.id === "steering-rack")!;
    expect(rack.lost).toEqual(["steering assistance"]);
    expect(rack.kept).toContain("steering motion");
  });
});
