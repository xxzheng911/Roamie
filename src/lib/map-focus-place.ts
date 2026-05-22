import {
  applyMapVisiblePadding,
  measureMapExplorePadding,
} from "@/lib/map-visible-padding";

/** 將地點置於地圖可視區中央（避開 sheet / bottom nav / 搜尋列） */
export function focusPlaceInVisibleMapArea(
  map: google.maps.Map,
  position: google.maps.LatLngLiteral,
  zoom: number,
  sheetEl?: HTMLElement | null,
): void {
  const padding = measureMapExplorePadding(sheetEl);
  applyMapVisiblePadding(map, padding);
  map.panTo(position);
  map.setZoom(zoom);
}
