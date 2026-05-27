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
  title: string;
  destination: string;
  dateRange: SavedTripDateRange;
  /** 行程天數（含首尾） */
  dayCount: number;
  summary: string;
  transportMode: string;
  companionCount: string;
  isSaved: boolean;
  coverImage: string | null;
  mood: string | null;
  days: SavedTripDay[];
};
