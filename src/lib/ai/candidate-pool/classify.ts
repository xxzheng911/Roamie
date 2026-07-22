/**
 * Destination-agnostic classifiers for Candidate Pool stages.
 * No city-specific hubs / districts.
 */
import type { PlaceResult } from "@/lib/place-result";
import {
  classifyPlanPlaceKind,
  type PlanPlaceKind,
} from "@/lib/ai/ai-day-plan-source";
import type {
  ExperienceFamily,
  PoolCategory,
  TemporalSlot,
  TravelIntent,
} from "@/lib/ai/candidate-pool/types";

function blob(place: PlaceResult): string {
  return [place.name, place.address, place.primaryType, ...(place.types ?? [])]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function typesOf(place: PlaceResult): Set<string> {
  const out = new Set<string>();
  for (const t of place.types ?? []) {
    const n = t.trim().toLowerCase();
    if (n) out.add(n);
  }
  const primary = (place.primaryType ?? "").trim().toLowerCase();
  if (primary) out.add(primary);
  return out;
}

export function planKindToPoolCategory(kind: PlanPlaceKind): PoolCategory {
  switch (kind) {
    case "restaurant":
      return "food";
    case "night_market":
      return "night";
    case "attraction":
      return "attraction";
    case "cafe":
      return "cafe";
    case "shopping":
      return "shopping";
    case "culture":
      return "culture";
    case "nature":
      return "nature";
    case "market":
      return "market";
    default:
      return "attraction";
  }
}

export function classifyPoolCategory(place: PlaceResult): PoolCategory {
  return planKindToPoolCategory(classifyPlanPlaceKind(place));
}

export function classifyExperienceFamily(place: PlaceResult): ExperienceFamily {
  const b = blob(place);
  const types = typesOf(place);

  if (/寺|廟|神社|temple|shrine|church|cathedral|mosque|heritage|古蹟|遺址/.test(b)) {
    return "temple_heritage";
  }
  if (
    types.has("museum") ||
    types.has("art_gallery") ||
    /博物|美術館|gallery|museum|展覽/.test(b)
  ) {
    return "museum_gallery";
  }
  if (
    /夜景|展望|觀景|observation|viewpoint|sky\s*deck|展望台|觀景台/.test(b) ||
    types.has("observation_deck")
  ) {
    return "observation";
  }
  if (
    types.has("park") ||
    types.has("natural_feature") ||
    /公園|步道|海岸|山|forest|trail|beach|nature|濕地/.test(b)
  ) {
    return "park_nature";
  }
  if (types.has("night_club") || /酒吧|bar|pub|居酒|夜店|nightlife/.test(b)) {
    return "nightlife";
  }
  if (/夜市|night\s*market/.test(b)) return "market";
  if (types.has("market") || /市場|market/.test(b)) return "market";
  if (
    types.has("cafe") ||
    types.has("coffee_shop") ||
    /咖啡|cafe|coffee/.test(b)
  ) {
    return "cafe";
  }
  if (
    types.has("restaurant") ||
    types.has("food") ||
    /餐|食|料理|restaurant|dining/.test(b)
  ) {
    return "food";
  }
  if (
    types.has("shopping_mall") ||
    types.has("clothing_store") ||
    /商圈|購物|shopping|百貨|outlet/.test(b)
  ) {
    return "shopping";
  }
  return "generic";
}

export function classifyTravelIntent(place: PlaceResult): TravelIntent {
  const family = classifyExperienceFamily(place);
  const category = classifyPoolCategory(place);
  switch (family) {
    case "observation":
      return "view";
    case "temple_heritage":
    case "museum_gallery":
      return "culture";
    case "food":
      return "food";
    case "shopping":
      return "shopping";
    case "cafe":
      return "relax";
    case "park_nature":
      return category === "nature" ? "relax" : "experience";
    case "nightlife":
    case "market":
      return category === "night" || family === "nightlife" ? "night" : "experience";
    default:
      if (category === "food") return "food";
      if (category === "shopping") return "shopping";
      if (category === "cafe") return "relax";
      if (category === "night") return "night";
      if (category === "culture") return "culture";
      if (category === "nature") return "relax";
      return "view";
  }
}

/**
 * Preferred temporal windows for a place (destination-agnostic).
 * Used to avoid cafe@night / bar@lunch / night-view@morning.
 */
export function classifyTemporalSlots(place: PlaceResult): TemporalSlot[] {
  const b = blob(place);
  const types = typesOf(place);
  const family = classifyExperienceFamily(place);
  const category = classifyPoolCategory(place);

  if (
    family === "nightlife" ||
    category === "night" ||
    /夜景|night\s*view|夜市|night\s*market/.test(b)
  ) {
    return ["night", "dinner"];
  }
  if (types.has("bar") || /酒吧|居酒|pub|lounge/.test(b)) {
    return ["dinner", "night"];
  }
  if (family === "cafe" || category === "cafe") {
    return ["morning", "afternoon"];
  }
  if (family === "food" || category === "food") {
    if (/早餐|breakfast|brunch|早午餐/.test(b)) return ["morning", "lunch"];
    if (/宵夜|late\s*night/.test(b)) return ["night", "dinner"];
    return ["lunch", "dinner"];
  }
  if (family === "shopping" || category === "shopping") {
    return ["afternoon", "lunch"];
  }
  if (family === "observation") {
    return ["afternoon", "night", "morning"];
  }
  if (family === "park_nature") {
    return ["morning", "afternoon"];
  }
  if (family === "temple_heritage" || family === "museum_gallery") {
    return ["morning", "afternoon"];
  }
  return ["morning", "afternoon"];
}

/** True if place is a poor fit for the given temporal slot */
export function isTemporalMismatch(
  place: PlaceResult,
  slot: TemporalSlot,
): boolean {
  const preferred = classifyTemporalSlots(place);
  if (preferred.includes(slot)) return false;

  const family = classifyExperienceFamily(place);
  // Hard mismatches
  if (slot === "morning" && (family === "nightlife" || preferred.includes("night") && !preferred.includes("morning"))) {
    return /夜景|night\s*view|酒吧|bar|夜市/.test(blob(place));
  }
  if (slot === "lunch" && family === "nightlife") return true;
  if (slot === "night" && family === "cafe") return true;
  if (slot === "night" && family === "temple_heritage") return true;
  return !preferred.includes(slot);
}
