# Security

Project Apex is a **local demonstration** with fictional data. It is designed to run on one computer and is
not hardened for shared or public hosting.

## The security model

- **Local only.** Every published port is bound to 127.0.0.1: the app (8091) and TypeDB (1732 for the driver,
  8003 for Studio). The API has no published port; nginx forwards `/api/` to it on Compose's private network.
- **Read-only application.** The API only opens READ transactions and only answers GET requests (other methods
  get 405). Tests check that the API code contains no write transaction and that the data is unchanged after
  use. Writing happens only in the one-off `seed` step and the `scripts/` you run yourself.
- **Validated input.** Every parameter is checked against a fixed pattern, range or list of allowed values before any query runs
  (invalid values get 422), and text reaches TypeQL only through the escaping helper `apex.db.string`.
- **No secrets in the repository.** Settings come from environment variables or a git-ignored `.env`. The only
  credential-like value is TypeDB Community Edition's documented default password in `.env.example`, which is
  acceptable only because TypeDB is reachable from this computer alone.
- **Contact details masked on the server.** Fictional email addresses and phone numbers are masked before they
  leave the API.
- **Containers** run as ordinary (non-root) users, from images pinned to exact versions; JavaScript
  packages are installed from lockfiles (`api/package-lock.json`, `web/package-lock.json`).
- **Image scan** (Trivy 0.64.1, 2026-10-27): no critical findings. Every high finding with an available fix in
  the images Apex builds was fixed (pip and curl removed, brotli updated). Remaining high findings are Debian
  base packages with no fix released yet, and OpenSSL in the official TypeDB image, which the TypeDB server
  binary does not link; none is reachable through Apex.
- **Browser hardening.** nginx sends a strict Content-Security-Policy (the app's own files only, no framing),
  `X-Content-Type-Options: nosniff` and `Referrer-Policy: no-referrer`, and hides its version.
- **No sign-in, no user management, no email or messaging, no AI model, no outbound calls** at runtime.

## Before running Apex anywhere shared

Change the TypeDB password (`TYPEDB_PASSWORD` in `.env`, and the server's own admin password), put the app
behind your own authentication and TLS, and review the ports in `compose.yaml`. None of this is provided.

## Reporting a problem

Please report security problems privately, using **"Report a vulnerability"** on this repository's GitHub
Security tab, rather than in a public issue. Include what you found, how to reproduce it, and the commit you
tested. This is a demonstration project maintained on a best-effort basis; there is no bug bounty.
