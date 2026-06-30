import { useEffect, useState } from "react";
import { PREFS_UPDATED_EVENT } from "@/lib/preference-events";
import {
  getTravelPrefStatusSync,
  type TravelPrefStatus,
} from "@/lib/travel-pref-status";
import { readCachedAuthenticatedUserIdSync } from "@/lib/auth-session";

/** 全 app 共用 travel pref 狀態；不觸發 Supabase / getPreferences 網路請求 */
export function useTravelPrefStatus(): TravelPrefStatus | null {
  const [status, setStatus] = useState<TravelPrefStatus | null>(() => {
    if (typeof window === "undefined") return null;
    return getTravelPrefStatusSync(readCachedAuthenticatedUserIdSync());
  });

  useEffect(() => {
    const refresh = () => {
      setStatus(getTravelPrefStatusSync(readCachedAuthenticatedUserIdSync()));
    };
    refresh();
    window.addEventListener(PREFS_UPDATED_EVENT, refresh);
    return () => window.removeEventListener(PREFS_UPDATED_EVENT, refresh);
  }, []);

  return status;
}

/** @deprecated Prefer `useTravelPrefStatus` */
export function usePreferenceQuizCompleted(): boolean | null {
  const status = useTravelPrefStatus();
  if (status === null) return null;
  return status.preferenceQuizCompleted;
}
