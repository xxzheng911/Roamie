import type { CapacitorConfig } from "@capacitor/cli";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

/** Keep in sync with src/constants/app.ts */
const APP_BUNDLE_ID = "com.shuode.roamie";
const APP_DISPLAY_NAME = "Roamie";

function readEnvFromDotEnv(key: string): string | undefined {
  if (process.env[key]) return process.env[key];
  const envPath = resolve(process.cwd(), ".env");
  if (!existsSync(envPath)) return undefined;
  const content = readFileSync(envPath, "utf8");
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    if (trimmed.slice(0, eq).trim() !== key) continue;
    let val = trimmed.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    return val;
  }
  return undefined;
}

function envFlag(key: string): boolean {
  const raw = process.env[key] ?? readEnvFromDotEnv(key);
  return raw === "1" || raw === "true" || raw === "yes";
}

/**
 * Capacitor WebView load mode (pick one):
 *
 * 1. **Bundled assets (default, Xcode / TestFlight shell)**
 *    Do NOT set CAPACITOR_LIVE_RELOAD or CAPACITOR_USE_REMOTE_SERVER.
 *    WebView loads `webDir` (dist/client) from the app bundle — no server.url.
 *
 * 2. **Live reload dev** — set in .env or shell:
 *    CAPACITOR_LIVE_RELOAD=1
 *    CAPACITOR_DEV_SERVER_URL=http://localhost:8080  (Simulator)
 *    CAPACITOR_DEV_SERVER_URL=http://192.168.x.x:8080  (physical device)
 *    Run `npm run dev` before Xcode Run.
 *
 * 3. **Remote SSR (production)** — TestFlight pointing at deployed app:
 *    CAPACITOR_USE_REMOTE_SERVER=1
 *    CAPACITOR_SERVER_URL=https://your-production-domain.com
 */
const liveReload = envFlag("CAPACITOR_LIVE_RELOAD");
const useRemoteServer = envFlag("CAPACITOR_USE_REMOTE_SERVER");

const devServerUrl = liveReload ? readEnvFromDotEnv("CAPACITOR_DEV_SERVER_URL") : undefined;
const prodServerUrl = useRemoteServer
  ? (readEnvFromDotEnv("CAPACITOR_SERVER_URL") ?? readEnvFromDotEnv("VITE_APP_ORIGIN"))
  : undefined;

const liveUrl = (devServerUrl ?? prodServerUrl)?.replace(/\/$/, "");
const isCleartext = liveUrl?.startsWith("http://") ?? false;

if (liveUrl) {
  console.info(
    `[capacitor.config] server.url = ${liveUrl} (${liveReload ? "live reload" : "remote SSR"})`,
  );
} else {
  console.info("[capacitor.config] bundled web assets only (no server.url)");
}

const config: CapacitorConfig = {
  appId: APP_BUNDLE_ID,
  appName: APP_DISPLAY_NAME,
  /** TanStack Start client bundle lives in dist/client (not dist/ — no index.html at root). */
  webDir: "dist/client",
  ...(liveUrl
    ? {
        server: {
          url: liveUrl,
          cleartext: isCleartext,
          androidScheme: isCleartext ? "http" : "https",
          iosScheme: isCleartext ? "http" : "https",
        },
      }
    : {
        server: {
          androidScheme: "https",
          iosScheme: "https",
        },
      }),
  ios: {
    /** iPhone portrait-only; iPad orientations in Info.plist ~ipad (App Store) */
    /** Edge-to-edge WebView so env(safe-area-inset-*) matches device insets */
    contentInset: "never",
    scrollEnabled: true,
    allowsLinkPreview: false,
    /** Matches official app icon cream (#FDF5EA) */
    backgroundColor: "#fdf5ea",
  },
  android: {
    backgroundColor: "#f7f4ef",
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 0,
      launchAutoHide: false,
      backgroundColor: "#fdf5ea",
      showSpinner: false,
      androidSpinnerStyle: "small",
      iosSpinnerStyle: "small",
      splashFullScreen: true,
      splashImmersive: true,
    },
    StatusBar: {
      style: "DARK",
      backgroundColor: "#f7f4ef",
    },
    Keyboard: {
      resize: "body",
      /** iOS 全螢幕 resize 易導致 WKWebView 無回應 / JS Eval 失敗 */
      resizeOnFullScreen: false,
    },
  },
};

export default config;
