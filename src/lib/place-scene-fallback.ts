import cafe from "@/assets/scene-cafe.jpg";
import onsen from "@/assets/scene-onsen.jpg";

const SCENE = {
  cafe,
  scenic: onsen,
} as const;

/**
 * 依地點名稱與類型選 Roamie 風格預設圖（Google 無照片時）。
 * 美食／餐飲絕不使用溫泉／夜景通用圖。
 */
export function pickPlaceSceneFallback(
  name: string,
  options?: { primaryType?: string | null; types?: string[] | null; categoryId?: string },
): string {
  const hay = [
    name,
    options?.primaryType ?? "",
    ...(options?.types ?? []),
    options?.categoryId ?? "",
  ]
    .join(" ")
    .toLowerCase();

  const cat = options?.categoryId ?? "";

  if (
    cat === "food" ||
    /(餐廳|restaurant|美食|拉麵|壽司|燒肉|食堂|小吃|夜市|宵夜|食堂|早午餐|brunch|甜點|烘焙|bakery|dessert|食堂)/.test(
      hay,
    )
  ) {
    return SCENE.cafe;
  }

  if (
    cat === "coffee" ||
    (/(咖啡|cafe|coffee|茶館|茶室)/.test(hay) && !/(酒行|菸|烟|檳榔)/.test(hay))
  ) {
    return SCENE.cafe;
  }

  if (
    cat === "park" ||
    cat === "walking" ||
    /(公園|park|步道|河濱|散步|national_park|botanical)/.test(hay)
  ) {
    return SCENE.scenic;
  }

  if (
    cat === "night" ||
    /(夜景|night|酒吧|bar|pub|night_club|深夜)/.test(hay)
  ) {
    return SCENE.scenic;
  }

  if (
    cat === "sight" ||
    cat === "photo" ||
    /(景點|觀光|tourist|museum|美術|神社|寺|廟|海邊|沙灘|山|trail)/.test(hay)
  ) {
    return SCENE.scenic;
  }

  if (/(博物|museum|美術|gallery|展覽|書店|百貨|mall|室內|商圈|district)/.test(hay)) {
    return SCENE.cafe;
  }

  if (/(咖啡|cafe|coffee|餐|食|restaurant|麵|飯)/.test(hay)) {
    return SCENE.cafe;
  }

  if (/(夜景|park|海|山|步道)/.test(hay)) {
    return SCENE.scenic;
  }

  return SCENE.cafe;
}
