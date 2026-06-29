/** 殯葬／墓地類地點 — 探索、推薦、行程生成一律排除（正式戰爭/和平紀念博物館除外） */

const BURIAL_FUNERAL_TYPES = new Set([
  "cemetery",
  "graveyard",
  "funeral_home",
  "crematorium",
  "columbarium",
  "memorial_park",
  "mortuary",
  "funeral_service",
]);

const BURIAL_NAME_RE =
  /墓地|墓園|靈園|霊園|靈場|霊場|納骨堂|火葬場|殯儀館|陵園|骨灰塔|納骨|墓所|葬儀|火葬|墓苑|墓場|永代供養|樹木葬/i;

const BURIAL_NAME_EN_RE =
  /\b(cemetery|cemeteries|graveyard|crematorium|columbarium|funeral\s*home|funeral\s*parlor|burial\s*ground|mausoleum|necropolis|memorial\s*park|mortuary)\b/i;

/** 正式觀光型戰爭/和平/歷史紀念（非殯葬用途） */
const MEMORIAL_TOURIST_EXCEPTION_RE =
  /戰爭紀念|和平紀念|原爆|慰靈塔|Memorial\s*Museum|War\s*Memorial|Peace\s*Memorial|Atomic\s*Bomb|Hiroshima\s*Peace|Yasukuni\s*Shrine|靖國/i;

const TOURIST_MEMORIAL_TYPES = new Set([
  "museum",
  "tourist_attraction",
  "historical_landmark",
  "monument",
  "cultural_landmark",
  "art_gallery",
  "park",
]);

function normalizeType(type: string): string {
  return type.trim().toLowerCase().replace(/\s+/g, "_");
}

function collectTypes(place: {
  primaryType?: string | null;
  types?: string[] | null;
}): Set<string> {
  const out = new Set<string>();
  const primary = normalizeType(place.primaryType ?? "");
  if (primary) out.add(primary);
  for (const t of place.types ?? []) {
    const n = normalizeType(t ?? "");
    if (n) out.add(n);
  }
  return out;
}

function isMemorialTouristException(name: string, address: string, types: Set<string>): boolean {
  const blob = `${name} ${address}`;
  if (!MEMORIAL_TOURIST_EXCEPTION_RE.test(blob)) return false;
  if ([...types].some((t) => TOURIST_MEMORIAL_TYPES.has(t))) return true;
  return /紀念館|紀念公園|Memorial\s*Museum|Peace\s*Park/i.test(blob);
}

export function isBurialOrFuneralPlace(place: {
  name?: string | null;
  address?: string | null;
  primaryType?: string | null;
  types?: string[] | null;
}): boolean {
  const name = (place.name ?? "").trim();
  const address = (place.address ?? "").trim();
  const blob = `${name} ${address}`;
  const types = collectTypes(place);

  if (isMemorialTouristException(name, address, types)) {
    return false;
  }

  for (const t of types) {
    if (!BURIAL_FUNERAL_TYPES.has(t)) continue;
    if (t === "memorial_park" && isMemorialTouristException(name, address, types)) {
      continue;
    }
    return true;
  }

  if (BURIAL_NAME_RE.test(blob) || BURIAL_NAME_EN_RE.test(blob)) {
    return true;
  }

  return false;
}
