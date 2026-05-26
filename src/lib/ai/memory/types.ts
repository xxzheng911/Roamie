/** 單次聊天工作記憶（session / 對話摘要） */
export type SessionMemorySnapshot = {
  mood?: string;
  selectedMood?: string;
  preferredArea?: string;
  avoidTypes?: string[];
  rejectedPlaceNames?: string[];
  selectedPlaceNames?: string[];
  companionship?: string;
  setting?: string;
  transportation?: string;
  pace?: string;
  lastUserIntent?: string;
  conversationSummary?: string;
  turnCount?: number;
};

/** Plus 長期記憶（跨次對話） */
export type LongTermMemorySnapshot = {
  displayName?: string;
  travelStyle?: string;
  personalityType?: string;
  personalitySummary?: string;
  pace?: string;
  vibe?: string;
  budgetLabel?: string;
  avoid?: string[];
  interests?: string[];
  savedPlaceNames?: string[];
  savedPlaceCategories?: string[];
  recentTripDestinations?: string[];
  tripCount?: number;
  traits?: string[];
};
