import cafe from "@/assets/scene-cafe.jpg";
import bookstore from "@/assets/scene-bookstore.jpg";
import cityStreet from "@/assets/scene-tokyo.jpg";
import parkWalk from "@/assets/scene-walk.jpg";
import roamieDefaultCover from "@/assets/roamie-default-cover.png";

/** Roamie 分類預設圖（禁止 scene-onsen／溫泉圖） */
const SCENE = {
  cafe,
  bookstore,
  museum: cityStreet,
  restaurant: cityStreet,
  shopping: cityStreet,
  park: parkWalk,
  neutral: roamieDefaultCover,
} as const;

export type PlaceSceneCategory =
  | "museum"
  | "coffee"
  | "bookstore"
  | "restaurant"
  | "shopping"
  | "park"
  | "night"
  | "district"
  | "sight"
  | "neutral";

const BLOCKED_SCENE_URL = /scene-onsen|onsen|溫泉/i;

export function isBlockedPlaceSceneUrl(url: string | null | undefined): boolean {
  if (!url?.trim()) return false;
  return BLOCKED_SCENE_URL.test(url);
}

function detectPlaceSceneCategory(
  name: string,
  options?: { primaryType?: string | null; types?: string[] | null; categoryId?: string },
): PlaceSceneCategory {
  const hay = [
    name,
    options?.primaryType ?? "",
    ...(options?.types ?? []),
    options?.categoryId ?? "",
  ]
    .join(" ")
    .toLowerCase();

  const cat = (options?.categoryId ?? "").toLowerCase();

  if (
    cat === "shopping" ||
    /(百貨|商場|購物|mall|boutique|市集|market|shopping|outlet|選物)/.test(hay)
  ) {
    return "shopping";
  }

  if (
    cat === "food" ||
    /(餐廳|restaurant|美食|拉麵|壽司|燒肉|食堂|小吃|夜市|宵夜|早午餐|brunch|甜點|烘焙|bakery|bistro)/.test(
      hay,
    )
  ) {
    return "restaurant";
  }

  if (
    cat === "coffee" ||
    (/(咖啡|cafe|coffee|茶館|茶室)/.test(hay) && !/(酒行|菸|烟|檳榔)/.test(hay))
  ) {
    return "coffee";
  }

  if (cat === "bookstore" || /(書店|書局|bookstore|library)/.test(hay)) {
    return "bookstore";
  }

  if (
    cat === "museum" ||
    /(博物|museum|文化館|紀念|展覽|gallery|美術|文物|歷史)/.test(hay)
  ) {
    return "museum";
  }

  if (
    cat === "park" ||
    cat === "walking" ||
    /(公園|park|步道|河濱|綠地|national_park|botanical|garden)/.test(hay)
  ) {
    return "park";
  }

  if (cat === "night" || /(夜景|night|酒吧|bar|pub|night_club|深夜)/.test(hay)) {
    return "night";
  }

  if (cat === "district" || /(商圈|老街|market|市集|mall|百貨)/.test(hay)) {
    return "district";
  }

  if (
    cat === "sight" ||
    cat === "photo" ||
    /(景點|觀光|tourist|神社|寺|廟|燈塔|展望)/.test(hay)
  ) {
    return "sight";
  }

  return "neutral";
}

/**
 * 依地點名稱與類型選 Roamie 風格預設圖（Google / Unsplash 皆無照片時）。
 * 不使用溫泉圖；無法對應分類時用中性 roamie-default-cover。
 */
export function pickPlaceSceneFallback(
  name: string,
  options?: { primaryType?: string | null; types?: string[] | null; categoryId?: string },
): string {
  const kind = detectPlaceSceneCategory(name, options);

  const url = (() => {
    switch (kind) {
      case "museum":
        return SCENE.museum;
      case "coffee":
        return SCENE.cafe;
      case "bookstore":
        return SCENE.bookstore;
      case "restaurant":
        return SCENE.restaurant;
      case "shopping":
      case "district":
      case "sight":
      case "night":
        return SCENE.shopping;
      case "park":
        return SCENE.park;
      case "neutral":
      default:
        return SCENE.neutral;
    }
  })();
  return isBlockedPlaceSceneUrl(url) ? SCENE.neutral : url;
}

export function placeSceneCategoryLabel(
  name: string,
  options?: { primaryType?: string | null; types?: string[] | null; categoryId?: string },
): PlaceSceneCategory {
  return detectPlaceSceneCategory(name, options);
}
