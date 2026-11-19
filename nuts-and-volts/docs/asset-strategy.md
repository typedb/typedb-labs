# Asset strategy (Phase 1 decision, 29 October 2026)

**Decision: an original, procedurally generated, unbranded battery-electric SUV.** Approved by the project owner.

## Why not a Jaguar F-PACE model
- Marketplace F-PACE models (TurboSquid, RenderHub, CGTrader) cover exterior and interior only:
  no drivetrain, chassis, suspension or electronics.
- They are mostly licensed "editorial use only", which rules out marketing and investor use.
- The brief forbids implying manufacturer endorsement or inventing internals from photographs.

## Why not a purchased generic model
The strongest candidate, DOSCH "Car Details - Luxury SUV" (EUR 149, brand-neutral, GLB, electric
drivetrain parts), is licensed for a single user and forbids distributing it in any product from which
the model files can be extracted. A web app always sends its 3D files to the browser, so this would need
a special written licence from DOSCH. Not pursued for now.

## What we built instead
- Every part is generated in code and listed in one component manifest with stable ids.
- The renderer only depends on the manifest, so a licensed or commissioned model could replace the
  procedural geometry later without changing the semantic layer.
- Trade-off: the look is a premium concept / engineering visualisation, not a photograph of a real car.

## Proportions
Similar in size to a premium mid-size SUV: 2.874 m wheelbase, about 4.85 m long, 1.94 m wide,
1.63 m tall, 22-inch wheels. Right-hand drive. All dimensions are in `web/src/vehicle/dimensions.ts`.
