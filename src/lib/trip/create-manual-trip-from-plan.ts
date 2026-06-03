import type { RoamiePayloadV2, TripTransportMode } from "@/lib/ai/types";
import type { ClientContextBundle } from "@/lib/fetch-context";
import { daysBetweenDates } from "@/lib/fetch-context";
import { confirmSaveTrip, type StoredItinerary } from "@/lib/itinerary-storage";
import type { Locale } from "@/lib/i18n/types";
import { formatTripLocationLabel } from "@/lib/location/format";
import { tripLocationToRoamie } from "@/lib/location/to-roamie";
import type { TripLocation } from "@/lib/location/types";
import type { PlanTripFormInput } from "@/lib/plan-trip-handoff";
import { extractAreaLabel } from "@/lib/trip/trip-title";
import {
  logManualTripCreateStart,
  logManualTripCreateSuccess,
  logManualTripSaveSuccess,
  logPlanTripSaveError,
} from "@/lib/trip/trip-persist-log";
import { getPreferences, type TravelPreferences } from "@/lib/preferences-storage";

function inferPlanFormTransport(transport: string): TripTransportMode {
  const t = transport.trim().toLowerCase();
  if (!t) return "walk";
  if (/機車|scooter|摩托|バイク|오토바이/.test(t)) return "scooter";
  if (/開車|自驾|自駕|drive|car|租車|レンタカー|렌터카|self-drive/.test(t)) return "drive";
  if (
    /捷運|地鐵|地铁|大眾|公車|公交|transit|mrt|metro|公共交通|대중교통|public transit/.test(t)
  ) {
    return "transit";
  }
  if (/計程車|taxi|uber|配車|택시|rideshare|共乘/.test(t)) return "transit";
  if (/單車|自行车|自転車|자전거|cycling|bike/.test(t)) return "walk";
  return "walk";
}

/** 空白行程預設名稱：{目的地}的小旅行 */
export function defaultBlankTripTitle(destinationLabel: string, city?: string | null): string {
  const area =
    city?.trim() || extractAreaLabel(destinationLabel) || destinationLabel.trim();
  return area ? `${area}的小旅行` : "我的小旅行";
}

function buildBlankTripSummary(form: PlanTripFormInput, destLabel: string): string {
  const hasDates = Boolean(form.startDate?.trim() && form.endDate?.trim());
  const dateLine = hasDates
    ? `旅行日期已設定。`
    : "尚未設定日期，可於行程詳情頁補設定。";
  const parts = [
    `在 ${destLabel} 的空白行程，地點與時間由你自行安排。`,
    dateLine,
    form.transport.trim() ? `交通：${form.transport.trim()}` : "",
    form.styles.length ? `風格：${form.styles.join("、")}` : "",
  ].filter(Boolean);
  return parts.join("\n").slice(0, 500);
}

function resolveTripDays(form: PlanTripFormInput): number {
  if (form.startDate?.trim() && form.endDate?.trim()) {
    return Math.max(1, daysBetweenDates(form.startDate, form.endDate));
  }
  return Math.max(1, form.days);
}

/** 手動建立用：不拉天氣、不解析封面，避免阻塞 submit */
export function buildMinimalClientBundleForManualTrip(
  destination: TripLocation,
  prefs: TravelPreferences,
): ClientContextBundle {
  return {
    preferences: prefs,
    location: tripLocationToRoamie(destination),
    weather: null,
    time: new Date().toISOString(),
    usedFallbackLocation: false,
  };
}

/** 由「規劃新行程」表單建立可手動編輯的空白收藏行程（不經 AI） */
export function buildManualTripPayloadFromPlan(
  form: PlanTripFormInput,
  bundle: ClientContextBundle,
): RoamiePayloadV2 {
  const destLabel = formatTripLocationLabel(form.destination);
  const hasStart = Boolean(form.startDate?.trim());
  const hasEnd = Boolean(form.endDate?.trim());
  const transport = inferPlanFormTransport(form.transport);
  const tripDays = resolveTripDays(form);

  return {
    version: 2,
    title: defaultBlankTripTitle(destLabel, form.destination.city),
    summary: buildBlankTripSummary(form, destLabel),
    moodTag: "",
    recommendations: [],
    itinerary: [],
    destination: destLabel,
    destinationLocation: form.destination,
    originLocation: form.origin ?? undefined,
    days: tripDays,
    generatedAt: new Date().toISOString(),
    userSaved: true,
    source: "plan",
    travelers: form.travelers,
    tripSettings: {
      startTime: "10:00",
      transport,
      ...(hasStart ? { tripStartDate: form.startDate.trim() } : {}),
      ...(hasEnd ? { tripEndDate: form.endDate.trim() } : {}),
      legMinutes: {},
      legTransport: {},
      transitLegs: {},
    },
    coreTrip: {
      budgetMode: form.budgetMode,
      transportationLabel: form.transport.trim() || null,
      travelStyles: form.styles,
    },
  };
}

export type CreateTripFromPlanOptions = {
  locale?: Locale;
};

/**
 * 手動「建立行程」：分階段寫入空殼 trip，不呼叫 AI / Unsplash / 天氣 API。
 */
export async function createTripFromPlanForm(
  form: PlanTripFormInput,
  prefs?: TravelPreferences,
): Promise<StoredItinerary> {
  logManualTripCreateStart();
  const preferences = prefs ?? (await getPreferences());
  const bundle = buildMinimalClientBundleForManualTrip(form.destination, preferences);
  const payload = buildManualTripPayloadFromPlan(form, bundle);

  console.info("[CREATE_TRIP] blank manual trip", {
    destination: payload.destination,
    title: payload.title,
    hasDates: Boolean(payload.tripSettings?.tripStartDate),
  });

  try {
    const saved = await confirmSaveTrip(payload, "plan", {
      shellOnly: true,
      skipCoverResolve: true,
      staged: true,
    });
    logManualTripCreateSuccess(saved.id);
    logManualTripSaveSuccess(saved.id, saved.title);
    console.info("[CREATE_TRIP] saved", { tripId: saved.id, title: saved.title });
    return saved;
  } catch (e) {
    logPlanTripSaveError("manual_create", e);
    throw e;
  }
}
