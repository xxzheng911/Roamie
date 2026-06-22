import { isRoamiePayloadV2, type RoamiePayloadV2 } from "@/lib/ai/types";
import { isCapacitorNativeShell } from "@/lib/chat-keyboard-layout";
import { listItineraries, SAVED_TRIPS_CHANGED_EVENT } from "@/lib/itinerary-storage";
import { resolveDisplayTitle, titleFieldsFromStored } from "@/lib/saved-trip/display";
import { getProfileNotificationsEnabled } from "@/lib/profile-storage";
import { isNotificationGrantedAsync } from "@/lib/notification-permission";
import type { Locale } from "@/lib/i18n/types";
import { translate } from "@/lib/i18n/translate";

const TRIP_REMINDER_ID_BASE = 10_000;

function notificationIdForTrip(tripId: string): number {
  let hash = 0;
  for (let i = 0; i < tripId.length; i += 1) {
    hash = (hash * 31 + tripId.charCodeAt(i)) >>> 0;
  }
  return TRIP_REMINDER_ID_BASE + (hash % 80_000);
}

function tripStartDate(payload: unknown): string | null {
  if (!isRoamiePayloadV2(payload)) return null;
  const date = payload.tripSettings?.tripStartDate?.trim();
  return date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null;
}

function tripTitleFromStored(trip: {
  title: string;
  custom_title?: string | null;
  is_title_customized?: boolean | null;
  payload: unknown;
}): string {
  const display = resolveDisplayTitle(
    titleFieldsFromStored({
      title: trip.title,
      custom_title: trip.custom_title ?? null,
      is_title_customized: Boolean(trip.is_title_customized),
    }),
  );
  if (display.trim()) return display.trim();
  if (isRoamiePayloadV2(trip.payload)) {
    return (trip.payload as RoamiePayloadV2).title?.trim() || "Roamie";
  }
  return "Roamie";
}

function reminderAtLocal(dateYmd: string, hour = 9): Date {
  const [y, m, d] = dateYmd.split("-").map((part) => Number.parseInt(part, 10));
  return new Date(y, m - 1, d, hour, 0, 0, 0);
}

async function getLocalNotificationsPlugin() {
  if (!isCapacitorNativeShell()) return null;
  try {
    const { LocalNotifications } = await import("@capacitor/local-notifications");
    return LocalNotifications;
  } catch {
    return null;
  }
}

export async function cancelAllTripReminders(): Promise<void> {
  const plugin = await getLocalNotificationsPlugin();
  if (!plugin) return;
  try {
    const pending = await plugin.getPending();
    const tripIds = (pending.notifications ?? [])
      .map((n) => n.id)
      .filter((id): id is number => typeof id === "number" && id >= TRIP_REMINDER_ID_BASE);
    if (tripIds.length) {
      await plugin.cancel({ notifications: tripIds.map((id) => ({ id })) });
    }
  } catch (e) {
    console.warn("[trip-reminders] cancel failed", e);
  }
}

export async function scheduleTripReminders(locale: Locale = "zh-TW"): Promise<void> {
  const plugin = await getLocalNotificationsPlugin();
  if (!plugin) return;
  if (!(await isNotificationGrantedAsync())) return;

  await cancelAllTripReminders();

  let trips: Awaited<ReturnType<typeof listItineraries>> = [];
  try {
    trips = await listItineraries();
  } catch (e) {
    console.warn("[trip-reminders] list trips failed", e);
    return;
  }

  const now = Date.now();
  const notifications: Array<{
    id: number;
    title: string;
    body: string;
    schedule: { at: Date };
  }> = [];

  for (const trip of trips) {
    const startDate = tripStartDate(trip.payload);
    if (!startDate) continue;

    const at = reminderAtLocal(startDate, 9);
    if (at.getTime() <= now) continue;

    const title = tripTitleFromStored(trip);
    notifications.push({
      id: notificationIdForTrip(trip.id),
      title: translate(locale, "settings.tripReminderTitle", { title }),
      body: translate(locale, "settings.tripReminderBody", { date: startDate }),
      schedule: { at },
    });
  }

  if (!notifications.length) return;

  try {
    await plugin.schedule({ notifications });
    console.info("[trip-reminders] scheduled", { count: notifications.length });
  } catch (e) {
    console.warn("[trip-reminders] schedule failed", e);
  }
}

/** 依使用者偏好與系統權限同步提醒排程 */
export async function syncTripReminderNotifications(locale: Locale = "zh-TW"): Promise<void> {
  const enabled = await getProfileNotificationsEnabled();
  if (!enabled) {
    await cancelAllTripReminders();
    return;
  }
  if (!(await isNotificationGrantedAsync())) {
    await cancelAllTripReminders();
    return;
  }
  await scheduleTripReminders(locale);
}

let bootstrapStarted = false;

export function ensureTripReminderBootstrap(getLocale: () => Locale): void {
  if (typeof window === "undefined" || bootstrapStarted) return;
  bootstrapStarted = true;

  const sync = () => {
    void syncTripReminderNotifications(getLocale());
  };

  sync();
  window.addEventListener(SAVED_TRIPS_CHANGED_EVENT, sync);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") sync();
  });
}
