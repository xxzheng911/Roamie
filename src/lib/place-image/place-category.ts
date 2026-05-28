import type { PlaceImageInput } from "@/lib/place-image/place-image-types";

/** 依地點名稱與類型推斷圖片生成／預設分類 */
export function normalizeCategoryFromPlace(input: Pick<
  PlaceImageInput,
  "name" | "category" | "categoryId" | "primaryType" | "types"
>): string {
  const hay = [
    input.category ?? "",
    input.categoryId ?? "",
    input.primaryType ?? "",
    ...(input.types ?? []),
    input.name,
  ]
    .join(" ")
    .toLowerCase();

  if (/(博物|museum|文化館|紀念|gallery|美術|展覽|文物|歷史)/.test(hay)) return "museum";
  if (/(咖啡|cafe|coffee|貓|cat)/.test(hay)) return "coffee";
  if (/(書店|書局|bookstore|library)/.test(hay)) return "bookstore";
  if (/(餐廳|restaurant|美食|food|拉麵|壽司|小吃)/.test(hay)) return "food";
  if (/(公園|park|步道|散步|walking)/.test(hay)) return "park";
  if (/(夜景|night|bar|酒吧)/.test(hay)) return "night";
  if (/(海|beach|沙灘|ocean|海岸)/.test(hay)) return "beach";
  if (/(森林|forest|山|mountain|trail)/.test(hay)) return "forest";
  if (/(老街|old street|market|市集|商圈)/.test(hay)) return "street";
  return "sight";
}
