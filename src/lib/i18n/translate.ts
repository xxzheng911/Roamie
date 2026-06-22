import type { Locale } from "@/lib/i18n/types";
import { i18nMessages } from "@/lib/i18n/messages";

const dictionaries = i18nMessages;

export type MessageKey = string;

function getMessageNode(locale: Locale, key: MessageKey): unknown {
  const parts = key.split(".");
  let node: unknown = dictionaries[locale];
  for (const part of parts) {
    if (node && typeof node === "object" && part in (node as object)) {
      node = (node as Record<string, unknown>)[part];
    } else {
      return undefined;
    }
  }
  return node;
}

export function translate(locale: Locale, key: MessageKey, vars?: Record<string, string | number>): string {
  let node = getMessageNode(locale, key);
  let text: string | undefined;
  if (typeof node === "string") text = node;
  else {
    let fb: unknown = dictionaries["zh-TW"];
    const parts = key.split(".");
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

export function translateList(locale: Locale, key: MessageKey): string[] {
  const node = getMessageNode(locale, key);
  if (Array.isArray(node)) {
    return node.filter((value): value is string => typeof value === "string");
  }
  const fallback = getMessageNode("zh-TW", key);
  if (Array.isArray(fallback)) {
    return fallback.filter((value): value is string => typeof value === "string");
  }
  return [];
}

export function t(locale: Locale, key: MessageKey, vars?: Record<string, string | number>): string {
  return translate(locale, key, vars);
}
