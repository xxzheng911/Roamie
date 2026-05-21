import { normalizeItineraryItem, normalizeRecommendationItem, type RoamieResponse } from "./types";

/** Best-effort parse while JSON is still streaming from the model. */
export function parsePartialRoamieJson(buffer: string): Partial<RoamieResponse> {
  const trimmed = buffer.trim();
  if (!trimmed) return {};

  try {
    const parsed = JSON.parse(trimmed) as Partial<RoamieResponse>;
    return parsed;
  } catch {
    /* continue with field extraction */
  }

  const partial: Partial<RoamieResponse> = {};

  const pickString = (key: string) => {
    const re = new RegExp(`"${key}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"`);
    const m = trimmed.match(re);
    if (m) partial[key as keyof RoamieResponse] = m[1].replace(/\\n/g, "\n").replace(/\\"/g, '"') as never;
  };

  pickString("title");
  pickString("summary");
  pickString("moodTag");

  const recBlock = trimmed.match(/"recommendations"\s*:\s*\[/);
  if (recBlock) {
    const items: RoamieResponse["recommendations"] = [];
    const itemRe =
      /\{\s*"name"\s*:\s*"((?:[^"\\]|\\.)*)"\s*,\s*"type"\s*:\s*"((?:[^"\\]|\\.)*)"\s*,\s*"description"\s*:\s*"((?:[^"\\]|\\.)*)"\s*,\s*"reason"\s*:\s*"((?:[^"\\]|\\.)*)"\s*,\s*"estimatedTime"\s*:\s*"((?:[^"\\]|\\.)*)"\s*,\s*"address"\s*:\s*"((?:[^"\\]|\\.)*)"\s*\}/g;
    let m: RegExpExecArray | null;
    while ((m = itemRe.exec(trimmed))) {
      items.push(
        normalizeRecommendationItem({
          name: m[1],
          type: m[2],
          description: m[3],
          reason: m[4],
          estimatedTime: m[5],
          address: m[6],
          lat: null,
          lng: null,
        }),
      );
    }
    if (items.length) partial.recommendations = items;
  }

  const itinBlock = trimmed.match(/"itinerary"\s*:\s*\[/);
  if (itinBlock) {
    const items: RoamieResponse["itinerary"] = [];
    const itemRe =
      /\{\s*"date"\s*:\s*"((?:[^"\\]|\\.)*)"\s*,\s*"time"\s*:\s*"((?:[^"\\]|\\.)*)"\s*,\s*"title"\s*:\s*"((?:[^"\\]|\\.)*)"\s*,\s*"description"\s*:\s*"((?:[^"\\]|\\.)*)"\s*,\s*"placeName"\s*:\s*"((?:[^"\\]|\\.)*)"\s*\}/g;
    let m: RegExpExecArray | null;
    while ((m = itemRe.exec(trimmed))) {
      items.push(
        normalizeItineraryItem({
          date: m[1],
          time: m[2],
          title: m[3],
          description: m[4],
          placeName: m[5],
          lat: null,
          lng: null,
        }),
      );
    }
    if (items.length) partial.itinerary = items;
  }

  return partial;
}
