/** Cloudflare Worker entry point for the vinext-starter template. */
import { handleImageOptimization, DEFAULT_DEVICE_SIZES, DEFAULT_IMAGE_SIZES } from "vinext/server/image-optimization";
import handler from "vinext/server/app-router-entry";

interface Env {
  ASSETS: Fetcher;
  DB: D1Database;
  IMAGES: {
    input(stream: ReadableStream): {
      transform(options: Record<string, unknown>): {
        output(options: { format: string; quality: number }): Promise<{ response(): Response }>;
      };
    };
  };
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

// Image security config. SVG sources with .svg extension auto-skip the
// optimization endpoint on the client side (served directly, no proxy).
// To route SVGs through the optimizer (with security headers), set
// dangerouslyAllowSVG: true in next.config.js and uncomment below:
// const imageConfig: ImageConfig = { dangerouslyAllowSVG: true };

const worker = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const publicHost = request.headers.get("x-co-roc-public-host")?.toLowerCase();
    const originalContentType = request.headers.get("x-co-roc-original-content-type");
    let routedRequest = request;
    if ((publicHost === "co-roc.com" || publicHost === "www.co-roc.com")
      && originalContentType?.toLowerCase().startsWith("multipart/form-data;")) {
      const headers = new Headers(request.headers);
      headers.set("content-type", originalContentType);
      headers.delete("x-co-roc-original-content-type");
      routedRequest = new Request(request, { headers });
    }
    const url = new URL(routedRequest.url);

    if (url.pathname === "/_vinext/image") {
      const allowedWidths = [...DEFAULT_DEVICE_SIZES, ...DEFAULT_IMAGE_SIZES];
      return handleImageOptimization(routedRequest, {
        fetchAsset: (path) => env.ASSETS.fetch(new Request(new URL(path, routedRequest.url))),
        transformImage: async (body, { width, format, quality }) => {
          const result = await env.IMAGES.input(body).transform(width > 0 ? { width } : {}).output({ format, quality });
          return result.response();
        },
      }, allowedWidths);
    }

    return handler.fetch(routedRequest, env, ctx);
  },
};

export default worker;
