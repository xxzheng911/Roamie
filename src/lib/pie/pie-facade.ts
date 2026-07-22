/**
 * Place Intelligence Engine (PIE) Facade — Phase 1 Step A
 *
 * 統一 Places 相關能力的入口介面。本階段僅委派至既有實作，
 * 不新增搜尋／過濾／排序商業邏輯。
 */

import { pieCacheDelegate } from "@/lib/pie/delegates/cache";
import { pieDetailDelegate } from "@/lib/pie/delegates/detail";
import { pieImageDelegate } from "@/lib/pie/delegates/image";
import { pieSearchDelegate } from "@/lib/pie/delegates/search";
import type { PieCapability } from "@/lib/pie/types";

export type PieFacade = {
  readonly version: "1.0.0-step-a";
  readonly capabilities: readonly PieCapability[];

  search: typeof pieSearchDelegate;
  detail: typeof pieDetailDelegate;
  cache: typeof pieCacheDelegate;
  image: typeof pieImageDelegate;

  /** 扁平捷徑：autocomplete 搜尋 */
  searchAutocomplete: typeof pieSearchDelegate.searchAutocomplete;
  /** 扁平捷徑：Explore 搜尋 */
  searchExplore: typeof pieSearchDelegate.searchExplore;
  /** 扁平捷徑：輕量 details */
  getPlaceLiteDetails: typeof pieDetailDelegate.getPlaceLiteDetails;
  /** 扁平捷徑：畫面用 details */
  fetchPlaceDetailsForScreen: typeof pieDetailDelegate.fetchPlaceDetailsForScreen;
  fetchPlaceDetailsForScreenWithKey: typeof pieDetailDelegate.fetchPlaceDetailsForScreenWithKey;
  fetchPlaceDetailsForIntro: typeof pieDetailDelegate.fetchPlaceDetailsForIntro;
  fetchGooglePlaceDetailsForHandoff: typeof pieDetailDelegate.fetchGooglePlaceDetailsForHandoff;
  getPlaceDetailsServerFn: typeof pieDetailDelegate.getPlaceDetailsServerFn;
  /** 扁平捷徑：地點圖片 */
  getPlaceImage: typeof pieImageDelegate.getPlaceImage;
  /** 扁平捷徑：正規化 */
  normalizePlace: typeof pieSearchDelegate.normalizePlace;
};

export const pieFacade: PieFacade = {
  version: "1.0.0-step-b",
  capabilities: ["search", "detail", "cache", "image", "normalize"],

  search: pieSearchDelegate,
  detail: pieDetailDelegate,
  cache: pieCacheDelegate,
  image: pieImageDelegate,

  searchAutocomplete: pieSearchDelegate.searchAutocomplete,
  searchExplore: pieSearchDelegate.searchExplore,
  getPlaceLiteDetails: pieDetailDelegate.getPlaceLiteDetails,
  fetchPlaceDetailsForScreen: pieDetailDelegate.fetchPlaceDetailsForScreen,
  fetchPlaceDetailsForScreenWithKey: pieDetailDelegate.fetchPlaceDetailsForScreenWithKey,
  fetchPlaceDetailsForIntro: pieDetailDelegate.fetchPlaceDetailsForIntro,
  fetchGooglePlaceDetailsForHandoff: pieDetailDelegate.fetchGooglePlaceDetailsForHandoff,
  getPlaceDetailsServerFn: pieDetailDelegate.getPlaceDetailsServerFn,
  getPlaceImage: pieImageDelegate.getPlaceImage,
  normalizePlace: pieSearchDelegate.normalizePlace,
};

/** 取得 PIE Facade 單例（便於測試替換／文件說明） */
export function getPieFacade(): PieFacade {
  return pieFacade;
}
