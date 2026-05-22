import type { Locale } from "@/lib/i18n/types";
import { en } from "@/lib/i18n/locales/en";
import { ja } from "@/lib/i18n/locales/ja";
import { ko } from "@/lib/i18n/locales/ko";
import { zhTW } from "@/lib/i18n/locales/zh-TW";

const dictionaries = {
  "zh-TW": zhTW,
  en,
  ja,
  ko,
} as const;

export type MessageKey = string;

export function translate(locale: Locale, key: MessageKey): string {
  const parts = key.split(".");
  let node: unknown = dictionaries[locale];
  for (const part of parts) {
    if (node && typeof node === "object" && part in (node as object)) {
      node = (node as Record<string, unknown>)[part];
    } else {
      node = undefined;
      break;
    }
  }
  if (typeof node === "string") return node;
  // Fallback to zh-TW
  let fb: unknown = dictionaries["zh-TW"];
  for (const part of parts) {
    if (fb && typeof fb === "object" && part in (fb as object)) {
      fb = (fb as Record<string, unknown>)[part];
    } else {
      return key;
    }
  }
  return typeof fb === "string" ? fb : key;
}
