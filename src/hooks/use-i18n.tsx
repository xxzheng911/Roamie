import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  clearStoredLocaleOverrides,
  detectDeviceLocale,
} from "@/lib/i18n/detect-locale";
import { translate, translateList } from "@/lib/i18n/translate";
import { ensureTripReminderBootstrap } from "@/lib/trip-reminder-notifications";
import type { Locale, LocalePreference } from "@/lib/i18n/types";

export const ROAMIE_LOCALE_CHANGED = "roamie:locale-changed";

type I18nCtx = {
  locale: Locale;
  /** @deprecated 與 locale 相同；App 不再提供語言覆寫 */
  localePreference: LocalePreference;
  t: (key: string, vars?: Record<string, string | number>) => string;
  tList: (key: string) => string[];
  /** @deprecated App 語言跟隨裝置，此為 no-op */
  setLocalePreference: (next: LocalePreference) => Promise<void>;
  /** @deprecated 使用 setLocalePreference */
  setLocale: (next: Locale) => Promise<void>;
};

const Ctx = createContext<I18nCtx | null>(null);

function readDeviceLocale(): Locale {
  return detectDeviceLocale();
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(() => readDeviceLocale());

  useEffect(() => {
    clearStoredLocaleOverrides();

    const syncLocale = () => {
      const next = readDeviceLocale();
      setLocaleState((prev) => {
        if (prev === next) return prev;
        window.dispatchEvent(new CustomEvent(ROAMIE_LOCALE_CHANGED, { detail: next }));
        return next;
      });
    };

    syncLocale();
    window.addEventListener("languagechange", syncLocale);
    return () => window.removeEventListener("languagechange", syncLocale);
  }, []);

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  useEffect(() => {
    ensureTripReminderBootstrap(() => locale);
  }, [locale]);

  const setLocalePreference = useCallback(async (_next: LocalePreference) => {
    /* App 語言跟隨裝置，不提供 App 內覆寫 */
  }, []);

  const setLocale = useCallback(async (_next: Locale) => {
    /* App 語言跟隨裝置，不提供 App 內覆寫 */
  }, []);

  const t = useCallback(
    (key: string, vars?: Record<string, string | number>) => translate(locale, key, vars),
    [locale],
  );

  const tList = useCallback((key: string) => translateList(locale, key), [locale]);

  const value = useMemo(
    () => ({
      locale,
      localePreference: locale,
      t,
      tList,
      setLocalePreference,
      setLocale,
    }),
    [locale, t, tList, setLocalePreference, setLocale],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useI18n() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useI18n must be used within I18nProvider");
  return ctx;
}
