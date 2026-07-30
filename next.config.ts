import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      bodySizeLimit: "30mb",
      // Vinext applies the server-action CSRF guard to multipart route-handler
      // requests as well. The public domains proxy to the Worker, so explicitly
      // trust those browser origins while retaining the framework guard.
      allowedOrigins: ["co-roc.com", "www.co-roc.com"],
    },
  },
};

export default nextConfig;
