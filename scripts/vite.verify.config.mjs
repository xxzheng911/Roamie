import { defineConfig } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";

/** Minimal Vite config for itinerary verify scripts (no TanStack Start). */
export default defineConfig({
  plugins: [tsconfigPaths()],
  logLevel: "warn",
  server: {
    watch: null,
  },
});
