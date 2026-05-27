/** 行程編輯：地點分類 */
export const SAVED_TRIP_CATEGORY_OPTIONS = [
  "美食",
  "景點",
  "咖啡廳",
  "購物",
  "住宿",
  "交通",
  "其他",
] as const;

/** 行程編輯：交通方式（含自訂） */
export const SAVED_TRIP_TRANSPORT_OPTIONS = [
  "步行",
  "捷運",
  "公車",
  "開車",
  "Uber",
  "火車",
  "高鐵",
  "機車",
  "大眾運輸",
] as const;

export type SavedTripTransportOption = (typeof SAVED_TRIP_TRANSPORT_OPTIONS)[number];
