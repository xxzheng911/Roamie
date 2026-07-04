import type { Locale } from "@/lib/i18n/types";
import { registerLocationAppGate, waitForAppActiveForLocation } from "@/lib/location-app-gate";
import { ensureEffectiveLocationBootstrap } from "@/lib/effective-location";
import {
  logHomeRefreshBackground,
  readPersistedHomeLocation,
  readPersistedHomeWeather,
} from "@/lib/home-persistent-cache";
import { isHomeNearbyPlacesCacheHit, readHomeSessionNearbyMeta } from "@/lib/home-session-cache";
import { readCachedProfile } from "@/lib/profile-persisted-cache";
import { preloadAvatarImage } from "@/lib/profile-avatar-preload";
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
      Promise.resolve(readPersistedHomeLocation()),
      Promise.resolve().then(() => {
        const userId = readCachedAuthenticatedUserIdSync();
        const profile = readCachedProfile(userId);
        if (profile?.avatarUrl) {
          preloadAvatarImage(userId, profile.avatarUrl, profile.avatarUpdatedAt);
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
