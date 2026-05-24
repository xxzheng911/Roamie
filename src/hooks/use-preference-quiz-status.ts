import { useEffect, useState } from "react";
import { isPreferenceQuizCompleted } from "@/lib/preferences-storage";
import { PREFS_UPDATED_EVENT } from "@/lib/preference-events";

/** `null` while loading; `true` when quiz completed (`onboarded`). */
export function usePreferenceQuizCompleted(): boolean | null {
  const [completed, setCompleted] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    const refresh = async () => {
      const done = await isPreferenceQuizCompleted();
      if (!cancelled) setCompleted(done);
    };
    void refresh();
    const onUpdate = () => void refresh();
    window.addEventListener(PREFS_UPDATED_EVENT, onUpdate);
    return () => {
      cancelled = true;
      window.removeEventListener(PREFS_UPDATED_EVENT, onUpdate);
    };
  }, []);

  return completed;
}
