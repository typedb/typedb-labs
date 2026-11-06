// Display formatting only: turns TypeDB type and attribute labels into readable text. No domain facts here.

const UNITS: [RegExp, string][] = [
  [/-kwh$/, "kWh"], [/-kw$/, "kW"], [/-nm$/, "N·m"], [/-mm$/, "mm"], [/-v$/, "V"], [/-m$/, "m"],
];
const NAMES: Record<string, string> = {
  "material-name": "Material", "size-designation": "Size", "piston-count": "Pistons", "nominal-voltage-v": "Voltage",
  "energy-capacity-kwh": "Energy", "sensing-range-m": "Range",
};

/** "peak-torque-nm" -> "Peak torque", "diameter-mm" -> "Diameter" */
export function attributeLabel(attribute: string) {
  if (NAMES[attribute]) return NAMES[attribute];
  const bare = UNITS.reduce((s, [re]) => s.replace(re, ""), attribute);
  return words(bare);
}

/** A property value with the unit its attribute name carries: 380 + "diameter-mm" -> "380 mm" */
export function attributeValue(attribute: string, value: string | number) {
  const unit = UNITS.find(([re]) => re.test(attribute))?.[1];
  const shown = typeof value === "number" ? Number(value.toFixed(2)).toLocaleString("en-GB") : value;
  return unit ? `${shown} ${unit}` : String(shown);
}

/** "brake-caliper" -> "Brake caliper" */
export function words(label: string) {
  const text = label.replace(/-/g, " ").replace(/\bgnss\b/gi, "GNSS");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** "mechanical-connection" -> "Mechanical" */
export function connectionKind(label: string) {
  return words(label.replace(/-connection$/, ""));
}
