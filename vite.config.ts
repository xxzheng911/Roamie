// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - tanstackStart, viteReact, tailwindcss, tsConfigPaths, cloudflare (build-only),
//     componentTagger (dev-only), VITE_* env injection, @ path alias, React/TanStack dedupe,
//     error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... } }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";

// Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
// @cloudflare/vite-plugin builds from this — wrangler.jsonc main alone is insufficient.
export default defineConfig({
  tanstackStart: {
    server: { entry: "server" },
    router: {
      autoCodeSplitting: true,
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
            if (
              id.includes("/lib/capacitor-native-shell") ||
              id.includes("/lib/capacitor-app-listener") ||
              id.includes("/lib/capacitor-geolocation") ||
              id.includes("/lib/capacitor-local-notifications") ||
              id.includes("node_modules/@capacitor/app/") ||
              id.includes("node_modules/@capacitor/geolocation/") ||
              id.includes("node_modules/@capacitor/local-notifications/")
            ) {
              return "chunk-capacitor-plugins";
            }
            if (id.includes("/services/weatherService")) return "chunk-weather-service";
            if (id.includes("/lib/home-weather-bootstrap")) return "chunk-home-weather";
            if (id.includes("/lib/home-weather-fetch-policy")) return "chunk-home-weather";
            if (id.includes("/lib/home-session-cache")) return "chunk-home-weather";
            if (
              id.includes("/lib/device-location") ||
              id.includes("/lib/device-location-resolve") ||
              id.includes("/lib/location-permission-manager") ||
              id.includes("/lib/geo-distance") ||
              id.includes("/lib/last-search-location") ||
              id.includes("/lib/geo-region") ||
              id.includes("/lib/geo.ts")
            ) {
              return "chunk-device-location";
            }
            // 勿把 capacitor-app-listener / capacitor-geolocation 併入 device-location（見 chunk 循環依賴）
            if (!id.includes("node_modules")) return;
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
