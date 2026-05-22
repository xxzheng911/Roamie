import type { PlaceOpenStatus } from "@/lib/filter-available-places";

/** 探索 / 地圖推薦地點（client-safe，不含 server 依賴） */
export type PlaceResult = {
  id: string;
  name: string;
  address: string | null;
  lat: number | null;
  lng: number | null;
  rating: number | null;
  userRatingCount: number | null;
  photoName: string | null;
  primaryType: string | null;
  /** Google Places types（含 primaryType 以外的次要類型） */
  types?: string[] | null;
  businessStatus: string | null;
  openStatus: PlaceOpenStatus;
  openStatusLabel: string;
  todayHoursLabel: string;
  closingSoonNote: string;
  nextOpenHint: string;
};
