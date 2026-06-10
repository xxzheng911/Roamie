import type { HomeNearbyPick } from "@/lib/explore-category-search";
import type { WeatherSummary } from "@/lib/weather-types";

export type HomeSessionUserLocation = {
  lat: number;
  lng: number;
  city: string;
  source: "capacitor" | "browser" | "fallback";
};

type HomeSessionSnapshot = {
  weather: WeatherSummary | null;
  userLocation: HomeSessionUserLocation | null;
  nearbyPicks: HomeNearbyPick[];
  nearbyLoadKey: string | null;
};

const snapshot: HomeSessionSnapshot = {
  weather: null,
  userLocation: null,
  nearbyPicks: [],
  nearbyLoadKey: null,
};

export function readHomeSessionWeather(): WeatherSummary | null {
  return snapshot.weather;
}

export function writeHomeSessionWeather(weather: WeatherSummary | null): void {
  snapshot.weather = weather;
}

export function readHomeSessionUserLocation(): HomeSessionUserLocation | null {
  return snapshot.userLocation;
}

export function writeHomeSessionUserLocation(loc: HomeSessionUserLocation | null): void {
  snapshot.userLocation = loc;
}

export function readHomeSessionNearbyPicks(): HomeNearbyPick[] {
  return snapshot.nearbyPicks;
}

export function writeHomeSessionNearbyPicks(
  picks: HomeNearbyPick[],
  loadKey: string | null,
): void {
  snapshot.nearbyPicks = picks;
  snapshot.nearbyLoadKey = loadKey;
}

export function readHomeSessionNearbyLoadKey(): string | null {
  return snapshot.nearbyLoadKey;
}
