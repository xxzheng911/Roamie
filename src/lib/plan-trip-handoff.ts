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
  buildTravelStyleAiContext,
  normalizePlanTravelStyles,
} from "@/lib/plan-travel-style";
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
  /** zh-TW 正規化後的旅遊風格（推薦邏輯用） */
  normalizedStyles?: string[];
  startDate: string;
  endDate: string;
  departureTime: string;
  travelers: number;
  transport: string;
  budgetMode: string;
  selectedPlaces?: RoamieRecommendationItem[];
};

export type PreparePlanTripOptions = {
  /** true = 「讓 Roamie 替我安排」AI 行程規劃模式 */
  planAiMode?: boolean;
  localeStyleOptions?: string[];
};

export function buildPlanTripInitialContext(
  form: PlanTripFormInput,
  bundle: ClientContextBundle,
  options?: PreparePlanTripOptions,
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

  const styleKeys = normalizePlanTravelStyles(
    form.normalizedStyles?.length ? form.normalizedStyles : form.styles,
    options?.localeStyleOptions ?? form.styles,
  );
  const styleContext = buildTravelStyleAiContext(styleKeys);

  const lines = [
    options?.planAiMode
      ? "【規劃新行程 → AI 行程規劃模式｜初始上下文】"
      : "【規劃新行程 → 聊天規劃｜初始上下文】",
    `tripDestination：${destLabel}（${form.destination.lat.toFixed(4)}, ${form.destination.lng.toFixed(4)}）`,
    form.origin ? `tripOrigin：${formatTripLocationLabel(form.origin)}` : "",
    `travelDates：${dateLine}`,
    form.departureTime ? `departureTime：${form.departureTime}` : "",
    `travelers：${form.travelers}`,
    form.transport ? `transport：${form.transport}` : "",
    form.styles.length ? `travelStyles：${form.styles.join("、")}` : "",
    form.mood ? `mood：${form.mood}` : "",
    `budgetMode：${form.budgetMode}`,
    `destinationWeather：${weatherLine}`,
    form.destination.timezone ? `timezone：${form.destination.timezone}` : "",
    styleContext,
    "",
    "【規劃流程 — 必守】",
    options?.planAiMode
      ? "- 這是「讓 Roamie 替我安排」專屬 AI 行程規劃模式"
      : "- 這是使用者從「規劃新行程」進入的多輪對話",
    "- **禁止**在未經使用者選點前就輸出完整多日 itinerary",
    "- 先依目的地、旅行日期、偏好、當地天氣與季節，推薦 3 個左右真實 Google Places 地點",
    "- 記住【已選地點】【已拒絕】；勿推薦不同城市或重複地點",
    "- 使用者可要求換一批、加咖啡廳、看夜景等，依上下文持續推薦",
    "- 語氣像懂旅行的旅伴，有溫度、情境式，不要像客服",
    "- 使用者選夠地點後，再邀請按「生成完整行程」整理成正式行程",
  ];
  return lines.filter(Boolean).join("\n");
}

export { buildPlanTripHandoffOpening, buildPlanAiHandoffOpening } from "@/lib/i18n/plan-handoff-copy";

export function preparePlanTripSession(
  form: PlanTripFormInput,
  bundle: ClientContextBundle,
  preferences?: TravelPreferences,
  options?: PreparePlanTripOptions,
): ChatPlanningSession {
  const destRef = tripLocationToPlaceRef(form.destination);
  if (!isValidTripPlaceRef(destRef)) {
    logTripPlace("destination", "validation", { reason: "handoff_invalid_destination" });
    throw new Error("目的地資料不完整，請重新從搜尋結果選擇");
  }
  if (!form.origin) {
    logTripPlace("start", "validation", { reason: "handoff_missing_start" });
    throw new Error("請選擇出發地");
  }
  const startRef = tripLocationToPlaceRef(form.origin);
  if (!isValidTripPlaceRef(startRef)) {
    logTripPlace("start", "validation", { reason: "handoff_invalid_start" });
    throw new Error("出發地資料不完整，請重新從搜尋結果選擇");
  }
  if (
    destRef.placeId === startRef.placeId &&
    Math.abs(destRef.lat - startRef.lat) < 1e-6 &&
    Math.abs(destRef.lng - startRef.lng) < 1e-6
  ) {
    logTripPlace("destination", "validation", { reason: "handoff_same_place" });
    throw new Error("出發地與目的地不能相同");
  }

  const planAiMode = options?.planAiMode === true;
  const destRoamie = tripLocationToRoamie(form.destination);
  const selectedFromForm = (form.selectedPlaces ?? []).map(roamieRecToChatItem);
  const initialChatContext = buildPlanTripInitialContext(form, bundle, options);

  const base: ChatPlanningSession = {
    ...createEmptySession(),
    phase: "collect",
    mood: form.mood || undefined,
    preferences,
    location: destRoamie as RoamieLocation,
    weather: bundle.weather,
    tripDestination: form.destination,
    tripOrigin: form.origin ?? undefined,
    fromPlanForm: true,
    fromPlanAi: planAiMode,
    planAiMode,
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
