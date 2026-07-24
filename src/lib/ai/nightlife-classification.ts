import type { PlaceResult } from "@/lib/place-result";

export type NightlifeSubtype =
  | "bar"
  | "night_club"
  | "pub"
  | "live_music_bar"
  | "adult_entertainment"
  | "night_market"
  | "night_beach_club"
  | "day_beach_club"
  | "none";

export type NightlifeClassification = {
  isNightlife: boolean;
  nightlifeSubtype: NightlifeSubtype;
  confidence: number;
  evidenceTypes: string[];
  reason: string;
};

const EXPLICIT_NIGHTLIFE_TYPES = new Set([
  "bar", "night_club", "nightclub", "cocktail_bar", "pub",
  "live_music_bar", "adult_entertainment",
]);

function normalizedTypes(place: PlaceResult): string[] {
  return [...new Set([place.primaryType, ...(place.types ?? [])]
    .filter(Boolean)
    .map((type) => String(type).trim().toLowerCase())
    .filter(Boolean))];
}

/** Trusted type-first classification. Names alone never create a hard nightlife result. */
export function resolveNightlifeClassification(place: PlaceResult): NightlifeClassification {
  const types = normalizedTypes(place);
  const explicit = types.filter((type) => EXPLICIT_NIGHTLIFE_TYPES.has(type));
  const blob = [place.name, place.localizedDisplayName, place.originalName]
    .filter(Boolean).join(" ").toLowerCase();
  const isBeachClub = types.includes("beach_club") || /beach\s*club|海灘俱樂部|海滩俱乐部/i.test(blob);

  if (types.includes("night_market")) {
    return { isNightlife: true, nightlifeSubtype: "night_market", confidence: 1, evidenceTypes: ["night_market"], reason: "explicit_night_market_type" };
  }
  if (isBeachClub) {
    const nighttimeEvidence = explicit.filter((type) => type !== "bar");
    if (nighttimeEvidence.length || (explicit.includes("bar") && types.includes("night_club"))) {
      return { isNightlife: true, nightlifeSubtype: "night_beach_club", confidence: 0.95, evidenceTypes: explicit, reason: "beach_club_with_explicit_nightlife_type" };
    }
    return { isNightlife: false, nightlifeSubtype: "day_beach_club", confidence: 0.9, evidenceTypes: types.filter((type) => type === "beach_club"), reason: "beach_club_without_nightlife_type" };
  }
  if (explicit.length) {
    const type = explicit[0]!;
    const subtype: NightlifeSubtype = type === "nightclub" ? "night_club" : type as NightlifeSubtype;
    return { isNightlife: true, nightlifeSubtype: subtype, confidence: 1, evidenceTypes: explicit, reason: "explicit_places_type" };
  }
  if (/酒吧|夜店|night\s*club|cocktail\s*bar|居酒屋|izakaya/i.test(blob)) {
    return { isNightlife: false, nightlifeSubtype: "none", confidence: 0.35, evidenceTypes: [], reason: "name_only_low_confidence" };
  }
  return { isNightlife: false, nightlifeSubtype: "none", confidence: 1, evidenceTypes: [], reason: "no_nightlife_evidence" };
}

