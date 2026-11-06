// What the labs edge functions share: each project's API is written to live at /api on its own site, so
// the function strips the project's path prefix before handing the request over, reads that project's
// settings from prefixed env vars (two clusters, or one cluster with two databases, as you like), and
// marks successful answers as cacheable.

declare const Netlify: { env: { get(name: string): string | undefined } };

/** Reads `<prefix>NAME` from the site's env vars, falling back to plain `NAME`. */
export const prefixedEnv = (prefix: string) => (name: string) => Netlify.env.get(prefix + name) ?? Netlify.env.get(name);

/** The same request with `prefix` removed from the front of its path (/apex/api/deal -> /api/deal). */
export function stripPrefix(request: Request, prefix: string): Request {
  const url = new URL(request.url);
  if (url.pathname.startsWith(prefix)) url.pathname = url.pathname.slice(prefix.length) || "/";
  return new Request(url, request);
}

const CACHE_HEADERS = {
  "Netlify-CDN-Cache-Control": "public, s-maxage=86400, stale-while-revalidate=604800",
  "Cache-Control": "public, max-age=300",
};

/** Successful answers are cached on the CDN under `tag`; errors (such as 503 while the cluster is unreachable) are not. */
export function cached(response: Response, tag: string): Response {
  const headers = new Headers(response.headers);
  if (response.ok) {
    for (const [k, v] of Object.entries(CACHE_HEADERS)) headers.set(k, v);
    headers.set("Netlify-Cache-Tag", tag);
  } else headers.set("Cache-Control", "no-store");
  return new Response(response.body, { status: response.status, headers });
}
