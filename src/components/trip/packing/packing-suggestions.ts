import type { Locale } from "@/lib/i18n/types";
import { isPackingDefaultKey, type PackingDefaultKey } from "./packing-model";

/**
 * 預設分類的建議物品（純前端資料，不寫入資料庫）。
 * 語言跟著 App 目前語系；自訂分類（default_key＝null）沒有建議。
 */
const PACKING_SUGGESTIONS: Record<Locale, Record<PackingDefaultKey, readonly string[]>> = {
  "zh-TW": {
    clothing: ["上衣", "褲子", "內衣褲", "襪子", "睡衣", "外套"],
    toiletries: ["牙刷", "牙膏", "洗面乳", "沐浴乳", "洗髮精", "毛巾"],
    electronics: ["充電器", "行動電源", "轉接頭", "耳機"],
    documents: ["護照", "身分證", "駕照", "信用卡", "外幣", "機票／訂房確認"],
    medicine: ["感冒藥", "腸胃藥", "止痛藥", "OK 繃"],
    other: ["雨傘", "太陽眼鏡", "水壺", "購物袋"],
  },
  en: {
    clothing: ["Tops", "Pants", "Underwear", "Socks", "Pajamas", "Jacket"],
    toiletries: ["Toothbrush", "Toothpaste", "Face wash", "Body wash", "Shampoo", "Towel"],
    electronics: ["Charger", "Power bank", "Travel adapter", "Earphones"],
    documents: [
      "Passport",
      "ID card",
      "Driver’s license",
      "Credit card",
      "Foreign currency",
      "Flight & hotel confirmations",
    ],
    medicine: ["Cold medicine", "Stomach medicine", "Painkillers", "Bandages"],
    other: ["Umbrella", "Sunglasses", "Water bottle", "Shopping bag"],
  },
  ja: {
    clothing: ["トップス", "ズボン", "下着", "靴下", "パジャマ", "上着"],
    toiletries: ["歯ブラシ", "歯磨き粉", "洗顔料", "ボディソープ", "シャンプー", "タオル"],
    electronics: ["充電器", "モバイルバッテリー", "変換プラグ", "イヤホン"],
    documents: [
      "パスポート",
      "身分証",
      "運転免許証",
      "クレジットカード",
      "外貨",
      "航空券・宿泊予約確認",
    ],
    medicine: ["風邪薬", "胃腸薬", "痛み止め", "絆創膏"],
    other: ["傘", "サングラス", "水筒", "エコバッグ"],
  },
  ko: {
    clothing: ["상의", "바지", "속옷", "양말", "잠옷", "겉옷"],
    toiletries: ["칫솔", "치약", "폼클렌징", "바디워시", "샴푸", "수건"],
    electronics: ["충전기", "보조배터리", "멀티어댑터", "이어폰"],
    documents: ["여권", "신분증", "운전면허증", "신용카드", "외화", "항공권·숙소 예약 확인"],
    medicine: ["감기약", "소화제", "진통제", "반창고"],
    other: ["우산", "선글라스", "물병", "장바구니"],
  },
};

const normalizeName = (name: string) => name.trim().toLowerCase();

/**
 * 依語系與分類回傳尚未加入的建議物品；現有物品名稱（trim、不分大小寫）相同者不顯示。
 * 非預設分類或全部都已加入時回傳空陣列。
 */
export function packingSuggestionsFor(
  locale: Locale,
  defaultKey: string | null,
  existingNames: readonly string[],
): string[] {
  if (!isPackingDefaultKey(defaultKey)) return [];
  const list = (PACKING_SUGGESTIONS[locale] ?? PACKING_SUGGESTIONS["zh-TW"])[defaultKey];
  const existing = new Set(existingNames.map(normalizeName));
  return list.filter((name) => !existing.has(normalizeName(name)));
}
