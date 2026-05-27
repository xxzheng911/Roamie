/** 收藏行程 — 統一檢視／詳情格式（可序列化、可擴充） */
export type SavedTripDateRange = {
  start: string;
  end: string;
};

export type SavedTripDayItem = {
  id: string;
  time: string;
  placeName: string;
  address: string;
  category: string;
  duration: string;
  transportMode: string;
  travelTimeToNext: string;
  note: string;
  placeId: string;
  lat: number | null;
  lng: number | null;
};

export type SavedTripDay = {
  dayNumber: number;
  date: string;
  items: SavedTripDayItem[];
};

export type SavedTripView = {
  id: string;
  /** 自動產生的預設名稱 */
  title: string;
  customTitle: string | null;
  isTitleCustomized: boolean;
  /** 列表／詳情顯示用 */
  displayTitle: string;
  destination: string;
  dateRange: SavedTripDateRange;
  /** 行程天數（含首尾） */
  dayCount: number;
  summary: string;
  transportMode: string;
  companionCount: string;
  isSaved: boolean;
  /** 非自訂預設封面 */
  coverImageUrl: string | null;
  customCoverImageUrl: string | null;
  aiGeneratedCoverImageUrl: string | null;
  isCoverCustomized: boolean;
  /** 列表／詳情顯示用 */
  displayCoverImage: string;
  /** @deprecated 使用 resolveTripCoverUrl / displayCoverImage */
  coverImage: string | null;
  coverSource: string | null;
  coverQuery: string | null;
  mood: string | null;
  days: SavedTripDay[];
  createdAt: string;
  updatedAt: string;
};
