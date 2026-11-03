import type { Locale } from "@/lib/i18n/types";
import type { PlaceResult } from "@/lib/place-result";
import type { SearchPlacesFn } from "@/lib/explore-category-search";
import type { ChatPlaceItem, ChatPlanningSession } from "@/lib/chat-session";
import { mapPlaceResultsToChatItems } from "@/lib/chat-session";
import { placeIdentityKey } from "@/lib/place-planning-memory";
import type { PlanTravelStyleZh } from "@/lib/plan-travel-style";
import type { UserProfileForReason } from "@/lib/build-place-recommendation-reason";
import { collectPlaceTypes } from "@/lib/place-identity";
import { devVerboseInfo } from "@/lib/dev-verbose-log";
import { isExplicitCampingPlace } from "@/lib/camping-place-classification";
import { classifyFamilyPlace } from "@/lib/family-place-classification";
import { matchDestinationAdministrativeScope } from "@/lib/destination-administrative-scope";
import {
  cachedTrustedParentAdministrativeNames,
  isSameAdministrativeLabel,
  type TrustedRecommendationSearchScope,
} from "@/lib/ai/chat-turn-destination";
import { resolveDestination } from "@/lib/ai/destination-resolution";
import { isKnownCountryLabel, isKnownTouristCityLabel } from "@/lib/ai/trip-planning-context";

/** Fixed lane search radius; never read from the Client-saved destinationScope. */
const PLANNING_SELECTION_SEARCH_RADIUS = 50_000;

export type RecommendationFamily =
  | "food"
  | "cafe"
  | "nature"
  | "city"
  | "art"
  | "culture"
  | "family"
  | "camping";

export type PlanningSelectionLane = {
  style: PlanTravelStyleZh;
  family: RecommendationFamily;
  queryCursor: number;
  exhausted?: boolean;
  searchedQueryIndexes?: number[];
  candidatePool?: PlaceResult[];
};

export type PlanningSelectionSession = {
  id: string;
  mode: "planning_selection";
  styles: PlanTravelStyleZh[];
  selectedPlaceIds: string[];
  selectedPlaces: ChatPlaceItem[];
  shownPlaceIds: string[];
  shownFamilyCounts: Partial<Record<RecommendationFamily, number>>;
  lanes: PlanningSelectionLane[];
  dateAuthority?: {
    startDate: string;
    endDate: string;
    tripDays: number;
  };
  destinationScope: {
    name: string;
    lat: number;
    lng: number;
    radius: number;
    administrativeNames?: string[];
  };
  /**
   * Destination the A2 gate trusted for this selection's last paid search. Comparison only
   * (same-destination check); never a search center, radius or name on its own.
   */
  trustedDestination?: string;
  createdAt: string;
};

type FamilyContract = {
  family: RecommendationFamily;
  queries: string[];
  types: string[];
};

export const STYLE_RECOMMENDATION_FAMILIES: Record<PlanTravelStyleZh, FamilyContract> = {
  美食探索: {
    family: "food",
    queries: ["在地料理 特色餐廳", "小吃 甜點"],
    types: ["restaurant", "food", "bakery"],
  },
  文青咖啡: {
    family: "cafe",
    queries: ["特色咖啡廳 茶館", "老宅咖啡"],
    types: ["cafe", "coffee_shop", "tea_house"],
  },
  自然戶外: {
    family: "nature",
    queries: ["自然景點 公園 步道", "山景 海景 戶外景點"],
    types: ["park", "hiking_area", "national_park"],
  },
  城市漫遊: {
    family: "city",
    queries: ["歷史街區 城市散步", "城市地標 街區"],
    types: ["tourist_attraction", "historical_landmark", "plaza"],
  },
  藝術展覽: {
    family: "art",
    queries: ["美術館 博物館", "藝廊 展覽空間"],
    types: ["art_gallery", "museum", "cultural_center"],
  },
  文化體驗: {
    family: "culture",
    queries: ["古蹟 寺廟 文化景點", "歷史文化場館"],
    types: ["historical_landmark", "place_of_worship", "museum"],
  },
  親子同遊: {
    family: "family",
    queries: [
      "動物園 水族館",
      "親子樂園 遊樂園",
      "兒童樂園 室內遊樂",
      "親子農場 動物互動",
      "親子 科學館 兒童博物館",
      "親子 生態園區 體驗",
    ],
    types: [
      "zoo",
      "aquarium",
      "amusement_park",
      "amusement_center",
      "playground",
      "indoor_playground",
    ],
  },
  露營野遊: {
    family: "camping",
    queries: ["露營區", "露營地", "campground", "campsite", "RV park", "森林露營區"],
    types: ["campground", "rv_park"],
  },
};

export function createPlanningSelectionSession(params: {
  styles: PlanTravelStyleZh[];
  destination: { name: string; lat: number; lng: number; administrativeNames?: string[] };
  dateAuthority?: { startDate: string; endDate: string; tripDays: number };
}): PlanningSelectionSession {
  const styles = [...new Set(params.styles)];
  return {
    id: `selection-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    mode: "planning_selection",
    styles,
    selectedPlaceIds: [],
    selectedPlaces: [],
    shownPlaceIds: [],
    shownFamilyCounts: {},
    lanes: styles.map((style) => ({
      style,
      family: STYLE_RECOMMENDATION_FAMILIES[style].family,
      queryCursor: 0,
    })),
    dateAuthority: params.dateAuthority,
    destinationScope: { ...params.destination, radius: 50_000 },
    createdAt: new Date().toISOString(),
  };
}

export function isPlanningSelectionMode(session: ChatPlanningSession): boolean {
  return session.planningSelection?.mode === "planning_selection";
}

/**
 * The selection's Plan form destination label: only a candidate for the A2 gate
 * (resolveTrustedRecommendationSearchScope), never trusted on its own.
 */
export function planningSelectionDestinationLabel(
  session: ChatPlanningSession,
  level: "destination" | "parent" | "qualified" = "destination",
): string | undefined {
  // Plan form display labels are「國家・城市」: the gate only receives the place name itself
  // (the country prefix is display-only and would be parsed as the destination).
  const bare = (value: string | undefined) =>
    value
      ?.split("・")
      .map((part) => part.trim())
      .filter(Boolean)
      .at(-1) || undefined;
  const destination =
    bare(session.planningSelection?.destinationScope?.name) ||
    bare(session.tripDestination?.city) ||
    bare(session.tripDestination?.displayLabel) ||
    undefined;
  if (level === "destination") return destination;
  const compact = (value: string | undefined) => (value ?? "").replace(/\s+/g, "");
  if (level === "qualified") {
    // First gate candidate: one level up + the place name (基隆市信義區), so a same-name district
    // of another city (台北市信義區) is never what the gate resolves. Upper level: the district
    // when it differs from the name (九份 → 瑞芳區), else the region. City-level names (市／縣／府…)
    // are not qualified (their district would be below them, and they have no same-name issue).
    if (!destination || CITY_LEVEL_NAME_RE.test(destination)) return undefined;
    const upper = [
      bare(session.tripDestination?.district),
      bare(session.tripDestination?.region),
    ].find(
      (value) =>
        value &&
        compact(value) !== compact(destination) &&
        !compact(destination).startsWith(compact(value)) &&
        // 台南市 / 東京都 / 大阪府 are the name itself (never「台南市台南」).
        !isSameAdministrativeLabel(value, destination),
    );
    return upper ? `${upper}${destination}` : undefined;
  }
  // One level up (e.g. 區 → 市): only the last gate candidate when the place name is not trusted.
  const parent = bare(session.tripDestination?.region);
  return parent && compact(parent) !== compact(destination) ? parent : undefined;
}

const CITY_LEVEL_NAME_RE = /(?:市|縣|县|府|都|道|州|省|邦|國|国)$/;

/**
 * Leaves Planner selection mode (destination switch confirmed): the old selection, its
 * destinationScope and its selected-place mirrors never carry over to another destination.
 * With the switch's trusted gate result, the trip destination becomes that destination (never a
 * client value) and the Plan form planning mode ends; the generation path resolves its identity.
 */
export function leavePlanningSelection(
  session: ChatPlanningSession,
  trusted?: { destination: string; center: { lat: number; lng: number } },
): ChatPlanningSession {
  // An explicit (trusted) leave is never a stale drop: no earlier unconsumed record survives it.
  if (trusted) lastStaleSelectionDrop = undefined;
  const selection = session.planningSelection;
  if (!selection) return session;
  const fromSelection = new Set(resolvePlanningSelectionPlaces(session).map(placeId));
  const keep = (places: ChatPlaceItem[] | undefined) =>
    (places ?? []).filter((place) => !fromSelection.has(placeId(place)));
  const selectedPlaces = keep(session.selectedPlaces);
  const destination = trusted?.destination?.trim();
  // The Plan form wrote session.location from its destination (preparePlanTripSession).
  const scope = selection.destinationScope;
  const location = session.location;
  const locationFromPlanForm = Boolean(
    location &&
    (session.fromPlanForm === true ||
      (scope &&
        Math.abs(location.lat - scope.lat) < 1e-6 &&
        Math.abs(location.lng - scope.lng) < 1e-6)),
  );
  return {
    ...session,
    planningSelection: undefined,
    selectedPlaces,
    selectedPlaceIds: selectedPlaces.map(placeId),
    plannedStops: keep(session.plannedStops),
    planAiMode: false,
    fromPlanForm: false,
    ...(destination && trusted
      ? {
          // Unresolved on purpose (no Place ID / country): handleGenerateItinerary's
          // resolveDestinationAuthority resolves this trusted label instead of the old city.
          tripDestination: {
            placeId: "",
            country: "",
            city: destination,
            lat: trusted.center.lat,
            lng: trusted.center.lng,
            formattedName: destination,
            displayLabel: destination,
          },
          // Same rule as tripDestination: the gate's label + center, no forged Place ID.
          location: {
            lat: trusted.center.lat,
            lng: trusted.center.lng,
            city: destination,
            displayLabel: destination,
          },
        }
      : { location: locationFromPlanForm ? undefined : location }),
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Same destination as the selection (any of its own labels), or provably inside it: the label's
 * administrative parents (Authority area parent / this app's validated provider answers) name the
 * selection itself. Exact administrative-label equality only, never substring containment.
 * The selection's upper region (administrativeNames) counts as the same destination, as in the
 * continuation gate.
 */
function labelBelongsToSelection(
  selection: PlanningSelectionSession,
  label: string | undefined,
): boolean {
  const value = label
    ?.split("・")
    .map((part) => part.trim())
    .filter(Boolean)
    .at(-1);
  if (!value) return true;
  const identities = [
    selection.trustedDestination,
    ...(selection.destinationScope?.name ?? "").split("・"),
    ...(selection.destinationScope?.administrativeNames ?? []),
  ].filter((name): name is string => Boolean(name?.trim()));
  if (identities.some((identity) => isSameAdministrativeLabel(identity, value))) return true;
  // Containment: only the selection's own level (never its upper region) may be a parent.
  const own = [
    selection.trustedDestination,
    (selection.destinationScope?.name ?? "").split("・").at(-1),
  ].filter((name): name is string => Boolean(name?.trim()));
  const resolution = resolveDestination({ text: value });
  const parents = [
    resolution.areaCandidate?.parentCity,
    resolution.geographicScope?.searchScope === "area"
      ? resolution.geographicScope.parentCity
      : undefined,
    ...cachedTrustedParentAdministrativeNames(value),
    ...(resolution.destination
      ? cachedTrustedParentAdministrativeNames(resolution.destination)
      : []),
  ];
  return parents.some((parent) =>
    own.some((identity) => isSameAdministrativeLabel(identity, parent)),
  );
}

/**
 * Provably another city (pure, no provider): the label is not the selection nor inside it, and the
 * local Authority knows it as a city / country, or as a known city's tail whose parent city is not
 * the selection. Scenic spots, districts and unknown fragments (淡水、九份、北投泡湯…) are never
 * provable here: they may be inside the selection (the async gate decides those turns).
 */
function labelProvablyOutsideSelection(
  selection: PlanningSelectionSession,
  label: string | undefined,
): boolean {
  const value = label
    ?.split("・")
    .map((part) => part.trim())
    .filter(Boolean)
    .at(-1);
  if (!value || labelBelongsToSelection(selection, value)) return false;
  if (isKnownTouristCityLabel(value) || isKnownCountryLabel(value)) return true;
  const parent = resolveDestination({ text: value }).areaCandidate?.parentCity;
  return Boolean(
    parent && isKnownTouristCityLabel(parent) && !labelBelongsToSelection(selection, parent),
  );
}

/**
 * The kept selection's places stay in the top-level mirrors: a destination reset of this turn
 * (sub-area write) never empties them while the selection itself still holds them.
 * Unchanged session object when nothing is missing.
 */
function withPlanningSelectionMirrors(session: ChatPlanningSession): ChatPlanningSession {
  const selection = session.planningSelection;
  const owned = selection?.selectedPlaces ?? [];
  if (!owned.length) return session;
  const mirrored = new Set((session.selectedPlaces ?? []).map(placeId));
  const missing = owned.filter((place) => !mirrored.has(placeId(place)));
  if (!missing.length) return session;
  const selectedPlaces = [...(session.selectedPlaces ?? []), ...missing];
  const stops = session.plannedStops ?? [];
  const stopIds = new Set(stops.map(placeId));
  return {
    ...session,
    selectedPlaces,
    selectedPlaceIds: selectedPlaces.map(placeId),
    plannedStops: [...stops, ...missing.filter((place) => !stopIds.has(placeId(place)))],
  };
}

// #PL-FIX-T8: a selection destination switch the user confirmed on the general path (the trip
// destination was already written as the switch target): its re-sent sentence is the switch itself.
let confirmedSelectionSwitch: { destination: string; originalUserText: string } | undefined;

/** #PL-FIX-T8: set when the user confirms a general-path selection switch (before the re-send). */
export function rememberConfirmedPlanningSelectionSwitch(record: {
  destination: string;
  originalUserText: string;
}): void {
  confirmedSelectionSwitch = { ...record };
}

/** #PL-FIX-T8: a turn with another sentence drops the record (the same sentence keeps it). */
export function clearConfirmedPlanningSelectionSwitch(exceptUserText?: string): void {
  if (confirmedSelectionSwitch?.originalUserText !== exceptUserText?.trim()) {
    confirmedSelectionSwitch = undefined;
  }
}

/** #PL-FIX-T8: consumed once by the re-sent sentence's switch; only for that same sentence. */
export function takeConfirmedPlanningSelectionSwitch(
  userText: string,
): { destination: string; originalUserText: string } | undefined {
  const record = confirmedSelectionSwitch;
  confirmedSelectionSwitch = undefined;
  return record && record.originalUserText === userText.trim() ? record : undefined;
}

let lastStaleSelectionDrop: { selectionId: string; previous: string } | undefined;

/**
 * The last selection dropStalePlanningSelection ended (consumed once): the caller shows「已離開…的選點」
 * only for the selection that was live. Never set by an explicit leavePlanningSelection.
 */
export function consumeStalePlanningSelectionDrop():
  | { selectionId: string; previous: string }
  | undefined {
  const drop = lastStaleSelectionDrop;
  lastStaleSelectionDrop = undefined;
  return drop;
}

/**
 * A destination write (travelContext / tripPlanningContext / tripDestination) that the local
 * Authority can prove is another city ends Planner selection mode: the old selection, its
 * destinationScope and its selected places never stay with another city (leavePlanningSelection
 * without a trusted destination: nothing is trusted from this sentence here). A write that cannot
 * be proven to be elsewhere (sub-area, scenic spot, unknown fragment) keeps the selection.
 */
export function dropStalePlanningSelection(session: ChatPlanningSession): ChatPlanningSession {
  const selection = session.planningSelection;
  if (!selection) return session;
  const trip = session.tripDestination;
  const scope = selection.destinationScope;
  const tripIsSelection =
    !trip ||
    (scope &&
      Number.isFinite(trip.lat) &&
      Number.isFinite(trip.lng) &&
      Math.abs(trip.lat - scope.lat) < 1e-6 &&
      Math.abs(trip.lng - scope.lng) < 1e-6) ||
    [trip.city, trip.displayLabel, trip.formattedName].some(
      (label) => label?.trim() && labelBelongsToSelection(selection, label),
    );
  const tripOutside =
    !tripIsSelection &&
    [trip?.city, trip?.displayLabel, trip?.formattedName].some((label) =>
      labelProvablyOutsideSelection(selection, label),
    );
  const stale = [session.travelContext?.destination, session.tripPlanningContext?.destination].some(
    (label) => labelProvablyOutsideSelection(selection, label),
  );
  if (!tripOutside && !stale) return withPlanningSelectionMirrors(session);
  devVerboseInfo("[PLANNING_SELECTION_STALE_DROPPED]", {
    sessionId: selection.id,
    reason: stale ? "context_destination_differs" : "trip_destination_differs",
  });
  lastStaleSelectionDrop = {
    selectionId: selection.id,
    previous:
      selection.trustedDestination?.trim() ||
      (selection.destinationScope?.name ?? "").split("・").at(-1)?.trim() ||
      "",
  };
  return leavePlanningSelection(session);
}

/**
 * The destination name a general / place-detail turn would write: `after` is the same session after
 * this turn's trip intent and travel context merge (dry run, no provider). The first written label
 * that differs from the session before the turn; undefined when this turn writes no new name.
 */
export function planningSelectionTurnWrittenDestination(
  before: ChatPlanningSession,
  after: ChatPlanningSession,
): string | undefined {
  const writes: Array<[string | undefined, string | undefined]> = [
    [after.travelContext?.destination, before.travelContext?.destination],
    [
      after.travelContext?.destinationCandidate?.raw,
      before.travelContext?.destinationCandidate?.raw,
    ],
    [after.location?.city, before.location?.city],
    [after.preferredArea, before.preferredArea],
  ];
  for (const [next, previous] of writes) {
    const label = next?.trim();
    if (label && label !== previous?.trim()) return label;
  }
  return undefined;
}

/**
 * A general / place-detail turn whose named place the A2 gate trusted inside the selection: the
 * selection keeps its own trip destination, and travel / planning context labels that are not the
 * selection only carry the gate's trusted place (this turn's query focus), never another label
 * parsed from the sentence.
 */
export function keepPlanningSelectionDestination(
  session: ChatPlanningSession,
  before: ChatPlanningSession,
  focus: string,
  // #PL-FIX-T7: focusInsideSelection — the A2 gate (or this turn's own lookup answer) placed this
  // turn's place in the selection itself or inside it (sub-area): its preferred area stays this
  // turn's recommendation focus. unverifiedName — the name the gate could not confirm: any label
  // carrying it counts as outside the selection (e.g. a known parent + that unverified tail).
  options?: { focusInsideSelection?: boolean; unverifiedName?: string },
): ChatPlanningSession {
  const selection = session.planningSelection;
  if (!selection || !isPlanningSelectionMode(session)) return session;
  const unverifiedName = options?.unverifiedName?.trim();
  const outside = (label: string | undefined) =>
    Boolean(label?.trim()) &&
    (!labelBelongsToSelection(selection, label) ||
      Boolean(unverifiedName && label?.includes(unverifiedName)));
  const travel = session.travelContext;
  const planning = session.tripPlanningContext;
  const tripChanged =
    session.tripDestination !== before.tripDestination || session.location !== before.location;
  const travelOutside = travel && outside(travel.destination);
  const planningOutside = planning && outside(planning.destination);
  // This turn's unverified candidate / input names / preferred area never outlive the turn: they
  // return to their values before the turn (no later turn geocodes or reads them again).
  const beforeTravel = before.travelContext;
  const same = (a: unknown, b: unknown) => a === b || JSON.stringify(a) === JSON.stringify(b);
  const candidateChanged =
    travel &&
    (!same(travel.destinationCandidate, beforeTravel?.destinationCandidate) ||
      !same(travel.destinationInputNames, beforeTravel?.destinationInputNames));
  // #PL-FIX-T7: only another city / an unverified name is cleared. A gate-trusted sub-area keeps
  // its preferred area; a city / region label outside the selection returns to its value before
  // the turn (the gate-trusted focus itself is never "outside").
  const keepArea = options?.focusInsideSelection === true;
  const areaChanged = !keepArea && !same(session.preferredArea, before.preferredArea);
  const adminOutside = (label: string | undefined, previous: string | undefined) =>
    label !== previous &&
    outside(label) &&
    !(keepArea && isSameAdministrativeLabel(label, focus));
  const cityOutside = Boolean(
    travel && adminOutside(travel.destinationCity, beforeTravel?.destinationCity),
  );
  const regionOutside = Boolean(
    travel && adminOutside(travel.destinationRegion, beforeTravel?.destinationRegion),
  );
  if (
    !tripChanged &&
    !travelOutside &&
    !planningOutside &&
    !candidateChanged &&
    !areaChanged &&
    !cityOutside &&
    !regionOutside
  ) {
    return session;
  }
  return {
    ...session,
    tripDestination: before.tripDestination,
    location: before.location,
    preferredArea: keepArea ? session.preferredArea : before.preferredArea,
    ...(travel && (travelOutside || candidateChanged || cityOutside || regionOutside)
      ? {
          travelContext: {
            ...travel,
            destination: travelOutside ? focus : travel.destination,
            destinationCandidate: beforeTravel?.destinationCandidate,
            destinationInputNames: beforeTravel?.destinationInputNames,
            destinationCity: cityOutside ? beforeTravel?.destinationCity : travel.destinationCity,
            destinationRegion: regionOutside
              ? beforeTravel?.destinationRegion
              : travel.destinationRegion,
          },
        }
      : {}),
    ...(planning && planningOutside
      ? { tripPlanningContext: { ...planning, destination: focus } }
      : {}),
  };
}

// #PL-FIX-T7: one non-blocking notice per Planner selection turn (e.g. the written place had no
// geocoding result at all). Set by the turn's gate, shown after that turn's reply, cleared at the
// start of every user turn. Client-only UI state; never persisted on the session.
export type PlanningSelectionTurnNotice = {
  message: string;
  /** Conversation length before this turn's user message (the reply comes after it). */
  conversationLength: number;
  userText: string;
};
let planningSelectionTurnNotice: PlanningSelectionTurnNotice | undefined;

export function setPlanningSelectionTurnNotice(notice: PlanningSelectionTurnNotice): void {
  planningSelectionTurnNotice = notice;
}

export function peekPlanningSelectionTurnNotice(): PlanningSelectionTurnNotice | undefined {
  return planningSelectionTurnNotice;
}

export function clearPlanningSelectionTurnNotice(): void {
  planningSelectionTurnNotice = undefined;
}

function placeId(place: {
  id?: string;
  canonicalPlaceId?: string;
  googlePlaceId?: string;
  placeId?: string;
  name: string;
}): string {
  return (
    place.canonicalPlaceId?.trim() ||
    place.googlePlaceId?.trim() ||
    place.placeId?.trim() ||
    place.id?.trim() ||
    placeIdentityKey(place)
  );
}

/**
 * A card may join this selection only when this selection session itself recommended it
 * (shownPlaceIds) or it is already selected (removal). Cards of another session / city never
 * become required anchors of the generated itinerary.
 */
export function isPlanningSelectionPlaceInScope(
  session: ChatPlanningSession,
  place: ChatPlaceItem,
): boolean {
  const selection = session.planningSelection;
  if (!selection) return false;
  const ids = [place.googlePlaceId, place.placeId, placeId(place)]
    .map((value) => value?.trim())
    .filter((value): value is string => Boolean(value));
  if (ids.some((id) => selection.selectedPlaceIds.includes(id))) return true;
  return ids.some((id) => selection.shownPlaceIds.includes(id));
}

export function togglePlanningSelectionPlace(
  session: ChatPlanningSession,
  place: ChatPlaceItem,
): ChatPlanningSession {
  const selection = session.planningSelection;
  if (!selection) return session;
  const id = placeId(place);
  const selected = selection.selectedPlaceIds.includes(id);
  if (!selected && !isPlanningSelectionPlaceInScope(session, place)) {
    devVerboseInfo("[PLANNING_SELECTION_TOGGLE]", {
      placeId: id,
      selected: false,
      rejected: "not_in_selection_scope",
    });
    return session;
  }
  const authoritativePlaces = resolvePlanningSelectionPlaces(session);
  const selectedPlaces = selected
    ? authoritativePlaces.filter((candidate) => placeId(candidate) !== id)
    : [...authoritativePlaces, place];
  devVerboseInfo("[PLANNING_SELECTION_TOGGLE]", {
    placeId: id,
    selected: !selected,
    selectedCount: selectedPlaces.length,
  });
  return {
    ...session,
    selectedPlaces,
    selectedPlaceIds: selectedPlaces.map(placeId),
    plannedStops: selectedPlaces,
    phase: selectedPlaces.length ? "followup" : "collect",
    planningSelection: {
      ...selection,
      selectedPlaceIds: selectedPlaces.map(placeId),
      selectedPlaces,
    },
    updatedAt: new Date().toISOString(),
  };
}

/** Nested Selection payload is authoritative; top-level fields remain compatibility mirrors. */
export function resolvePlanningSelectionPlaces(session: ChatPlanningSession): ChatPlaceItem[] {
  const selection = session.planningSelection;
  if (!selection) return session.selectedPlaces;
  if (selection.selectedPlaces?.length) return selection.selectedPlaces;
  const ids = new Set(selection.selectedPlaceIds);
  return session.selectedPlaces.filter((candidate) => ids.has(placeId(candidate)));
}

export function preparePlanningSelectionForGenerate(session: ChatPlanningSession): {
  session: ChatPlanningSession;
  requiredPlaces: ChatPlaceItem[];
  blockedReason?: "no_selected_payload";
} {
  const requiredPlaces = resolvePlanningSelectionPlaces(session);
  if (!requiredPlaces.length)
    return { session, requiredPlaces, blockedReason: "no_selected_payload" };
  const selection = session.planningSelection;
  return {
    requiredPlaces,
    session: {
      ...session,
      selectedPlaces: requiredPlaces,
      selectedPlaceIds: requiredPlaces.map(placeId),
      plannedStops: requiredPlaces,
      phase: "ready",
      planningSelection: selection ? { ...selection, selectedPlaces: requiredPlaces } : selection,
    },
  };
}

function coverageAwareMerge(
  lanes: Array<{ lane: PlanningSelectionLane; places: PlaceResult[] }>,
  limit: number,
  historicalCounts: Partial<Record<RecommendationFamily, number>>,
): PlaceResult[] {
  const output: PlaceResult[] = [];
  const seen = new Set<string>();
  const offsets = new Map(lanes.map((entry) => [entry.lane.style, 0]));
  const batchCounts: Partial<Record<RecommendationFamily, number>> = {};
  while (output.length < limit) {
    const available = lanes.filter(
      (entry) => (offsets.get(entry.lane.style) ?? 0) < entry.places.length,
    );
    if (!available.length) break;
    available.sort((a, b) => {
      const aCount = (historicalCounts[a.lane.family] ?? 0) + (batchCounts[a.lane.family] ?? 0);
      const bCount = (historicalCounts[b.lane.family] ?? 0) + (batchCounts[b.lane.family] ?? 0);
      return aCount - bCount;
    });
    const entry = available[0];
    const offset = offsets.get(entry.lane.style) ?? 0;
    const place = entry.places[offset];
    offsets.set(entry.lane.style, offset + 1);
    if (seen.has(place.id)) continue;
    seen.add(place.id);
    output.push(place);
    batchCounts[entry.lane.family] = (batchCounts[entry.lane.family] ?? 0) + 1;
  }
  return output;
}

const CAFE_NAME_RE = /(?:咖啡|珈琲|coffee|cafe|café|茶館|茶屋|tea\s*(?:house|room))/i;

export function isPlaceEligibleForSelectionFamily(
  place: PlaceResult,
  family: RecommendationFamily,
): boolean {
  const types = collectPlaceTypes(place);
  const name = `${place.name} ${place.address ?? ""}`;
  if (family === "camping") {
    return isExplicitCampingPlace(place);
  }
  if (family === "family") {
    return classifyFamilyPlace(place).eligible;
  }
  if (family === "cafe") {
    return (
      types.some((type) => ["cafe", "coffee_shop", "tea_house"].includes(type)) ||
      CAFE_NAME_RE.test(name)
    );
  }
  return true;
}

/**
 * Paid selection lane search. Center, radius and destination name come only from the A2
 * trustedScope of this call; selection.destinationScope is used for administrative filtering
 * only. Missing / untrusted scope → empty result without any searchPlaces call.
 */
export async function fetchPlanningSelectionRecommendations(params: {
  session: ChatPlanningSession;
  searchPlaces: SearchPlacesFn;
  locale: Locale;
  trustedScope: TrustedRecommendationSearchScope;
  limit?: number;
  userProfile?: UserProfileForReason | null;
}): Promise<{ session: ChatPlanningSession; places: ChatPlaceItem[] }> {
  const selection = params.session.planningSelection;
  if (!selection) return { session: params.session, places: [] };
  const trustedScope = params.trustedScope;
  if (trustedScope?.status !== "trusted" || !trustedScope.destination?.trim()) {
    devVerboseInfo("[PLANNING_SELECTION_SCOPE_BLOCKED]", {
      reason: trustedScope?.status === "unavailable" ? trustedScope.reason : "no_trusted_scope",
    });
    return { session: params.session, places: [] };
  }
  const searchDestination = trustedScope.destination;
  const searchCenter = trustedScope.center;
  const excluded = new Set([...selection.shownPlaceIds, ...selection.selectedPlaceIds]);
  devVerboseInfo("[PLANNING_SELECTION_START]", {
    styles: selection.styles,
    selectedPlaceIdsCount: selection.selectedPlaceIds.length,
    shownPlaceIdsCount: selection.shownPlaceIds.length,
  });
  const recommendationLimit = params.limit ?? Math.max(4, selection.styles.length * 2);
  const targetPerLane = Math.max(1, Math.ceil(recommendationLimit / selection.styles.length));
  const highestShownFamilyCount = Math.max(0, ...Object.values(selection.shownFamilyCounts ?? {}));
  const results = await Promise.all(
    selection.lanes.map(async (lane) => {
      const contract = STYLE_RECOMMENDATION_FAMILIES[lane.style];
      const maxAttempts = contract.family === "camping" ? 3 : 1;
      const laneTarget =
        (selection.shownFamilyCounts?.[lane.family] ?? 0) < highestShownFamilyCount
          ? recommendationLimit
          : targetPerLane;
      let rawCount = 0;
      let eligibleCount = 0;
      const deduped = new Map<string, PlaceResult>();
      for (const place of lane.candidatePool ?? []) {
        if (!excluded.has(place.id)) deduped.set(place.id, place);
      }
      const searched = new Set(lane.searchedQueryIndexes ?? []);
      const attempted: number[] = [];
      for (let attempt = 0; attempt < maxAttempts && deduped.size < laneTarget; attempt += 1) {
        const queryIndex = contract.queries.findIndex((_, index) => !searched.has(index));
        if (queryIndex < 0) break;
        searched.add(queryIndex);
        attempted.push(queryIndex);
        const query = contract.queries[queryIndex];
        try {
          const result = await params.searchPlaces({
            data: {
              query: `${searchDestination} ${query}`,
              lat: searchCenter.lat,
              lng: searchCenter.lng,
              radius: PLANNING_SELECTION_SEARCH_RADIUS,
              mode: "text",
              includedTypes: contract.types,
              locale: params.locale,
              categoryId: contract.family,
              placesCaller: "planning_selection_lane",
              placesScreen: "chat",
              destinationName: searchDestination,
              searchMode: "destination",
              intentCategory: contract.family,
              planningSelectionStyle: lane.style,
              cacheDestination: searchDestination,
            },
          });
          rawCount += result.places.length;
          const exclusionCounts = {
            wrong_type: 0,
            exclusion: 0,
            geographic_scope: 0,
            duplicate: 0,
            lodging: 0,
            missing_metadata: 0,
            other: 0,
          };
          const eligible = result.places.filter((place) => {
            if (!place.id || !place.name || place.lat == null || place.lng == null) {
              exclusionCounts.missing_metadata += 1;
              return false;
            }
            const familyClassification =
              contract.family === "family" ? classifyFamilyPlace(place) : null;
            if (!isPlaceEligibleForSelectionFamily(place, contract.family)) {
              exclusionCounts.wrong_type += 1;
              devVerboseInfo("[PLANNING_SELECTION_FAMILY_CANDIDATE]", {
                style: lane.style,
                family: lane.family,
                query,
                placeId: place.id,
                name: place.name,
                rawTypes: [place.primaryType, ...(place.types ?? [])].filter(Boolean),
                normalizedTypes: familyClassification?.normalizedTypes ?? collectPlaceTypes(place),
                explicitFamilyIdentity: familyClassification?.explicitFamilyIdentity ?? false,
                familyEvidence: familyClassification?.familyEvidence ?? [],
                geographicAdminMatch: null,
                decision: "reject",
                rejectionReason: "wrong_type_or_missing_family_evidence",
              });
              return false;
            }
            const requiresAdministrativeScope =
              contract.family === "camping" || contract.family === "family";
            const adminMatch = requiresAdministrativeScope
              ? matchDestinationAdministrativeScope(place, selection.destinationScope)
              : { match: true as const, reason: "matched_alias" as const };
            if (!adminMatch.match) {
              exclusionCounts.geographic_scope += 1;
              devVerboseInfo("[PLANNING_SELECTION_FAMILY_CANDIDATE]", {
                style: lane.style,
                family: lane.family,
                query,
                placeId: place.id,
                name: place.name,
                rawTypes: [place.primaryType, ...(place.types ?? [])].filter(Boolean),
                normalizedTypes: familyClassification?.normalizedTypes ?? collectPlaceTypes(place),
                explicitFamilyIdentity: familyClassification?.explicitFamilyIdentity ?? false,
                familyEvidence: familyClassification?.familyEvidence ?? [],
                geographicAdminMatch: false,
                decision: "reject",
                rejectionReason: adminMatch.reason,
              });
              return false;
            }
            if (contract.family === "family") {
              devVerboseInfo("[PLANNING_SELECTION_FAMILY_CANDIDATE]", {
                style: lane.style,
                family: lane.family,
                query,
                placeId: place.id,
                name: place.name,
                rawTypes: [place.primaryType, ...(place.types ?? [])].filter(Boolean),
                normalizedTypes: familyClassification?.normalizedTypes ?? [],
                explicitFamilyIdentity: familyClassification?.explicitFamilyIdentity ?? false,
                familyEvidence: familyClassification?.familyEvidence ?? [],
                geographicAdminMatch: true,
                decision: "allow",
                rejectionReason: "",
              });
            }
            return true;
          });
          eligibleCount += eligible.length;
          for (const place of eligible) {
            if (excluded.has(place.id) || deduped.has(place.id)) {
              exclusionCounts.duplicate += 1;
            }
            if (!excluded.has(place.id)) deduped.set(place.id, place);
          }
          const exhausted = searched.size >= contract.queries.length && deduped.size === 0;
          devVerboseInfo("[PLANNING_SELECTION_FAMILY_AUDIT]", {
            stage: "selection_after_places_wrapper",
            style: lane.style,
            family: lane.family,
            query,
            rawCount: result.places.length,
            rawCountSource: "places_wrapper_output_google_raw_in_PLANNING_SELECTION_PLACES_RAW",
            eligibleCount: eligible.length,
            scopeCount: eligible.length,
            dedupeCount: deduped.size,
            shownCount: selection.shownPlaceIds.length,
            searchedQueryIndexes: [...searched],
            exhausted,
          });
          devVerboseInfo("[PLANNING_SELECTION_EXCLUSION_SUMMARY]", {
            stage: "selection_after_places_wrapper",
            style: lane.style,
            family: lane.family,
            query,
            ...exclusionCounts,
          });
          devVerboseInfo("[PLANNING_SELECTION_LANE_QUERY]", {
            style: lane.style,
            family: lane.family,
            query,
            candidateCountBeforeEligibility: result.places.length,
            candidateCountAfterEligibility: eligible.length,
            candidateCountAfterDedupe: deduped.size,
          });
        } catch (error) {
          devVerboseInfo("[PLANNING_SELECTION_LANE_QUERY_FAILED]", {
            style: lane.style,
            family: lane.family,
            query,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
      devVerboseInfo("[PLANNING_SELECTION_LANE_RESULT]", {
        style: lane.style,
        family: lane.family,
        candidateCountBeforeEligibility: rawCount,
        candidateCountAfterEligibility: eligibleCount,
        candidateCountAfterDedupe: deduped.size,
        attemptedQueryIndexes: attempted,
        searchedQueryCount: searched.size,
        exhausted: searched.size >= contract.queries.length && deduped.size === 0,
      });
      return { lane, places: [...deduped.values()], searchedQueryIndexes: [...searched] };
    }),
  );
  const picked = coverageAwareMerge(
    results,
    recommendationLimit,
    selection.shownFamilyCounts ?? {},
  );
  const familyByPlaceId = new Map(
    results.flatMap(({ lane, places }) => places.map((place) => [place.id, lane.family] as const)),
  );
  const places = mapPlaceResultsToChatItems(
    picked.map((place) => ({
      place,
      ctx: {
        locale: params.locale,
        mood: params.session.mood,
        weather: params.session.weather,
        userProfile: params.userProfile,
        categoryLabel: selection.styles.join("、"),
        categoryIntent: familyByPlaceId.get(place.id),
      },
    })),
  );
  devVerboseInfo("[PLANNING_SELECTION_MERGED]", {
    distribution: picked.reduce<Record<string, number>>((counts, place) => {
      const family = familyByPlaceId.get(place.id) ?? "unknown";
      counts[family] = (counts[family] ?? 0) + 1;
      return counts;
    }, {}),
    selectedPlaceIdsCount: selection.selectedPlaceIds.length,
    shownPlaceIdsCount: selection.shownPlaceIds.length + picked.length,
    reasonRenderer: "mapPlaceResultsToChatItems/buildDiversePlaceRecommendationReasons",
  });
  const nextSelection: PlanningSelectionSession = {
    ...selection,
    trustedDestination: searchDestination,
    shownPlaceIds: [...new Set([...selection.shownPlaceIds, ...picked.map((p) => p.id)])],
    shownFamilyCounts: picked.reduce<Partial<Record<RecommendationFamily, number>>>(
      (counts, place) => {
        const family = familyByPlaceId.get(place.id);
        if (family) counts[family] = (counts[family] ?? 0) + 1;
        return counts;
      },
      { ...(selection.shownFamilyCounts ?? {}) },
    ),
    lanes: selection.lanes.map((lane) => {
      const result = results.find((entry) => entry.lane.style === lane.style);
      const remaining = (result?.places ?? []).filter(
        (place) => !picked.some((item) => item.id === place.id),
      );
      const contract = STYLE_RECOMMENDATION_FAMILIES[lane.style];
      const searchedQueryIndexes = result?.searchedQueryIndexes ?? lane.searchedQueryIndexes ?? [];
      return {
        ...lane,
        queryCursor: searchedQueryIndexes.length,
        searchedQueryIndexes,
        candidatePool: remaining,
        exhausted: searchedQueryIndexes.length >= contract.queries.length && remaining.length === 0,
      };
    }),
  };
  return {
    places,
    session: {
      ...params.session,
      planningSelection: nextSelection,
      recommendedPlaces: [...params.session.recommendedPlaces, ...places],
      recommendedPlaceIds: nextSelection.shownPlaceIds,
      updatedAt: new Date().toISOString(),
    },
  };
}

export function isPlanningSelectionContinuation(text: string): boolean {
  return /(?:還有嗎|还有吗|再推薦|再推荐|其他的|更多推薦|more)/i.test(text.trim());
}
