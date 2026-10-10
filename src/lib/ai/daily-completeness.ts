export type ItinerarySlotTemplate = {
  time: string;
  kind: string;
  label: string;
};

export const STANDARD_ITINERARY_DAY_SLOTS: ItinerarySlotTemplate[] = [
  { time: "08:30", kind: "restaurant", label: "早餐" },
  { time: "10:00", kind: "attraction", label: "景點" },
  { time: "12:00", kind: "restaurant", label: "午餐" },
  { time: "14:00", kind: "attraction", label: "景點" },
  { time: "16:00", kind: "cafe", label: "咖啡" },
  { time: "18:00", kind: "restaurant", label: "晚餐" },
  { time: "20:00", kind: "night_market", label: "酒吧" },
];

/** All existing styles use this template. Pace controls route density, not meal/slot completeness. */
export function dailyCompleteness(pace: "slow" | "medium" | "active" = "medium") {
  const slotCount = STANDARD_ITINERARY_DAY_SLOTS.length;
  return {
    minimumPlacesPerDay: slotCount,
    targetPlacesPerDay: slotCount,
    maximumPlacesPerDay: slotCount,
    slotCount,
    // Existing route-stage density rules, distinct from a complete day of slots.
    routeMinimum: pace === "slow" ? 2 : 3,
    routeMaximum: pace === "slow" ? 4 : pace === "active" ? 8 : 6,
    // Existing exceptional delivery policy, only used after rate-limit recovery.
    degradedMinimum: 3,
    degradedRequiredSlots: ["scenic", "meal"],
    degradedOptionalSlots: ["breakfast", "cafe", "evening", "attraction_2"],
  };
}
