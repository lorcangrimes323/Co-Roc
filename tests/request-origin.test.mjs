import assert from "node:assert/strict";
import test from "node:test";
import { hasTrustedRequestOrigin } from "../app/request-origin.ts";

function request(url, origin, forwardedHost, header = "x-co-roc-public-host") {
  const headers = new Headers();
  if (origin) headers.set("origin", origin);
  if (forwardedHost) headers.set(header, forwardedHost);
  return new Request(url, { headers });
}

test("accepts direct and trusted forwarded origins", () => {
  assert.equal(hasTrustedRequestOrigin(request("https://worker.example/api/auth", null, null)), true);
  assert.equal(hasTrustedRequestOrigin(request("https://worker.example/api/auth", "https://worker.example", null)), true);
  assert.equal(hasTrustedRequestOrigin(request("https://worker.example/api/auth", "https://www.co-roc.com", "www.co-roc.com")), true);
  assert.equal(hasTrustedRequestOrigin(request("https://worker.example/api/auth", "https://co-roc.com", "co-roc.com, proxy.internal")), true);
  assert.equal(hasTrustedRequestOrigin(request("https://worker.example/api/auth", "https://www.co-roc.com", "www.co-roc.com", "x-forwarded-host")), true);
});

test("rejects spoofed, mismatched and insecure forwarded origins", () => {
  assert.equal(hasTrustedRequestOrigin(request("https://worker.example/api/auth", "https://evil.example", "evil.example")), false);
  assert.equal(hasTrustedRequestOrigin(request("https://worker.example/api/auth", "https://www.co-roc.com", "co-roc.com")), false);
  assert.equal(hasTrustedRequestOrigin(request("https://worker.example/api/auth", "http://www.co-roc.com", "www.co-roc.com")), false);
  assert.equal(hasTrustedRequestOrigin(request("https://worker.example/api/auth", "not a URL", "www.co-roc.com")), false);
});
