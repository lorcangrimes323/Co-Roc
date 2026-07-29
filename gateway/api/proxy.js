const UPSTREAM_ORIGIN = "https://co-roc.lorcangrimes32.workers.dev";
const HOP_BY_HOP_HEADERS = new Set([
  "connection",
  "content-encoding",
  "content-length",
  "expect",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

export const config = {
  api: { bodyParser: false },
  maxDuration: 60,
};

async function requestBody(request) {
  if (request.method === "GET" || request.method === "HEAD") return undefined;
  const chunks = [];
  for await (const chunk of request) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks);
}

export default async function handler(request, response) {
  const pathValue = Array.isArray(request.query.path)
    ? request.query.path.join("/")
    : request.query.path || "";
  const incomingUrl = new URL(request.url, "https://co-roc.com");
  incomingUrl.searchParams.delete("path");
  const upstreamUrl = new URL(`/${pathValue}`, UPSTREAM_ORIGIN);
  upstreamUrl.search = incomingUrl.search;

  const headers = new Headers();
  for (const [name, value] of Object.entries(request.headers)) {
    if (value == null || HOP_BY_HOP_HEADERS.has(name.toLowerCase()) || name.toLowerCase() === "host") continue;
    headers.set(name, Array.isArray(value) ? value.join(", ") : value);
  }
  headers.set("x-forwarded-host", request.headers.host || "co-roc.com");
  headers.set("x-co-roc-public-host", request.headers.host || "co-roc.com");

  const upstream = await fetch(upstreamUrl, {
    method: request.method,
    headers,
    body: await requestBody(request),
    redirect: "manual",
  });

  response.statusCode = upstream.status;
  for (const [name, value] of upstream.headers.entries()) {
    if (!HOP_BY_HOP_HEADERS.has(name.toLowerCase()) && name.toLowerCase() !== "set-cookie") {
      response.setHeader(name, value);
    }
  }
  const cookies = upstream.headers.getSetCookie?.() || [];
  if (cookies.length) response.setHeader("set-cookie", cookies);
  response.end(Buffer.from(await upstream.arrayBuffer()));
}
