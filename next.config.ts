import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Use /tmp in dev so iCloud-tainted .next cache files don't block startup
  ...(process.env.NODE_ENV === "development" ? { distDir: "/tmp/basement-next" } : {}),
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "assets.coingecko.com" },
      { protocol: "https", hostname: "coin-images.coingecko.com" },
    ],
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
          {
            key: "Content-Security-Policy",
            value: [
              "default-src 'self'",
              "script-src 'self' 'unsafe-eval' 'unsafe-inline'",
              "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
              "img-src 'self' data: blob: https://assets.coingecko.com https://coin-images.coingecko.com https://*.walletconnect.com https://*.walletconnect.org https://*.web3modal.org https://imagedelivery.net",
              "connect-src 'self' https://*.walletconnect.com https://*.walletconnect.org wss://*.walletconnect.com wss://*.walletconnect.org https://*.web3modal.org https://*.web3modal.com https://*.reown.com https://*.rainbow.me https://*.metamask.io wss://*.metamask.io https://api.coingecko.com",
              "font-src 'self' https://fonts.gstatic.com",
              "frame-src 'self' https://verify.walletconnect.com https://verify.walletconnect.org https://secure.walletconnect.org https://secure-mobile.walletconnect.com https://secure-mobile.walletconnect.org",
            ].join("; "),
          },
        ],
      },
    ];
  },
};

export default nextConfig;
