/** 表單／行程規劃用的完整地點（Google Places） */
export type TripLocation = {
  placeId: string;
  country: string;
  city: string;
  /** 縣市 / 一級或二級行政區 */
  region?: string;
  lat: number;
  lng: number;
  /** 顯示用，例如 日本・大阪 */
  formattedName: string;
  /** 與 formattedName 相同，相容舊程式 */
  displayLabel: string;
  address?: string;
  timezone?: string;
  utcOffsetMinutes?: number | null;
};

export type LocationSuggestion = {
  placeId: string;
  label: string;
  secondary?: string;
};
