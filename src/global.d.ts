import type { PlacesStatsSnapshot } from "@/lib/places-api-stats";

declare global {
  interface Window {
    __placesStats?: PlacesStatsSnapshot;
    printPlacesStats?: () => void;
  }
}

export {};
