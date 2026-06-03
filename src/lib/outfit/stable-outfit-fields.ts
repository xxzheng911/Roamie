import type { TripOutfitSuggestionFields } from "@/lib/outfit/types";

/** 避免 pending 狀態每次 render 回傳新 {} 觸發連鎖 effect */
export const EMPTY_TRIP_OUTFIT_FIELDS: TripOutfitSuggestionFields = {};
