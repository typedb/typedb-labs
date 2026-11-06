# Contributing to Project Apex

Thank you for your interest. Apex is a reference demonstration of TypeDB 3.x, so changes are judged by
whether they keep it **correct, honest and easy to follow**.

## Getting set up

1. Start the stack: `docker compose up -d --build` (see the README for prerequisites and ports).
2. Install [Node.js](https://nodejs.org/) 22.6 or later (24 recommended), then `npm install` in `api/`.
3. Run the checks:

```bash
cd web && npm ci && npm run build          # build the frontend (also enables the bundle scan test)
cd api && npm run typecheck && npm test    # tsc, then ~290 tests on throwaway apex-test-* databases
```

Both must pass before a pull request is merged.

## Ground rules

- **TypeDB 3.x only.** 2.x syntax (rules, `thing`, old driver calls) does not work. Check syntax against
  https://typedb.com/docs and run it against the real server.
- **The app stays read-only.** The API uses READ transactions only; TypeDB is the only database.
- **All TypeQL lives in `api/src/queries.ts`** (the loader's inserts in `api/src/seed.ts`), and text goes into a
  query only through `string()` from `api/src/typedb.ts`.
- **The API core stays runtime-neutral.** `api/src/app.ts` and what it imports use web-standard APIs only (no
  `node:` imports, no file reads at request time), so the same code runs under Node and on Netlify's edge.
- **No business data in the frontend.** Every figure comes from the API; tests scan the source and bundle.
- **Schema changes are new files** in `schema/migrations/`; never edit one that has been applied.
- **Never weaken a check to make data load or a test pass.** If a check fails, fix the data or the code.
- **Fictional data stays fictional and labelled.** New organisations or people must be invented, checked
  against the Companies House register, and use `.example` email domains and the 07700 900xxx drama number
  range. Real public authorities may appear only in their real roles, in an invented scenario. Propose
  dataset changes in an issue first, and keep `docs/dataset.md` and the tests' answer keys in step.
- After editing `data/seed/*.yaml`, run `npm run export-seed-tql` (in `api/`); after editing `schema/` or
  `config/`, `npm run gen`; after changing an answer's shape, edit `web/openapi.json` by hand and run
  `npm run gen:api` in `web/`.

## Pull requests

Keep each pull request to one change, explain what it does and how you verified it, and add or update tests
(answer keys come from `api/tests/oracle.ts`, which must not share code with `api/src/`). By contributing you agree
that your contribution is licensed under the Apache License 2.0, like the rest of the project.

Security problems: please follow [SECURITY.md](SECURITY.md) instead of opening a public issue.
