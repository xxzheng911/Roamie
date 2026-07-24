import type { PlacesStatsSnapshot } from "@/lib/places-api-stats";

declare global {
  interface Window {
    __placesStats?: PlacesStatsSnapshot;
    printPlacesStats?: () => void;
    __ROAMIE_BOOT__?: {
      phase?: string;
      t0?: number;
      import?: string;
      error?: string;
      lastHref?: string;
      lastPathname?: string;
      blankAtMs?: number;
    };
    Capacitor?: {
      getPlatform?: () => string;
      isNativePlatform?: () => boolean;
      Plugins?: {
        App?: { openUrl?: (options: { url: string }) => Promise<void> };
      };
    };
    RoamieNative?: { openAppSettings?: () => void | Promise<void> };
  }
}

export {};
