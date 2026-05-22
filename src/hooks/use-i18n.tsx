import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { detectDeviceLocale } from "@/lib/i18n/detect-locale";
import { translate } from "@/lib/i18n/translate";
import type { Locale } from "@/lib/i18n/types";

type I18nCtx = {
  locale: Locale;
  t: (key: string) => string;
};

const Ctx = createContext<I18nCtx | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(() => detectDeviceLocale());

  useEffect(() => {
    const sync = () => setLocaleState(detectDeviceLocale());
    document.documentElement.lang = locale;
    window.addEventListener("languagechange", sync);
    return () => window.removeEventListener("languagechange", sync);
  }, [locale]);

  const t = useCallback((key: string) => translate(locale, key), [locale]);

  const value = useMemo(() => ({ locale, t }), [locale, t]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useI18n() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useI18n must be used within I18nProvider");
  return ctx;
}
