// Serves the built site (dist/) at http://localhost:8765 for local viewing. Each lab's API calls
// (/<lab>/api/*) are forwarded to the deployed site, so the labs show live data without a local TypeDB.
// Run `npm run build` first; `npm run serve` starts this.

import { createServer } from "node:http";
import { existsSync, readFileSync, statSync } from "node:fs";
import { extname, resolve, sep } from "node:path";

const DEPLOYED = process.env.LABS_API_ORIGIN ?? "https://labs.typedb.com";
const PORT = Number(process.env.PORT ?? 8765);
const dist = resolve(import.meta.dirname, "../dist");

const TYPES = {
  ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript", ".json": "application/json",
  ".svg": "image/svg+xml", ".png": "image/png", ".woff2": "font/woff2", ".ttf": "font/ttf", ".glb": "model/gltf-binary",
};

const isFile = (path) => existsSync(path) && statSync(path).isFile();

createServer(async (req, res) => {
  const { pathname, search } = new URL(req.url, "http://localhost");

  if (/^\/[^/]+\/api\//.test(pathname)) {
    try {
      const answer = await fetch(DEPLOYED + pathname + search);
      res.writeHead(answer.status, { "content-type": answer.headers.get("content-type") ?? "application/json" });
      res.end(Buffer.from(await answer.arrayBuffer()));
    } catch (error) {
      res.writeHead(502).end(`Could not reach ${DEPLOYED}: ${error.message}`);
    }
    return;
  }

  // A file, a folder's index, or (each lab being a single-page app) the index of the lab the path is in.
  const path = resolve(dist, "." + decodeURIComponent(pathname));
  const lab = pathname.split("/")[1];
  const file = [path, resolve(path, "index.html"), resolve(dist, lab, "index.html")]
    .find((candidate) => candidate.startsWith(dist + sep) && isFile(candidate));
  if (!file) return res.writeHead(404).end("Not found");
  res.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream" });
  res.end(readFileSync(file));
}).listen(PORT, "127.0.0.1", () => console.log(`Labs site on http://localhost:${PORT} (API calls go to ${DEPLOYED})`));
