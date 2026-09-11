const UPSTREAM = "https://file.xkji.com/xiaomi/api/issue";
const ORIGIN = "https://odin.androidflash.xyz";
const HOSTS = new Set([
  "bkt-sgp-miui-ota-update-alisgp.oss-ap-southeast-1.aliyuncs.com",
  "github.com",
  "objects.githubusercontent.com",
  "release-assets.githubusercontent.com",
  "file.xkji.com",
]);
const PASS = [
  "content-type",
  "content-length",
  "content-range",
  "accept-ranges",
  "etag",
  "last-modified",
];

function cors() {
  return new Headers({
    "Access-Control-Allow-Origin": ORIGIN,
    "Access-Control-Allow-Methods": "GET, HEAD, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Range",
    "Access-Control-Expose-Headers": "Content-Length, Content-Range, Accept-Ranges",
    Vary: "Origin",
  });
}

async function issue(request) {
  if (request.method !== "POST")
    return new Response("Method Not Allowed", { status: 405, headers: cors() });
  const upstream = await fetch(UPSTREAM, {
    method: "POST",
    body: request.body,
    headers: { "Content-Type": request.headers.get("Content-Type") || "" },
  });
  const headers = cors();
  headers.set(
    "Content-Type",
    upstream.headers.get("Content-Type") || "application/json",
  );
  return new Response(upstream.body, { status: upstream.status, headers });
}

async function download(request, url) {
  if (request.method !== "GET" && request.method !== "HEAD")
    return new Response("Method Not Allowed", { status: 405, headers: cors() });
  const target = url.searchParams.get("url");
  let parsed;
  try {
    parsed = new URL(target);
  } catch {
    return new Response("Invalid url", { status: 400, headers: cors() });
  }
  if (parsed.protocol !== "https:" || !HOSTS.has(parsed.hostname))
    return new Response(`Host not allowed: ${parsed.hostname}`, {
      status: 403,
      headers: cors(),
    });
  const forward = new Headers();
  const range = request.headers.get("Range");
  if (range) forward.set("Range", range);
  const upstream = await fetch(parsed.toString(), {
    method: request.method,
    headers: forward,
    redirect: "follow",
  });
  const headers = cors();
  for (const name of PASS) {
    const value = upstream.headers.get(name);
    if (value) headers.set(name, value);
  }
  return new Response(request.method === "HEAD" ? null : upstream.body, {
    status: upstream.status,
    headers,
  });
}

export default {
  async fetch(request) {
    const url = new URL(request.url);
    if (request.method === "OPTIONS")
      return new Response(null, { status: 204, headers: cors() });
    if (url.pathname === "/api/issue") return issue(request);
    if (url.pathname === "/api/fetch") return download(request, url);
    return new Response("Not Found", { status: 404, headers: cors() });
  },
};
