// The current vehicle build, shared for inspection tools (devtools) without threading props through.

import type { Step } from "../vehicle/explode";
import type { LoadedParts } from "./assets";
import type { BuiltPart } from "./buildVehicle";

export const vehicleState: { built: BuiltPart[]; plan: Map<string, Step[]>; loaded: LoadedParts | null } = {
  built: [],
  plan: new Map(),
  loaded: null,
};
