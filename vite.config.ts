// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - tanstackStart, viteReact, tailwindcss, tsConfigPaths, cloudflare (build-only),
//     componentTagger (dev-only), VITE_* env injection, @ path alias, React/TanStack dedupe,
//     error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... } }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";

// Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
// @cloudflare/vite-plugin builds from this — wrangler.jsonc main alone is insufficient.
const isCapacitorBuild =
  process.env.ROAMIE_CAPACITOR_BUILD === "1" ||
  process.env.ROAMIE_CAPACITOR_BUILD === "true";

export default defineConfig({
  tanstackStart: {
    server: { entry: "server" },
    router: {
      /** iOS bundled：避免 lazy route chunk 載入失敗導致 router 卡在 splash */
      autoCodeSplitting: !isCapacitorBuild,
    },
  },
  vite: {
    envPrefix: ["VITE_", "EXPO_PUBLIC_"],
    server: {
      host: "0.0.0.0",
      port: 8080,
      strictPort: true,
    },
    build: {
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (!id.includes("node_modules")) return;
            if (isCapacitorBuild) {
              if (id.includes("@supabase")) return "vendor-supabase";
              return;
            }
            if (id.includes("@supabase")) return "vendor-supabase";
            if (id.includes("react-dom") || /\/react\//.test(id)) return "vendor-react";
            if (id.includes("@tanstack")) return "vendor-tanstack";
            if (id.includes("@radix-ui")) return "vendor-radix";
            if (id.includes("lucide-react")) return "vendor-icons";
          },
        },
      },
    },
  },
});
