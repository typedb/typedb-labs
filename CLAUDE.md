# TypeDB Labs: notes for AI coding agents

This repository hosts several independent demonstration projects ("labs") in sibling folders, served as
one site at labs.typedb.com. The README describes the shape every lab follows and how the site is built.

- Work inside the lab the task names (`apex/`, `noodlelab/`); each has its own README, docs and, for
  NoodleLab, its own CLAUDE.md with project rules. Treat labs as independent: no shared code between them.
- Backends are TypeScript on the TypeDB HTTP driver, written to run unbundled under Node 22.6+ (type
  stripping) and Deno: erasable syntax only, relative imports with `.ts` extensions, no Node-only APIs in
  `api/src/app.ts` or anything it imports. Python backends are not accepted.
- Web apps must work both at the site root (local Docker) and under their path (`VITE_BASE=/<lab>/`).
- Netlify specifics (edge functions, caching, env var prefixes) live only in `netlify/` and `netlify.toml`;
  a lab's own code knows nothing about them.
- No em dashes in docs, comments or pages.
