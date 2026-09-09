import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  typescript: { tsconfigPath: "tsconfig.app.json" },
  // Keep development HMR artifacts isolated from production builds. Running
  // `next build` while the local app is open can otherwise invalidate CSS and
  // route manifests used by the dev server.
  distDir: process.env.NODE_ENV === "development" ? ".next-dev" : ".next",
  transpilePackages: ["lucide-react", "three"],
  async rewrites() {
    const target = process.env.DK_GENERATOR_ORIGIN;
    if (!target) return [];
    const upstream = new URL(target);
    const appOrigin = process.env.NEXT_PUBLIC_APP_URL;
    if(upstream.protocol !== 'https:' || upstream.username || upstream.password || upstream.search || upstream.hash || upstream.pathname !== '/' || (appOrigin && upstream.origin === new URL(appOrigin).origin)) {
      throw new Error('DK_GENERATOR_ORIGIN must be a separate HTTPS origin without credentials or path.');
    }
    return {beforeFiles:[{source:'/api/generator/:path*',destination:upstream.origin+'/api/generator/:path*'}],afterFiles:[],fallback:[]};
  },
  async headers() {
    const previewDomain=process.env.NEXT_PUBLIC_DK_PREVIEW_DOMAIN;
    if(previewDomain&&!/^([a-z0-9-]+\.)+[a-z]{2,}$/.test(previewDomain))throw new Error('Invalid preview domain.');
    const previewSource=previewDomain?' https://*.'+previewDomain:'';
    // Allow the configured authentication service, not arbitrary remote hosts.
    const authOrigin = process.env.NEXT_PUBLIC_SUPABASE_URL
      ? new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).origin
      : "";
    const connectSrc = ["'self'", "blob:", "https://api.openai.com", authOrigin].filter(Boolean).join(" ");
    const scriptSrc = [
      "'self'",
      "'unsafe-inline'",
      "'wasm-unsafe-eval'",
      ...(process.env.NODE_ENV === "development" ? ["'unsafe-eval'"] : []),
    ].join(" ");
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: `default-src 'self'; script-src ${scriptSrc}; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; worker-src 'self' blob:; media-src 'self' blob:; connect-src ${connectSrc}; frame-src 'self' blob: http://127.0.0.1:* http://*.localhost:*${previewSource}; frame-ancestors 'self'; base-uri 'self'; form-action 'self'; object-src 'none'` },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
        ],
      },
    ];
  },
};

export default nextConfig;
