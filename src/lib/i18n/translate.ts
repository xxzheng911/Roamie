import type { Locale } from "@/lib/i18n/types";
import { i18nMessages } from "@/lib/i18n/messages";

const dictionaries = i18nMessages;

export type MessageKey = string;

export function translate(locale: Locale, key: MessageKey, vars?: Record<string, string | number>): string {
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
  let text: string | undefined;
  if (typeof node === "string") text = node;
  else {
    let fb: unknown = dictionaries["zh-TW"];
    for (const part of parts) {
      if (fb && typeof fb === "object" && part in (fb as object)) {
        fb = (fb as Record<string, unknown>)[part];
      } else {
        return key;
      }
    }
    text = typeof fb === "string" ? fb : undefined;
  }
  if (!text) return key;
  if (!vars) return text;
  return text.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? ""));
}

export function t(locale: Locale, key: MessageKey, vars?: Record<string, string | number>): string {
  return translate(locale, key, vars);
}
