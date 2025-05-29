import { vitePlugin as remix } from "@remix-run/dev";
import { installGlobals } from "@remix-run/node";
import { defineConfig } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";

installGlobals({ nativeFetch: true });

// Related: https://github.com/remix-run/remix/issues/2835#issuecomment-1144102176
if (
  process.env.HOST &&
  (!process.env.SHOPIFY_APP_URL ||
    process.env.SHOPIFY_APP_URL === process.env.HOST)
) {
  process.env.SHOPIFY_APP_URL = process.env.HOST;
  delete process.env.HOST;
}

const host = new URL(process.env.SHOPIFY_APP_URL || "http://localhost")
  .hostname;
let hmrConfig;

if (host === "localhost") {
  hmrConfig = {
    protocol: "ws",
    host: "localhost",
    port: 64999,
    clientPort: 64999,
  };
} else {
  hmrConfig = {
    protocol: "wss",
    host: host,
    port: parseInt(process.env.FRONTEND_PORT) || 8002,
    clientPort: 443,
  };
}

export default defineConfig({
  server: {
    host: "localhost",
    port: Number(process.env.PORT || 3000),
    hmr: hmrConfig,
    fs: {
      // Restrict files that could be served by Vite's dev server.  Accessing
      // a file that isn't in this list will result in a 403.  Both directories
      // and files can be provided.
      //
      // We also have to explicitly allow the directory with the generated
      // version-hash.json to explicitly allow served filepaths with a dot
      // in production.  This is needed as by default, in production Vite adds
      // a dot prefix to immutable assets, but doesn't have access to SSR
      // files when running that check.
      // See https://github.com/shopify/hydrogen-v1/pull/3870
      deny: [
        "**/.env",
        "**/.env.*",
        "**/.git",
        "**/.git/*",
        "**/.gitignore",
        "**/.gitmodules",
        "**/node_modules",
        "**/node_modules/*",
        "**/.cache",
        "**/.cache/*",
        "**/.DS_Store",
      ],
    },
  },
  plugins: [
    remix({
      ignoredRouteFiles: ["**/.*"],
      future: {
        v3_fetcherPersist: true,
        v3_relativeSplatPath: true,
        v3_throwAbortReason: true,
      },
    }),
    tsconfigPaths(),
  ],
  optimizeDeps: {
    include: ["@shopify/polaris"],
  },
  build: {
    assetsInlineLimit: 0,
  },
});
