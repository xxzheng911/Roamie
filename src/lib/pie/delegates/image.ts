/**
 * PIE Image delegates → 既有 placeImageService
 * 無額外商業邏輯。圖片優先序仍由既有實作決定（Google → Unsplash → Roamie）。
 */

import {
  getPlaceImage,
  getRoamieDefaultImage,
  getTripCoverImage,
  resolveGooglePlacePhoto,
  resolvePlaceCoverImageSync,
} from "@/services/placeImageService";

export const pieImageDelegate = {
  getPlaceImage,
  getTripCoverImage,
  resolveGooglePlacePhoto,
  resolvePlaceCoverImageSync,
  getRoamieDefaultImage,
} as const;
