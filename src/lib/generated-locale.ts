import type { Locale } from "@/lib/i18n/types";

/** Missing provenance means legacy/unknown, never the reader's current locale.
 * Attach only when generating prose, not when loading, editing or saving old data.
 * Neutral facts, external names and user-authored text do not use this contract.
 */
export type GeneratedLocaleContract = { generatedLocale?: Locale };

export function readGeneratedLocale(value: unknown): Locale | undefined {
  return value === "zh-TW" || value === "en" || value === "ja" || value === "ko"
    ? value
    : undefined;
}

export function isCurrentGeneratedCopy(record: GeneratedLocaleContract, locale: Locale): boolean {
  return readGeneratedLocale(record.generatedLocale) === locale;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasLegacyResponseFields(value: Record<string, unknown>): boolean {
  return ["title", "summary", "moodTag", "recommendations", "itinerary"].some((key) =>
    Object.prototype.hasOwnProperty.call(value, key),
  );
}

/** Additive metadata in the existing text column. Keep legacy display fields at the
 * top level and preserve unknown business fields. An existing provenance field is
 * never overwritten (invalid provenance remains unknown to readers).
 */
export function encodeGeneratedChatContent(content: string, generatedLocale: Locale): string {
  let payload: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(content);
    payload = isRecord(parsed) ? parsed : { summary: content };
  } catch {
    // Plain-text responses still need a summary readable by legacy JSON readers.
    payload = { summary: content };
  }
  return JSON.stringify(
    Object.prototype.hasOwnProperty.call(payload, "generatedLocale")
      ? payload
      : { ...payload, generatedLocale },
  );
}

export function decodeGeneratedChatContent(content: string): GeneratedLocaleContract & { content: string } {
  try {
    const parsed: unknown = JSON.parse(content);
    if (!isRecord(parsed)) return { content };
    // A real flat response wins over envelope-like extension fields.
    if (hasLegacyResponseFields(parsed)) {
      return { content, generatedLocale: readGeneratedLocale(parsed.generatedLocale) };
    }
    if (parsed.kind === "roamie.assistant.v1" &&
        (typeof parsed.content === "string" || isRecord(parsed.content))) {
      return {
        content: typeof parsed.content === "string" ? parsed.content : JSON.stringify(parsed.content),
        // The envelope's provenance is authoritative, even when missing/invalid.
        generatedLocale: readGeneratedLocale(parsed.generatedLocale),
      };
    }
  } catch { /* Legacy plain text is valid historical content. */ }
  return { content };
}
