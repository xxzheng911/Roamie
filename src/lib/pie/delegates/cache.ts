/**
 * PIE Cache delegates → 既有 unified-place-cache
 * 無額外商業邏輯。
 */

import {
  buildUnifiedPlaceCacheKey,
  buildUnifiedPlaceDetailsCacheKey,
  cachePlaceResultById,
  getUnifiedPlaceCacheOrFetch,
  invalidateUnifiedPlaceCache,
  isPlaceDetailsCacheComplete,
  isPlaceDetailsMinimallyCacheable,
  isPlaceSearchListCacheable,
  readCachedPlaceResultById,
  readUnifiedPlaceCache,
  readUnifiedPlaceDetailsCache,
  readUnifiedPlaceSearchCache,
  setUnifiedPlaceCacheForceRefresh,
  writeUnifiedPlaceCache,
  writeUnifiedPlaceDetailsCache,
  writeUnifiedPlaceSearchCache,
} from "@/lib/unified-place-cache";

export const pieCacheDelegate = {
  buildUnifiedPlaceCacheKey,
  buildUnifiedPlaceDetailsCacheKey,
  readUnifiedPlaceCache,
  writeUnifiedPlaceCache,
  invalidateUnifiedPlaceCache,
  getUnifiedPlaceCacheOrFetch,
  readUnifiedPlaceSearchCache,
  writeUnifiedPlaceSearchCache,
  readUnifiedPlaceDetailsCache,
  writeUnifiedPlaceDetailsCache,
  cachePlaceResultById,
  readCachedPlaceResultById,
  isPlaceDetailsMinimallyCacheable,
  isPlaceDetailsCacheComplete,
  isPlaceSearchListCacheable,
  setUnifiedPlaceCacheForceRefresh,
} as const;
