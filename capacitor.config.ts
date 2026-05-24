import type { CapacitorConfig } from "@capacitor/cli";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

/** Keep in sync with src/constants/app.ts */
const APP_BUNDLE_ID = "com.roamie.app";
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

/**
 * Dev: CAPACITOR_DEV_SERVER_URL (e.g. http://localhost:8080 for Simulator,
 *      http://192.168.x.x:8080 for physical device)
 * Prod/TestFlight: CAPACITOR_SERVER_URL (HTTPS deployed SSR app)
 */
const devServerUrl = readEnvFromDotEnv("CAPACITOR_DEV_SERVER_URL");
const prodServerUrl =
  readEnvFromDotEnv("CAPACITOR_SERVER_URL") ?? readEnvFromDotEnv("VITE_APP_ORIGIN");

const liveUrl = (devServerUrl ?? prodServerUrl)?.replace(/\/$/, "");
const isCleartext = liveUrl?.startsWith("http://") ?? false;

const config: CapacitorConfig = {
  appId: APP_BUNDLE_ID,
  appName: APP_DISPLAY_NAME,
  webDir: "dist/client",
  server: liveUrl
    ? {
        url: liveUrl,
        cleartext: isCleartext,
        androidScheme: isCleartext ? "http" : "https",
        iosScheme: isCleartext ? "http" : "https",
      }
    : {
        androidScheme: "https",
        iosScheme: "https",
      },
  ios: {
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
      launchShowDuration: 1200,
      launchAutoHide: true,
      /** Matches LaunchScreen.storyboard + App Icon cream */
      backgroundColor: "#fdf5ea",
      showSpinner: false,
      splashFullScreen: true,
      splashImmersive: true,
    },
    StatusBar: {
      style: "DARK",
      backgroundColor: "#f7f4ef",
    },
    Keyboard: {
      resize: "body",
      resizeOnFullScreen: true,
    },
  },
};

export default config;
