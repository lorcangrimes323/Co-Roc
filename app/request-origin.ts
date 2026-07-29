const TRUSTED_PUBLIC_HOSTS = new Set(["co-roc.com", "www.co-roc.com"]);

function normalizedHost(value: string | null) {
  return value?.split(",", 1)[0]?.trim().toLowerCase() ?? "";
}

export function hasTrustedRequestOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try {
    const originUrl = new URL(origin);
    const requestUrl = new URL(request.url);
    const originHost = originUrl.host.toLowerCase();
    const requestHost = requestUrl.host.toLowerCase();
    if (originHost === requestHost && originUrl.protocol === requestUrl.protocol) return true;

    const forwardedHost = normalizedHost(
      request.headers.get("x-co-roc-public-host") ?? request.headers.get("x-forwarded-host"),
    );
    return originUrl.protocol === "https:"
      && originHost === forwardedHost
      && TRUSTED_PUBLIC_HOSTS.has(forwardedHost);
  } catch {
    return false;
  }
}
