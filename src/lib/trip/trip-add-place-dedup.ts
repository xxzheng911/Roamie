import type { RoamieRecommendationItem } from "@/lib/ai/types";
import type { ChatPlaceItem } from "@/lib/chat-session";
import { distanceMeters } from "@/lib/geo-distance";
import { normalizePlaceName } from "@/lib/place-planning-memory";
import type { TripAddPlaceContext } from "@/lib/trip/trip-add-place-session";
import type { TripAddPlaceRecommendationSession } from "@/lib/trip/trip-add-place-recommendation-session";
import { placeIdentityKey } from "@/lib/place-planning-memory";

export function normalizeStoredPlaceId(id: string): string {
  const t = id.trim();
  if (!t) return "";
  if (t.startsWith("id:") || t.startsWith("na:") || t.startsWith("n:")) return t;
  return `id:${t}`;
}

export function placeIdFromRecommendation(
  rec: RoamieRecommendationItem | ChatPlaceItem,
): string {
  return placeIdentityKey(rec);
}

function normalizeShownIdsLocal(ids: string[]): string[] {
  return [...new Set(ids.map((id) => normalizeStoredPlaceId(id)).filter(Boolean))];
}

export const TRIP_PLACE_PROXIMITY_M = 100;

type PlaceInput = RoamieRecommendationItem | ChatPlaceItem | {
  name?: string | null;
  placeName?: string | null;
  googlePlaceId?: string | null;
  placeId?: string | null;
  lat?: number | null;
  lng?: number | null;
  type?: string | null;
  address?: string | null;
};

const SUFFIX_RE =
  /\b(temple|shrine|tower|park|museum|mall|station|garden|castle|palace|memorial|gallery|observatory|deck)\b/gi;

const SUFFIX_JA_RE =
  /(寺|神社|塔|公園|美術館|博物館|商場|駅|站|庭園|城|宮|記念|ギャラリー|展望台)/g;

/** 知名地點多語系 alias → canonical slug */
const TRIP_PLACE_ALIAS_GROUPS: Record<string, readonly string[]> = {
  tokyo_tower: ["東京鐵塔", "东京塔", "tokyo tower", "東京タワー", "tokyotower"],
  zojoji: ["增上寺", "増上寺", "zojoji", "zojo-ji", "zojoji temple", "zojojitemple"],
  shiba_park: ["芝公園", "芝公园", "shiba park", "shibapark", "shiba-koen"],
  shibakoen: ["芝公園", "shiba park", "shibakoen", "芝公園駅"],
  tokyo_skytree: ["東京晴空塔", "东京晴空塔", "tokyo skytree", "東京スカイツリー", "skytree"],
  sensoji: ["淺草寺", "浅草寺", "sensoji", "senso-ji", "sensoji temple", "浅草"],
  meiji_shrine: ["明治神宮", "明治神宫", "meiji shrine", "meiji jingu", "meijijingu"],
  ueno_park: ["上野公園", "上野公园", "ueno park", "uenokoen"],
  imperial_palace: ["皇居", "imperial palace", "kokyo", "皇居外苑"],
  tsukiji: ["築地市場", "筑地市场", "tsukiji", "tsukiji market"],
  teamlab: ["team lab", "teamlab", "teamLab", "team lab borderless", "team lab planets"],
};

const ALIAS_LOOKUP = new Map<string, string>();

for (const [slug, aliases] of Object.entries(TRIP_PLACE_ALIAS_GROUPS)) {
  for (const alias of aliases) {
    ALIAS_LOOKUP.set(compactToken(alias), slug);
  }
  ALIAS_LOOKUP.set(slug, slug);
}

function compactToken(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[（(].*[)）]/g, "")
    .replace(/[^a-z0-9\u3040-\u30ff\u3400-\u9fff]/gi, "");
}

function stripSuffixes(compact: string): string {
  return compact
    .replace(SUFFIX_RE, "")
    .replace(SUFFIX_JA_RE, "")
    .replace(/(temple|shrine|tower|park|museum|mall|station)$/i, "");
}

/** 行程加點：canonical name key（跨語系） */
export function tripCanonicalPlaceKey(name: string): string {
  const raw = (name ?? "").trim();
  if (!raw) return "";

  const compact = compactToken(raw);
  if (!compact) return "";

  const alias = ALIAS_LOOKUP.get(compact);
  if (alias) return alias;

  const stripped = stripSuffixes(compact);
  const aliasStripped = ALIAS_LOOKUP.get(stripped);
  if (aliasStripped) return aliasStripped;

  for (const [slug, aliases] of Object.entries(TRIP_PLACE_ALIAS_GROUPS)) {
    if (aliases.some((a) => compact.includes(compactToken(a)) || compactToken(a).includes(compact))) {
      return slug;
    }
  }

  return stripped || compact;
}

/** ~100m 網格 geohash（用於近似去重） */
export function tripPlaceGeoCell(lat: number | null | undefined, lng: number | null | undefined): string | null {
  if (lat == null || lng == null) return null;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return `${Math.round(lat * 1000)}:${Math.round(lng * 1000)}`;
}

export type TripPlaceFingerprint = {
  placeId: string;
  canonicalKey: string;
  geoCell: string | null;
  aliasKey: string;
  name: string;
  lat: number | null;
  lng: number | null;
  type: string;
  aliases: string[];
};

export function extractTripPlaceFingerprint(place: PlaceInput): TripPlaceFingerprint {
  const ext = place as RoamieRecommendationItem & {
    placeId?: string;
    googlePlaceId?: string;
    primaryType?: string | null;
    category?: string | null;
  };
  const name = (ext.placeName ?? ext.name ?? "").trim() || "Unknown";
  const placeId = normalizeStoredPlaceId(
    ext.googlePlaceId ?? ext.placeId ?? placeIdFromRecommendation(place as RoamieRecommendationItem),
  );
  const canonicalKey = tripCanonicalPlaceKey(name);
  const aliasKey = ALIAS_LOOKUP.get(compactToken(name)) ?? canonicalKey;
  const lat = ext.lat ?? null;
  const lng = ext.lng ?? null;
  const type = (ext.primaryType ?? ext.category ?? ext.type ?? "").trim().toLowerCase();

  const aliases = new Set<string>([compactToken(name), canonicalKey, aliasKey]);
  for (const [slug, group] of Object.entries(TRIP_PLACE_ALIAS_GROUPS)) {
    if (group.some((a) => compactToken(a) === compactToken(name) || compactToken(name).includes(compactToken(a)))) {
      aliases.add(slug);
      for (const a of group) aliases.add(compactToken(a));
    }
  }

  return {
    placeId,
    canonicalKey,
    geoCell: tripPlaceGeoCell(lat, lng),
    aliasKey,
    name,
    lat,
    lng,
    type,
    aliases: [...aliases].filter(Boolean),
  };
}

export type TripAddPlaceDedupRegistry = {
  placeIds: Set<string>;
  canonicalKeys: Set<string>;
  geoCells: Set<string>;
  aliasKeys: Set<string>;
  anchors: Array<{
    lat: number;
    lng: number;
    canonicalKey: string;
    aliasKey: string;
    type: string;
    name: string;
  }>;
};

export function createTripAddPlaceDedupRegistry(): TripAddPlaceDedupRegistry {
  return {
    placeIds: new Set(),
    canonicalKeys: new Set(),
    geoCells: new Set(),
    aliasKeys: new Set(),
    anchors: [],
  };
}

export function registerTripPlaceFingerprint(
  registry: TripAddPlaceDedupRegistry,
  place: PlaceInput,
): void {
  const fp = extractTripPlaceFingerprint(place);
  if (fp.placeId) registry.placeIds.add(fp.placeId);
  if (fp.canonicalKey) registry.canonicalKeys.add(fp.canonicalKey);
  if (fp.geoCell) registry.geoCells.add(fp.geoCell);
  for (const a of fp.aliases) registry.aliasKeys.add(a);
  if (fp.aliasKey) registry.aliasKeys.add(fp.aliasKey);
  if (fp.lat != null && fp.lng != null) {
    registry.anchors.push({
      lat: fp.lat,
      lng: fp.lng,
      canonicalKey: fp.canonicalKey,
      aliasKey: fp.aliasKey,
      type: fp.type,
      name: fp.name,
    });
  }
}

function areTypesSimilar(a: string, b: string): boolean {
  if (!a || !b) return true;
  const na = a.toLowerCase();
  const nb = b.toLowerCase();
  if (na === nb) return true;
  const groups = [
    ["temple", "shrine", "place_of_worship", "寺", "神社"],
    ["park", "garden", "公園"],
    ["museum", "gallery", "美術館", "博物館"],
    ["tower", "landmark", "observation", "塔"],
    ["mall", "shopping", "商場"],
  ];
  return groups.some((g) => g.some((x) => na.includes(x)) && g.some((x) => nb.includes(x)));
}

function namesRelated(a: string, b: string, canonicalA: string, canonicalB: string): boolean {
  if (canonicalA && canonicalB && canonicalA === canonicalB) return true;
  const ca = compactToken(a);
  const cb = compactToken(b);
  if (!ca || !cb) return false;
  if (ca === cb) return true;
  if (ca.length >= 4 && cb.length >= 4 && (ca.includes(cb) || cb.includes(ca))) return true;
  const aliasA = ALIAS_LOOKUP.get(ca) ?? tripCanonicalPlaceKey(a);
  const aliasB = ALIAS_LOOKUP.get(cb) ?? tripCanonicalPlaceKey(b);
  return Boolean(aliasA && aliasB && aliasA === aliasB);
}

function isNearAnchorDuplicate(fp: TripPlaceFingerprint, registry: TripAddPlaceDedupRegistry): boolean {
  if (fp.lat == null || fp.lng == null) return false;
  for (const anchor of registry.anchors) {
    const meters = distanceMeters({ lat: fp.lat, lng: fp.lng }, { lat: anchor.lat, lng: anchor.lng });
    if (meters > TRIP_PLACE_PROXIMITY_M) continue;
    if (namesRelated(fp.name, anchor.name, fp.canonicalKey, anchor.canonicalKey)) return true;
    if (fp.aliasKey && anchor.aliasKey && fp.aliasKey === anchor.aliasKey) return true;
    if (areTypesSimilar(fp.type, anchor.type) && namesRelated(fp.name, anchor.name, fp.canonicalKey, anchor.canonicalKey)) {
      return true;
    }
  }
  return false;
}

export function isTripPlaceDuplicate(
  place: PlaceInput,
  registry: TripAddPlaceDedupRegistry,
): boolean {
  const fp = extractTripPlaceFingerprint(place);

  if (fp.placeId && registry.placeIds.has(fp.placeId)) return true;
  if (fp.canonicalKey && registry.canonicalKeys.has(fp.canonicalKey)) return true;
  for (const alias of fp.aliases) {
    if (registry.aliasKeys.has(alias)) return true;
  }
  if (fp.aliasKey && registry.aliasKeys.has(fp.aliasKey)) return true;

  return isNearAnchorDuplicate(fp, registry);
}

export function buildTripAddPlaceDedupRegistry(
  recSession?: TripAddPlaceRecommendationSession | null,
  ctx?: TripAddPlaceContext | null,
  extra?: PlaceInput[],
): TripAddPlaceDedupRegistry {
  const registry = createTripAddPlaceDedupRegistry();

  const registerById = (id: string) => {
    const key = normalizeStoredPlaceId(id);
    if (!key) return;
    const fromPool = recSession?.allCandidates.find(
      (c) => normalizeStoredPlaceId(placeIdFromRecommendation(c)) === key,
    );
    if (fromPool) {
      registerTripPlaceFingerprint(registry, fromPool);
      return;
    }
    if (key.startsWith("n:")) {
      const name = key.slice(2);
      registerTripPlaceFingerprint(registry, { name, placeName: name });
    }
  };

  for (const id of recSession?.shownPlaceIds ?? []) registerById(id);
  for (const id of recSession?.addedPlaceIds ?? []) registerById(id);
  for (const id of recSession?.rejectedPlaceIds ?? []) registerById(id);
  for (const id of recSession?.currentTripPlaceIds ?? []) registerById(id);

  for (const key of recSession?.shownCanonicalKeys ?? []) {
    if (key) registry.canonicalKeys.add(key);
  }
  for (const cell of recSession?.shownGeoCells ?? []) {
    if (cell) registry.geoCells.add(cell);
  }
  for (const alias of recSession?.shownAliases ?? []) {
    if (alias) registry.aliasKeys.add(alias);
  }

  if (ctx) {
    for (const name of ctx.existingPlaceNames) {
      registerTripPlaceFingerprint(registry, { name, placeName: name });
    }
    for (const p of ctx.currentPlaces) {
      registerTripPlaceFingerprint(registry, {
        name: p.name,
        placeName: p.name,
        lat: p.lat ?? null,
        lng: p.lng ?? null,
      });
    }
  }

  for (const place of extra ?? []) {
    registerTripPlaceFingerprint(registry, place);
  }

  return registry;
}

export function dedupeTripAddPlaceCandidates<T extends PlaceInput>(
  candidates: T[],
  registry?: TripAddPlaceDedupRegistry | null,
  label = "dedupe",
): T[] {
  const local = registry ?? createTripAddPlaceDedupRegistry();
  const out: T[] = [];

  for (const candidate of candidates) {
    if (isTripPlaceDuplicate(candidate, local)) {
      const fp = extractTripPlaceFingerprint(candidate);
      console.info("[TRIP_ADD_PLACE_DEDUP_DROP]", {
        label,
        name: fp.name,
        placeId: fp.placeId || null,
        canonicalKey: fp.canonicalKey,
        geoCell: fp.geoCell,
        reason: "duplicate",
      });
      continue;
    }
    registerTripPlaceFingerprint(local, candidate);
    out.push(candidate);
  }

  return out;
}

export function appendTripPlaceDedupState(
  recSession: TripAddPlaceRecommendationSession,
  places: PlaceInput[],
): TripAddPlaceRecommendationSession {
  const shownPlaceIds = [...recSession.shownPlaceIds];
  const shownCanonicalKeys = new Set(recSession.shownCanonicalKeys ?? []);
  const shownGeoCells = new Set(recSession.shownGeoCells ?? []);
  const shownAliases = new Set(recSession.shownAliases ?? []);

  for (const place of places) {
    const fp = extractTripPlaceFingerprint(place);
    if (fp.placeId && !shownPlaceIds.includes(fp.placeId)) shownPlaceIds.push(fp.placeId);
    if (fp.canonicalKey) shownCanonicalKeys.add(fp.canonicalKey);
    if (fp.geoCell) shownGeoCells.add(fp.geoCell);
    for (const a of fp.aliases) shownAliases.add(a);
    if (fp.aliasKey) shownAliases.add(fp.aliasKey);
  }

  return {
    ...recSession,
    shownPlaceIds: normalizeShownIdsLocal(shownPlaceIds),
    shownCanonicalKeys: [...shownCanonicalKeys],
    shownGeoCells: [...shownGeoCells],
    shownAliases: [...shownAliases],
  };
}

export function tripPlaceNameBlocked(name: string, registry: TripAddPlaceDedupRegistry): boolean {
  const fp = extractTripPlaceFingerprint({ name, placeName: name });
  return (
    registry.canonicalKeys.has(fp.canonicalKey) ||
    fp.aliases.some((a) => registry.aliasKeys.has(a)) ||
    Boolean(fp.aliasKey && registry.aliasKeys.has(fp.aliasKey))
  );
}

/** @deprecated use tripCanonicalPlaceKey */
export function tripNormalizePlaceName(name: string): string {
  return tripCanonicalPlaceKey(name) || normalizePlaceName(name);
}
