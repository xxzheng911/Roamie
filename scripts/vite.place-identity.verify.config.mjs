import { mergeConfig } from "vite";
import base from "./vite.verify.config.mjs";

// Captured provider replay only; production auth/cost code is not changed.
export default mergeConfig(base, {
  plugins: [{
    name: "identity-fixture-transport", enforce: "pre",
    resolveId(id) { if (id === "@/lib/google-rest-transport" || /\/google-rest-transport(?:\.ts)?$/.test(id)) return "\0identity-fixture-transport"; },
    load(id) { if (id === "\0identity-fixture-transport") return `
      export const getGoogleRestTransportToken = () => "offline-fixture";
      export const googleRestFetch = (url, init) => globalThis.fetch(url, init);
    `; },
  }],
});
