import type { RoamieLocation } from "@/lib/ai/context";
import type { RoamieRecommendationItem } from "@/lib/ai/types";
import type { ClientContextBundle } from "@/lib/fetch-context";
import { formatDateRangeLabel } from "@/lib/picker-utils";
import type { TravelPreferences } from "@/lib/preferences-storage";
import {
  createEmptySession,
  roamieRecToChatItem,
  type ChatPlanningSession,
} from "@/lib/chat-session";
import { formatTripLocationLabel } from "@/lib/location/format";
import { tripLocationToRoamie } from "@/lib/location/to-roamie";
import type { TripLocation } from "@/lib/location/types";
import { syncSessionPlaceMemory } from "@/lib/place-planning-memory";
import {
  isValidTripPlaceRef,
  logTripPlace,
  tripLocationToPlaceRef,
} from "@/lib/trip/trip-place-ref";

export type PlanTripFormInput = {
  destination: TripLocation;
  origin: TripLocation | null;
  days: number;
  mood: string;
  styles: string[];
  interests: string;
  startDate: string;
  endDate: string;
  departureTime: string;
  travelers: number;
  transport: string;
  budgetMode: string;
  selectedPlaces?: RoamieRecommendationItem[];
};

export function buildPlanTripInitialContext(
  form: PlanTripFormInput,
  bundle: ClientContextBundle,
): string {
  const destLabel = formatTripLocationLabel(form.destination);
  const dateLine =
    form.startDate && form.endDate
      ? formatDateRangeLabel(form.startDate, form.endDate, { withYear: true })
      : `約 ${form.days} 天`;
  const w = bundle.weather;
  const weatherLine = w
    ? `${w.city ?? destLabel}：${w.condition}，約 ${w.tempC}°C${w.precipProbability != null ? `，降雨機率 ${w.precipProbability}%` : ""}`
    : "（尚未取得）";

  const lines = [
    "【規劃新行程 → 聊天規劃｜初始上下文】",
    `tripDestination：${destLabel}（${form.destination.lat.toFixed(4)}, ${form.destination.lng.toFixed(4)}）`,
    form.origin ? `tripOrigin：${formatTripLocationLabel(form.origin)}` : "",
    `travelDates：${dateLine}`,
    form.departureTime ? `departureTime：${form.departureTime}` : "",
    `travelers：${form.travelers}`,
    form.transport ? `transport：${form.transport}` : "",
    form.styles.length ? `travelStyles：${form.styles.join("、")}` : "",
    form.mood ? `mood：${form.mood}` : "",
    form.interests.trim() ? `extraNotes：${form.interests.trim()}` : "",
    `budgetMode：${form.budgetMode}`,
    `destinationWeather：${weatherLine}`,
    form.destination.timezone ? `timezone：${form.destination.timezone}` : "",
    "",
    "【規劃流程 — 必守】",
    "- 這是使用者從「規劃新行程」進入的多輪對話",
    "- **禁止**在未經使用者選點前就輸出完整多日 itinerary",
    "- 先依目的地、旅行日期、偏好、當地天氣與季節，推薦 3–5 個適合的地點",
    "- 記住【已選地點】【已拒絕】；勿推薦不同城市或重複地點",
    "- 考慮當地節慶、紅字假期、營業時間、季節（例：12 月聖誕活動、年末市集）",
    "- 下雨時優先室內；排除非營業、公休、永久停業",
    "- 語氣像懂旅行的旅伴，有溫度、情境式，不要像客服",
    "- 使用者選夠地點後，再邀請整理成完整行程",
  ];
  return lines.filter(Boolean).join("\n");
}

export { buildPlanTripHandoffOpening } from "@/lib/i18n/plan-handoff-copy";

export function preparePlanTripSession(
  form: PlanTripFormInput,
  bundle: ClientContextBundle,
  preferences?: TravelPreferences,
  options?: { plusConsultant?: boolean; skipOriginValidation?: boolean },
): ChatPlanningSession {
  const destRef = tripLocationToPlaceRef(form.destination);
  if (!isValidTripPlaceRef(destRef)) {
    logTripPlace("destination", "validation", { reason: "handoff_invalid_destination" });
    throw new Error("目的地資料不完整，請重新從搜尋結果選擇");
  }
  const effectiveOrigin = form.origin ?? form.destination;
  if (!options?.skipOriginValidation && !form.origin) {
    logTripPlace("start", "validation", { reason: "handoff_missing_start" });
    throw new Error("請選擇出發地");
  }
  const startRef = tripLocationToPlaceRef(effectiveOrigin);
  if (!isValidTripPlaceRef(startRef)) {
    logTripPlace("start", "validation", { reason: "handoff_invalid_start" });
    throw new Error("出發地資料不完整，請重新從搜尋結果選擇");
  }
  if (
    destRef.placeId === startRef.placeId &&
    Math.abs(destRef.lat - startRef.lat) < 1e-6 &&
    Math.abs(destRef.lng - startRef.lng) < 1e-6 &&
    form.origin != null
  ) {
    logTripPlace("destination", "validation", { reason: "handoff_same_place" });
    throw new Error("出發地與目的地不能相同");
  }

  const destRoamie = tripLocationToRoamie(form.destination);
  const selectedFromForm = (form.selectedPlaces ?? []).map(roamieRecToChatItem);
  const plusConsultant = options?.plusConsultant === true;
  const initialChatContext = plusConsultant
    ? buildPlusPlanTripInitialContext(form, bundle)
    : buildPlanTripInitialContext(form, bundle);

  const base: ChatPlanningSession = {
    ...createEmptySession(),
    phase: plusConsultant ? "followup" : "collect",
    mood: form.mood || undefined,
    preferences,
    location: destRoamie as RoamieLocation,
    weather: bundle.weather,
    tripDestination: form.destination,
    tripOrigin: form.origin ?? form.destination,
    fromPlanForm: true,
    planPlusConsultant: plusConsultant,
    planConsultantStage: plusConsultant ? "outline" : undefined,
    planConsultantRequirements: plusConsultant ? [] : undefined,
    planConsultantAskedKeys: plusConsultant ? [] : undefined,
    pendingHandoff: true,
    travelDate:
      form.startDate && form.endDate
        ? formatDateRangeLabel(form.startDate, form.endDate, { withYear: true })
        : undefined,
    tripStartDate: form.startDate || undefined,
    tripEndDate: form.endDate || undefined,
    tripDays: form.days,
    tripCompanionCount: form.travelers,
    tripStyles: form.styles.length ? form.styles.join("、") : undefined,
    startTime: form.departureTime || undefined,
    transportation: form.transport || undefined,
    budget: form.budgetMode,
    initialChatContext,
    selectedPlaces: selectedFromForm,
    plannedStops: selectedFromForm,
    recommendedPlaces: [],
    updatedAt: new Date().toISOString(),
  };

  return syncSessionPlaceMemory(base);
}

function buildPlusPlanTripInitialContext(
  form: PlanTripFormInput,
  bundle: ClientContextBundle,
): string {
  const base = buildPlanTripInitialContext(form, bundle);
  return [
    base,
    "",
    "【Plus 旅遊顧問 — 必守】",
    "- 一次只問一個問題，語氣自然像旅伴",
    "- 記錄使用者指定的景點、餐廳、天數安排、禁忌；生成行程時不得忽略",
    "- 若指定「第一天去某地」必須安排在第一天",
    "- 若有日出行程，當天減少景點或安排晚起／午休",
    "- 使用者說「開始安排」後才輸出完整 itinerary",
  ].join("\n");
}

/** 從聊天 session 還原規劃表單（Plus 顧問完成後生成行程） */
export function planTripFormFromSession(session: ChatPlanningSession): PlanTripFormInput | null {
  if (!session.tripDestination) return null;
  const styles = session.tripStyles?.split(/[、,]/).map((s) => s.trim()).filter(Boolean) ?? [];
  return {
    destination: session.tripDestination,
    origin: session.tripOrigin ?? null,
    days: session.tripDays ?? 3,
    mood: session.mood ?? "",
    styles,
    interests: "",
    startDate: session.tripStartDate ?? "",
    endDate: session.tripEndDate ?? "",
    departureTime: session.startTime ?? "",
    travelers: session.tripCompanionCount ?? 1,
    transport: session.transportation ?? "",
    budgetMode: session.budget ?? "standard",
    selectedPlaces: undefined,
  };
}

export function markPlanHandoffComplete(
  session: ChatPlanningSession,
): ChatPlanningSession {
  return {
    ...session,
    pendingHandoff: false,
    planHandoffDone: true,
    phase: session.selectedPlaces.length ? "followup" : "collect",
    updatedAt: new Date().toISOString(),
  };
}
