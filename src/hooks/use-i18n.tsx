import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { resolveLocaleSync, resolveLocaleAsync, coerceLocale } from "@/lib/i18n/resolve-locale";
import { writeStoredLocale } from "@/lib/i18n/detect-locale";
import { saveProfileLanguage } from "@/lib/profile-storage";
import { translate } from "@/lib/i18n/translate";
import type { Locale } from "@/lib/i18n/types";

export const ROAMIE_LOCALE_CHANGED = "roamie:locale-changed";

type I18nCtx = {
  locale: Locale;
  t: (key: string) => string;
  setLocale: (next: Locale) => Promise<void>;
};

const Ctx = createContext<I18nCtx | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(() => resolveLocaleSync());

  useEffect(() => {
    let cancelled = false;
    resolveLocaleAsync().then((resolved) => {
      if (!cancelled) {
        setLocaleState(resolved);
        writeStoredLocale(resolved);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  const setLocale = useCallback(async (next: Locale) => {
    const resolved = coerceLocale(next);
    writeStoredLocale(resolved);
    setLocaleState(resolved);
    try {
      await saveProfileLanguage(resolved);
    } catch (e) {
      console.warn("[Roamie i18n] saveProfileLanguage failed", e);
    }
    window.dispatchEvent(new CustomEvent(ROAMIE_LOCALE_CHANGED, { detail: resolved }));
  }, []);

  const t = useCallback(
    (key: string, vars?: Record<string, string | number>) => translate(locale, key, vars),
    [locale],
  );

  const value = useMemo(() => ({ locale, t, setLocale }), [locale, t, setLocale]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useI18n() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useI18n must be used within I18nProvider");
  return ctx;
}
