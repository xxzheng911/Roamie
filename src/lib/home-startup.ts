import type { Locale } from "@/lib/i18n/types";
import { registerLocationAppGate, waitForAppActiveForLocation } from "@/lib/location-app-gate";
import { ensureEffectiveLocationBootstrap } from "@/lib/effective-location";
import {
  logHomeRefreshBackground,
  readPersistedHomeLocation,
  readPersistedHomeWeather,
} from "@/lib/home-persistent-cache";
import { isHomeNearbyPlacesCacheHit, readHomeSessionNearbyMeta } from "@/lib/home-session-cache";
import { prefetchPlaceCoverUrls } from "@/services/image-cache";
import { readCachedProfile } from "@/lib/profile-persisted-cache";
import { hydrateUserMediaFromCache } from "@/lib/user-media/user-media-store";
import { readCachedAuthenticatedUserIdSync } from "@/lib/auth-session";
import { ensureHomeWeatherBootstrap } from "@/lib/home-weather-bootstrap";

let homeStartupStarted = false;

/** App 啟動：並行預載快取與定位，不阻塞首頁 render */
export function prefetchHomeData(locale: Locale): void {
  if (homeStartupStarted) return;
  homeStartupStarted = true;

  registerLocationAppGate();

  void waitForAppActiveForLocation().then(() => {
    void Promise.all([
      Promise.resolve(readPersistedHomeWeather()),
      Promise.resolve(readHomeSessionNearbyMeta()),
      Promise.resolve(readPersistedHomeLocation(Date.now(), { allowStale: true })),
      Promise.resolve().then(() => {
        const userId = readCachedAuthenticatedUserIdSync();
        void hydrateUserMediaFromCache(userId ?? readCachedProfile(undefined, { quiet: true })?.userId);
        const nearby = readHomeSessionNearbyMeta();
        if (nearby.picks.length > 0) {
          prefetchPlaceCoverUrls(
            nearby.picks.slice(0, 5).map((p) => ({
              placeId: p.id,
              url: p.coverImageUrl,
              photoName: p.photoName,
            })),
          );
        }
      }),
      ensureEffectiveLocationBootstrap().catch(() => null),
    ]).then(() => {
      ensureHomeWeatherBootstrap(locale, "home-startup");
      logHomeRefreshBackground("all");
    });
  });
}

export { isHomeNearbyPlacesCacheHit };
