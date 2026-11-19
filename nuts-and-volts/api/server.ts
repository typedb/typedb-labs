// Local development server (Node 22.6+ / 24): `npm run dev`, or `npm start` without the file watcher.
// Wraps the runtime-neutral handler in
// node:http. Docker uses the same file. The API answers on 127.0.0.1 by default; Docker sets
// API_HOST=0.0.0.0 so the web container can reach it on Compose's private network.

import { createServer } from "node:http";
import { Readable } from "node:stream";
import { handle } from "./src/app.ts";
import { settingsFromEnv } from "./src/settings.ts";

const settings = settingsFromEnv((name) => process.env[name]);
const host = process.env.API_HOST ?? "127.0.0.1";
const port = Number(process.env.API_PORT ?? "8000");

createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  const request = new Request(url, { method: req.method, headers: req.headers as Record<string, string> });
  let response: Response;
  try {
    response = await handle(request, settings);
  } catch (error) {
    console.error(error);
    response = new Response(JSON.stringify({ detail: "Internal error" }), { status: 500, headers: { "content-type": "application/json" } });
  }
  res.writeHead(response.status, Object.fromEntries(response.headers));
  if (response.body) Readable.fromWeb(response.body as never).pipe(res);
  else res.end();
}).listen(port, host, () => console.log(`API listening on http://${host}:${port}`));
