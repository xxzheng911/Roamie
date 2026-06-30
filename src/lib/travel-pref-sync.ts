import { toast } from "sonner";
import {
  logPreferencesSyncFailure,
  serializePreferencesSyncError,
  type TravelPreferences,
} from "@/lib/preferences-storage";
import {
  upsertTravelPersonalityToSupabase,
  TRAVEL_PREF_UPSERT_TIMEOUT_MS,
} from "@/lib/travel-pref-supabase-upsert";
import { shouldScheduleTravelPrefSync } from "@/lib/travel-pref-sync-state";

const SYNC_COOLDOWN_MS = 60_000;
const RETRY_DELAY_MS = 30_000;

type SyncKind = "prefs" | "quiz";

type SyncSlot = {
  inflight: Promise<void> | null;
  lastAttemptAt: number;
  retryScheduled: boolean;
  retryUsed: boolean;
};

const slots: Record<SyncKind, SyncSlot> = {
  prefs: { inflight: null, lastAttemptAt: 0, retryScheduled: false, retryUsed: false },
  quiz: { inflight: null, lastAttemptAt: 0, retryScheduled: false, retryUsed: false },
};

function isTimeoutError(error: unknown): boolean {
  const row = serializePreferencesSyncError(error);
  const message = String(row.message ?? "");
  return /timeout/i.test(message);
}

function scheduleRetry(kind: SyncKind, source: string, run: () => Promise<void>): void {
  const slot = slots[kind];
  if (slot.retryUsed || slot.retryScheduled) return;
  slot.retryScheduled = true;
  window.setTimeout(() => {
    slot.retryScheduled = false;
    slot.retryUsed = true;
    slot.lastAttemptAt = 0;
    void runBackgroundTravelPrefSync(kind, `${source}-retry`, run, { allowRetry: false });
  }, RETRY_DELAY_MS);
}

async function runBackgroundTravelPrefSync(
  kind: SyncKind,
  source: string,
  run: () => Promise<void>,
  options?: { allowRetry?: boolean },
): Promise<void> {
  const slot = slots[kind];
  const allowRetry = options?.allowRetry !== false;

  if (slot.inflight) return;

  const now = Date.now();
  if (now - slot.lastAttemptAt < SYNC_COOLDOWN_MS) return;

  slot.lastAttemptAt = now;

  slot.inflight = run()
    .then(() => {
      slot.retryUsed = false;
    })
    .catch((error) => {
      if (isTimeoutError(error)) {
        toast.message("已暫存，稍後同步");
      }
      logPreferencesSyncFailure(`${kind} background sync`, error, { source });
      if (allowRetry) {
        scheduleRetry(kind, source, run);
      }
    })
    .finally(() => {
      slot.inflight = null;
    });

  await slot.inflight;
}

/** 僅 pendingSync=true 且尚未 syncedAt 時背景 upsert；最多 retry 1 次 */
export function scheduleBackgroundTravelPrefSync(
  merged: TravelPreferences,
  source: string,
  options?: { travelStyle?: string | null; userId?: string },
): void {
  const userId = options?.userId;
  if (userId && !shouldScheduleTravelPrefSync(userId)) return;
  if (!userId && !shouldScheduleTravelPrefSync()) return;

  void runBackgroundTravelPrefSync("prefs", source, () =>
    upsertTravelPersonalityToSupabase({
      userId: userId ?? undefined,
      prefs: merged,
      travelStyle: options?.travelStyle ?? merged.personalityType ?? null,
      source,
    }),
  );
}

/** 測驗完成後遠端 upsert（含 ai_preferences） */
export function scheduleBackgroundTravelQuizSync(
  run: () => Promise<void>,
  source: string,
): void {
  void runBackgroundTravelPrefSync("quiz", source, run);
}

/** App boot / hydrate 後：若 local 有 pendingSync 才同步一次 */
export function schedulePendingTravelPrefSyncIfNeeded(
  prefs: TravelPreferences,
  userId?: string | null,
  travelStyle?: string | null,
): void {
  if (!shouldScheduleTravelPrefSync(userId)) return;
  scheduleBackgroundTravelPrefSync(prefs, "boot-pending-sync", {
    userId: userId ?? undefined,
    travelStyle,
  });
}

export { TRAVEL_PREF_UPSERT_TIMEOUT_MS };
