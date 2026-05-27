/** Roamie 本地行程通知（Capacitor @capacitor/local-notifications） */
import { LocalNotifications } from "@capacitor/local-notifications";
import { Preferences } from "@capacitor/preferences";
import { isRoamiePayloadV2, type RoamiePayloadV2 } from "@/lib/ai/types";
import type { Itinerary } from "@/lib/itinerary.functions";
import type { StoredItinerary } from "@/lib/itinerary-storage";
import { resolveDisplayTitle, titleFieldsFromStored } from "@/lib/saved-trip/display";
import { detectPlatform } from "@/services/platform";
import { runWhenCapacitorBridgeReady } from "@/lib/capacitor-bridge-ready";

const TRIP_NOTIF_IDS_KEY = "roamie:trip-notification-ids";
const PERMISSION_ASKED_KEY = "roamie:notifications-permission-asked";

export type NotificationPermissionStatus = "granted" | "denied" | "prompt" | "unsupported";

export const NOTIFICATION_PERMISSION_DENIED_HINT =
  "Roamie 想在你出發前輕聲提醒。到「設定 → Roamie → 通知」開啟，就能收到旅程陪伴訊息。";

type ScheduledTripNotifications = Record<string, number[]>;

function isNativeNotificationsAvailable(): boolean {
  return detectPlatform().isNative;
}

function stableNotificationId(key: string): number {
  let hash = 0;
  for (let i = 0; i < key.length; i += 1) {
    hash = (hash << 5) - hash + key.charCodeAt(i);
    hash |= 0;
  }
  return (Math.abs(hash) % 2_000_000_000) + 1;
}

function tripNotificationKeys(tripId: string) {
  return {
    instant: `trip:${tripId}:instant`,
    eve: `trip:${tripId}:eve`,
    morning: `trip:${tripId}:morning`,
  };
}

function parseLocalDate(isoDate: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) return null;
  const [y, m, d] = isoDate.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function atLocalTime(date: Date, hour: number, minute = 0): Date {
  const next = new Date(date);
  next.setHours(hour, minute, 0, 0);
  return next;
}

export function extractTripStartDate(payload: Itinerary | RoamiePayloadV2): string | null {
  if (!isRoamiePayloadV2(payload)) return null;
  const fromSettings = payload.tripSettings?.tripStartDate?.trim();
  if (fromSettings && /^\d{4}-\d{2}-\d{2}$/.test(fromSettings)) return fromSettings;
  const fromItinerary = payload.itinerary
    ?.map((i) => i.date?.trim())
    .find((d) => d && /^\d{4}-\d{2}-\d{2}$/.test(d));
  return fromItinerary ?? null;
}

export function tripTitleForNotification(trip: StoredItinerary): string {
  return resolveDisplayTitle(titleFieldsFromStored(trip)).trim() || trip.title || "你的旅程";
}

async function readScheduledTripNotificationIds(): Promise<ScheduledTripNotifications> {
  if (!isNativeNotificationsAvailable()) return {};
  try {
    const { value } = await Preferences.get({ key: TRIP_NOTIF_IDS_KEY });
    if (!value) return {};
    const parsed = JSON.parse(value) as ScheduledTripNotifications;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

async function writeScheduledTripNotificationIds(map: ScheduledTripNotifications): Promise<void> {
  if (!isNativeNotificationsAvailable()) return;
  await Preferences.set({ key: TRIP_NOTIF_IDS_KEY, value: JSON.stringify(map) });
}

async function cancelNotificationIds(ids: number[]): Promise<void> {
  if (!ids.length || !isNativeNotificationsAvailable()) return;
  await LocalNotifications.cancel({
    notifications: ids.map((id) => ({ id })),
  });
}

/** 取消該行程已排程的通知，避免重複 */
export async function cancelTripNotifications(tripId: string): Promise<void> {
  if (!isNativeNotificationsAvailable()) return;
  await runWhenCapacitorBridgeReady("notifications.cancel", async () => {
    const map = await readScheduledTripNotificationIds();
    const ids = map[tripId] ?? [];
    await cancelNotificationIds(ids);
    delete map[tripId];
    await writeScheduledTripNotificationIds(map);
    console.info("[NOTIFICATION] cancelled tripId=", tripId, "count=", ids.length);
  });
}

export async function checkNativeNotificationPermission(): Promise<NotificationPermissionStatus> {
  if (!isNativeNotificationsAvailable()) return "unsupported";
  return runWhenCapacitorBridgeReady("notifications.check", async () => {
    const current = await LocalNotifications.checkPermissions();
    if (current.display === "granted") return "granted";
    if (current.display === "denied") return "denied";
    return "prompt";
  });
}

export async function requestNotificationPermission(options?: {
  /** 首次啟動不提示；行程儲存等情境可顯示 Roamie 風格說明 */
  showDeniedHint?: boolean;
}): Promise<NotificationPermissionStatus> {
  if (!isNativeNotificationsAvailable()) {
    console.info("[NOTIFICATION] permission unsupported (web)");
    return "unsupported";
  }

  return runWhenCapacitorBridgeReady("notifications.permission", async () => {
    const current = await LocalNotifications.checkPermissions();
    if (current.display === "granted") {
      await Preferences.set({ key: PERMISSION_ASKED_KEY, value: "1" });
      return "granted";
    }

    const asked = (await Preferences.get({ key: PERMISSION_ASKED_KEY })).value === "1";
    if (current.display === "denied" && asked) {
      if (options?.showDeniedHint) {
        const { toast } = await import("sonner");
        toast.message(NOTIFICATION_PERMISSION_DENIED_HINT, { duration: 6000 });
      }
      return "denied";
    }

    const result = await LocalNotifications.requestPermissions();
    await Preferences.set({ key: PERMISSION_ASKED_KEY, value: "1" });
    console.info("[NOTIFICATION] permission=", result.display);

    if (result.display === "granted") return "granted";
    if (options?.showDeniedHint) {
      const { toast } = await import("sonner");
      toast.message(NOTIFICATION_PERMISSION_DENIED_HINT, { duration: 6000 });
    }
    return result.display === "denied" ? "denied" : "prompt";
  });
}

/** App 啟動時請求通知權限（僅原生、僅首次） */
export async function initNotificationPermissionsOnAppLaunch(): Promise<void> {
  if (!isNativeNotificationsAvailable()) return;
  void requestNotificationPermission({ showDeniedHint: false });
}

export async function sendInstantNotification(
  title: string,
  body: string,
  options?: { tripId?: string },
): Promise<boolean> {
  if (!isNativeNotificationsAvailable()) {
    console.info("[NOTIFICATION] instant skipped (web)", { title });
    return false;
  }

  const permission = await LocalNotifications.checkPermissions();
  if (permission.display !== "granted") {
    console.info("[NOTIFICATION] instant skipped permission=", permission.display);
    return false;
  }

  const tripId = options?.tripId ?? "generic";
  const id = stableNotificationId(tripNotificationKeys(tripId).instant);

  await LocalNotifications.schedule({
    notifications: [
      {
        id,
        title,
        body,
        schedule: { at: new Date(Date.now() + 800) },
        extra: { tripId, kind: "instant" },
      },
    ],
  });

  const map = await readScheduledTripNotificationIds();
  const prev = map[tripId] ?? [];
  map[tripId] = [...new Set([...prev, id])];
  await writeScheduledTripNotificationIds(map);

  console.info("[NOTIFICATION] instant scheduled id=", id);
  return true;
}

/** 出發前一天晚上 8:00 */
export async function scheduleTripReminder(
  tripId: string,
  tripTitle: string,
  startDateIso: string,
): Promise<boolean> {
  if (!isNativeNotificationsAvailable()) return false;

  const start = parseLocalDate(startDateIso);
  if (!start) return false;

  const dayBefore = new Date(start);
  dayBefore.setDate(dayBefore.getDate() - 1);
  const eve = atLocalTime(dayBefore, 20);
  if (eve.getTime() <= Date.now()) {
    console.info("[NOTIFICATION] eve skipped (past)", startDateIso);
    return false;
  }

  const permission = await LocalNotifications.checkPermissions();
  if (permission.display !== "granted") return false;

  const id = stableNotificationId(tripNotificationKeys(tripId).eve);
  await LocalNotifications.schedule({
    notifications: [
      {
        id,
        title: "明天就要出發了 ✈️",
        body: `明天就要出發去「${tripTitle}」了，別忘了帶上期待。Roamie 已幫你準備好旅程。`,
        schedule: { at: eve },
        extra: { tripId, kind: "eve" },
      },
    ],
  });

  const map = await readScheduledTripNotificationIds();
  const prev = map[tripId] ?? [];
  map[tripId] = [...new Set([...prev, id])];
  await writeScheduledTripNotificationIds(map);

  console.info("[NOTIFICATION] eve scheduled", { tripId, at: eve.toISOString() });
  return true;
}

/** 出發當天早上 8:00 */
export async function scheduleTripStartReminder(
  tripId: string,
  tripTitle: string,
  startDateIso: string,
): Promise<boolean> {
  if (!isNativeNotificationsAvailable()) return false;

  const start = parseLocalDate(startDateIso);
  if (!start) return false;

  const morning = atLocalTime(start, 8);
  if (morning.getTime() <= Date.now()) {
    console.info("[NOTIFICATION] morning skipped (past)", startDateIso);
    return false;
  }

  const permission = await LocalNotifications.checkPermissions();
  if (permission.display !== "granted") return false;

  const id = stableNotificationId(tripNotificationKeys(tripId).morning);
  await LocalNotifications.schedule({
    notifications: [
      {
        id,
        title: "今天適合慢慢出發",
        body: `「${tripTitle}」的旅程今天開始，Roamie 已幫你準備好，祝你一路順心。`,
        schedule: { at: morning },
        extra: { tripId, kind: "morning" },
      },
    ],
  });

  const map = await readScheduledTripNotificationIds();
  const prev = map[tripId] ?? [];
  map[tripId] = [...new Set([...prev, id])];
  await writeScheduledTripNotificationIds(map);

  console.info("[NOTIFICATION] morning scheduled", { tripId, at: morning.toISOString() });
  return true;
}

/** 行程儲存成功後：即時通知 + 依開始日排程 */
export async function syncTripNotificationsAfterSave(trip: StoredItinerary): Promise<void> {
  if (!isNativeNotificationsAvailable()) return;

  await runWhenCapacitorBridgeReady("notifications.sync", async () => {
    const permission = await requestNotificationPermission({ showDeniedHint: true });
    const title = tripTitleForNotification(trip);

    if (permission !== "granted") return;

    await cancelTripNotifications(trip.id);

    await sendInstantNotification("你的旅程已準備好了 ✨", `「${title}」已收進收藏，Roamie 會陪你一起出發。`, {
      tripId: trip.id,
    });

    const startDate = extractTripStartDate(trip.payload);
    if (!startDate) {
      console.info("[NOTIFICATION] no start date, skip reminders tripId=", trip.id);
      return;
    }

    await scheduleTripReminder(trip.id, title, startDate);
    await scheduleTripStartReminder(trip.id, title, startDate);
  });
}
