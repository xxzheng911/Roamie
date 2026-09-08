import type {
  ChatPlaceItem,
  ChatPlanningSession,
  PlanningShownCandidate,
} from "@/lib/chat-session";
import {
  parseExcludedCategoriesFromText,
  placeMatchesExcludedCategories,
} from "@/lib/ai/recommendation-exclusion";
import {
  destinationAdministrativeAliases,
  normalizeAdministrativeAlias,
} from "@/lib/ai/administrative-locality";

export type PlanningPlaceReference = {
  rawMention: string;
  placeId?: string;
  canonicalName?: string;
  resolved: boolean;
};

export type PlanningConversationConstraints = {
  mustIncludePlaces: PlanningPlaceReference[];
  excludedPlaces: PlanningPlaceReference[];
  preferredPlaceTypes: string[];
  excludedPlaceTypes: string[];
  cuisinePreferences: string[];
  activityPreferences: string[];
  attractionPreferences: string[];
  areaPreferences: string[];
  acceptedCandidateIds: string[];
  rejectedCandidateIds: string[];
  freeformIntentSummary?: string;
  pace?: "relaxed" | "balanced" | "packed";
  clarificationRequired: boolean;
  unresolvedEntities: string[];
};

export type PlanningConstraintDelta = Partial<PlanningConversationConstraints> & {
  intent: "modify_trip" | "planning_preference" | "planning_query" | "not_planning";
  confidence: "high" | "medium" | "low";
  changedFields: string[];
  acceptRemainingCandidates: boolean;
  correctedDays?: number;
  entityMatches?: PlanningEntityMatch[];
};

export type PlanningEntityMatch = {
  rawReferenceType: "name" | "ordinal" | "group" | "active_context";
  matched: boolean;
  matchType: "canonical" | "alias" | "ordinal" | "group" | "active_context" | "unresolved";
  candidateIndex: number | null;
  canonicalIdPresent: boolean;
};

export type PlanningCandidateContext = {
  candidates: ChatPlaceItem[];
  persistedCandidateCount: number;
  source:
    | "planning_suggestion"
    | "active_shown_candidates"
    | "recommended_places"
    | "rendered_messages"
    | "none";
};

export type PlanningParseStage =
  | "prepare_context"
  | "normalize_candidates"
  | "split_clauses"
  | "extract_entities"
  | "match_entities"
  | "build_delta"
  | "apply_delta"
  | "persist";

export type PlanningContextRequirement = {
  intent: "new_trip_setup" | "trip_level_modification" | "candidate_reference_modification";
  requiresCandidateContext: boolean;
  reason: "accept_remaining" | "ordinal" | "group_reference" | "previous_reference" | "none";
  candidateCount: number;
};

const EMPTY: PlanningConversationConstraints = {
  mustIncludePlaces: [],
  excludedPlaces: [],
  preferredPlaceTypes: [],
  excludedPlaceTypes: [],
  cuisinePreferences: [],
  activityPreferences: [],
  attractionPreferences: [],
  areaPreferences: [],
  acceptedCandidateIds: [],
  rejectedCandidateIds: [],
  clarificationRequired: false,
  unresolvedEntities: [],
};

const CUISINE_HINTS = [
  "壽司",
  "燒肉",
  "居酒屋",
  "拉麵",
  "咖啡",
  "甜點",
  "早餐",
  "海鮮",
  "火鍋",
  "日式料理",
  "台菜",
  "夜市美食",
];
const EXPERIENCE_HINTS = ["夜景", "看海", "海邊", "展覽", "古蹟", "老街", "在地", "必去"];

function unique(values: Iterable<string>): string[] {
  return [...new Set([...values].map((value) => value.trim()).filter(Boolean))];
}

function placeId(place: ChatPlaceItem): string {
  return (place.googlePlaceId ?? place.placeId ?? place.name).trim();
}

/** Persist only the plain candidate fields needed by conversational reference resolution. */
export function snapshotPlanningCandidates(
  candidates: ChatPlaceItem[],
  source: PlanningShownCandidate["source"] = "recommendation_cards",
): PlanningShownCandidate[] {
  return candidates.map((place, itemIndex): PlanningShownCandidate => {
    const planning = place as Partial<PlanningShownCandidate>;
    const canonicalId =
      planning.canonicalId ?? place.googlePlaceId ?? place.placeId ?? place.placeName ?? place.name;
    const normalizedAliases = unique(
      planning.normalizedAliases?.length
        ? planning.normalizedAliases
        : [place.placeName ?? place.name, place.name, place.displayName ?? ""].map((value) =>
            value.toLocaleLowerCase().replace(/[\s市縣区區\-—_・·]/g, ""),
          ),
    );
    return {
      name: place.name,
      placeName: place.placeName,
      type: place.type,
      primaryType: place.primaryType,
      description: place.description,
      reason: place.reason,
      reasonSource: place.reasonSource,
      estimatedTime: place.estimatedTime,
      address: place.address,
      lat: place.lat ?? null,
      lng: place.lng ?? null,
      googleMapsUrl: place.googleMapsUrl,
      googlePlaceId: place.googlePlaceId,
      placeId: place.placeId ?? canonicalId,
      displayName: place.displayName,
      rating: place.rating,
      canonicalId,
      normalizedAliases,
      source: planning.source ?? source,
      groupId: planning.groupId,
      groupTitle: planning.groupTitle,
      groupIndex: planning.groupIndex,
      itemIndex: planning.itemIndex ?? itemIndex,
    };
  });
}

export function planningRejectedCandidateIds(session: ChatPlanningSession): string[] {
  return unique([
    ...(session.planningConstraints?.rejectedCandidateIds ?? []),
    ...(session.planningConstraints?.excludedPlaces
      .map((place) => place.placeId)
      .filter((id): id is string => Boolean(id?.trim())) ?? []),
  ]);
}

export function isPlanningPlaceRejected(
  place: Pick<ChatPlaceItem, "googlePlaceId" | "placeId" | "name">,
  rejectedIds: Iterable<string>,
): boolean {
  const rejected = new Set([...rejectedIds].map((id) => id.trim()).filter(Boolean));
  return [place.googlePlaceId, place.placeId].some((id) =>
    Boolean(id?.trim() && rejected.has(id.trim())),
  );
}

export function filterPlanningRejectedPlaces<T extends ChatPlaceItem>(
  places: T[],
  session: ChatPlanningSession,
): T[] {
  const rejectedIds = planningRejectedCandidateIds(session);
  return places.filter((place) => !isPlanningPlaceRejected(place, rejectedIds));
}

export function resolvePlanningCandidateContext(
  session: ChatPlanningSession,
  renderedCandidates: ChatPlaceItem[] = [],
): PlanningCandidateContext {
  if (session.activeShownCandidates?.length) {
    return {
      candidates: session.activeShownCandidates,
      persistedCandidateCount: session.activeShownCandidates.length,
      source:
        session.activeShownCandidates[0]?.source === "planning_suggestion"
          ? "planning_suggestion"
          : "active_shown_candidates",
    };
  }
  if (session.recommendedPlaces.length) {
    return {
      candidates: session.recommendedPlaces,
      persistedCandidateCount: 0,
      source: "recommended_places",
    };
  }
  if (renderedCandidates.length) {
    return {
      candidates: renderedCandidates,
      persistedCandidateCount: 0,
      source: "rendered_messages",
    };
  }
  return { candidates: [], persistedCandidateCount: 0, source: "none" };
}

function normalized(value: string): string {
  return value.toLocaleLowerCase().replace(/[\s市縣区區\-—_・·]/g, "");
}

function destinationPrefixAliases(
  place: ChatPlaceItem,
  destination?: string,
): Array<{
  value: string;
  destinationAliasUsed: string;
}> {
  if (!destination) return [];
  const name = place.placeName ?? place.name;
  const compactName = normalized(name);
  return destinationAdministrativeAliases(destination).flatMap((destinationAliasUsed) => {
    const prefix = normalized(destinationAliasUsed);
    if (!prefix || !compactName.startsWith(prefix)) return [];
    const value = compactName.slice(prefix.length);
    return value ? [{ value, destinationAliasUsed }] : [];
  });
}

function aliases(place: ChatPlaceItem, destination?: string): string[] {
  const planning = place as Partial<PlanningShownCandidate>;
  const name = place.placeName ?? place.name;
  const compact = normalized(name);
  const withoutSuffix = compact.replace(
    /文化創意產業園區|文化創意園區|創意園區|商圈|夜市|紀念堂|大樓$/g,
    "",
  );
  const numericTokens = compact.match(/\d+/g) ?? [];
  return unique([
    name,
    compact,
    withoutSuffix,
    ...destinationPrefixAliases(place, destination).map(({ value }) => value),
    ...numericTokens,
    ...(planning.normalizedAliases ?? []),
  ]);
}

function mentionedCandidateGroup(
  text: string,
  shown: ChatPlaceItem[],
): { places: ChatPlaceItem[]; matches: PlanningEntityMatch[] } | null {
  const grouped = new Map<
    string,
    { groupIndex: number; groupTitle: string; places: ChatPlaceItem[] }
  >();
  shown.forEach((place) => {
    const planning = place as Partial<PlanningShownCandidate>;
    if (planning.groupIndex == null || !planning.groupId) return;
    const current = grouped.get(planning.groupId) ?? {
      groupIndex: planning.groupIndex,
      groupTitle: planning.groupTitle ?? "",
      places: [],
    };
    current.places.push(place);
    grouped.set(planning.groupId, current);
  });
  if (!grouped.size) return null;

  const requestedIndexes = new Set<number>();
  for (const match of text.matchAll(/第\s*([一二三四五六七八九十\d]+)\s*組/g)) {
    const table: Record<string, number> = {
      一: 1,
      二: 2,
      三: 3,
      四: 4,
      五: 5,
      六: 6,
      七: 7,
      八: 8,
      九: 9,
      十: 10,
    };
    const oneBased = Number(match[1]) || table[match[1]!] || 0;
    if (oneBased > 0) requestedIndexes.add(oneBased - 1);
  }

  const normalizeGroupToken = (value: string) =>
    value.toLocaleLowerCase().replace(/[\s\-—_・·]/g, "");
  const compactText = normalizeGroupToken(text);
  const tokensByGroup = new Map<number, string[]>();
  const tokenOwners = new Map<string, number>();
  for (const group of grouped.values()) {
    const title = normalizeGroupToken(group.groupTitle).replace(/組合$/, "");
    const placeTokens = group.places.flatMap((place) => {
      const rawCandidateName = place.placeName ?? place.name;
      const candidateName = normalizeGroupToken(rawCandidateName);
      return [
        candidateName,
        ...(rawCandidateName.match(/夜市|商圈|地標|市場|公園|博物館|寺廟|寺/g) ?? []).map(
          normalizeGroupToken,
        ),
      ];
    });
    const titleTokens = unique([
      title,
      ...(title.length >= 4 ? [title.slice(0, 2), title.slice(0, 4)] : []),
      ...placeTokens,
    ]).filter((token) => token.length >= 2);
    tokensByGroup.set(group.groupIndex, titleTokens);
    for (const token of titleTokens) {
      tokenOwners.set(token, (tokenOwners.get(token) ?? 0) + 1);
    }
  }
  for (const group of grouped.values()) {
    const titleTokens = tokensByGroup.get(group.groupIndex) ?? [];
    if (
      /組/.test(text) &&
      titleTokens.some((token) => tokenOwners.get(token) === 1 && compactText.includes(token))
    ) {
      requestedIndexes.add(group.groupIndex);
    }
  }
  if (!requestedIndexes.size) return null;

  const selectedGroups = [...grouped.values()]
    .filter((group) => requestedIndexes.has(group.groupIndex))
    .sort((a, b) => a.groupIndex - b.groupIndex);
  if (!selectedGroups.length) {
    return {
      places: [],
      matches: [...requestedIndexes].map(() => ({
        rawReferenceType: "group",
        matched: false,
        matchType: "unresolved",
        candidateIndex: null,
        canonicalIdPresent: false,
      })),
    };
  }
  return {
    places: selectedGroups.flatMap((group) => group.places),
    matches: selectedGroups.map((group) => ({
      rawReferenceType: "group",
      matched: true,
      matchType: "group",
      candidateIndex: shown.indexOf(group.places[0]!),
      canonicalIdPresent: group.places.every((place) =>
        Boolean(
          (place as Partial<PlanningShownCandidate>).canonicalId ??
          place.googlePlaceId ??
          place.placeId,
        ),
      ),
    })),
  };
}

function mentionedCandidates(
  text: string,
  shown: ChatPlaceItem[],
  destination?: string,
): { places: ChatPlaceItem[]; matches: PlanningEntityMatch[] } {
  const groupMention = mentionedCandidateGroup(text, shown);
  if (groupMention) return groupMention;
  const compact = normalized(text);
  const contextualToken = normalized(
    text.replace(
      /不要|不用|拿掉|排除|去過|去过|不想|除了|還要去|还要去|想去|必去|加入|加進去|加进去/g,
      "",
    ),
  );
  const dynamicCandidateIndexes = new Set(
    shown.flatMap((place, candidateIndex) =>
      destinationPrefixAliases(place, destination).some(({ value }) => {
        const alias = normalized(value);
        return Boolean(
          contextualToken && (alias === contextualToken || alias.startsWith(contextualToken)),
        );
      })
        ? [candidateIndex]
        : [],
    ),
  );
  const table: Record<string, number> = {
    一: 1,
    二: 2,
    三: 3,
    四: 4,
    五: 5,
    六: 6,
    七: 7,
    八: 8,
    九: 9,
    十: 10,
  };
  const ordinalMatches = [...text.matchAll(/第\s*([一二三四五六七八九十\d]+)\s*(?:個|項|張)?/g)];
  if (ordinalMatches.length) {
    const places: ChatPlaceItem[] = [];
    const matches: PlanningEntityMatch[] = [];
    for (const ordinal of ordinalMatches) {
      const index = Number(ordinal[1]) || table[ordinal[1]!] || 0;
      const place = index > 0 ? shown[index - 1] : undefined;
      if (place) places.push(place);
      matches.push({
        rawReferenceType: "ordinal",
        matched: Boolean(place),
        matchType: place ? "ordinal" : "unresolved",
        candidateIndex: place ? index - 1 : null,
        canonicalIdPresent: Boolean(place && (place.googlePlaceId ?? place.placeId)),
      });
    }
    return {
      places,
      matches,
    };
  }
  const aliasOwners = new Map<string, number>();
  for (const place of shown) {
    const dynamic = new Set(
      destinationPrefixAliases(place, destination).map(({ value }) => normalized(value)),
    );
    for (const alias of aliases(place, destination)
      .map(normalized)
      .filter((value) => value.length >= 2 || dynamic.has(value))) {
      aliasOwners.set(alias, (aliasOwners.get(alias) ?? 0) + 1);
    }
  }
  const places: ChatPlaceItem[] = [];
  const matches: PlanningEntityMatch[] = [];
  shown.forEach((place, candidateIndex) => {
    const canonical = normalized(place.placeName ?? place.name);
    const dynamicAliases = destinationPrefixAliases(place, destination);
    const staticMatch = aliases(place)
      .map(normalized)
      .find(
        (alias) => alias.length >= 2 && aliasOwners.get(alias) === 1 && compact.includes(alias),
      );
    const contextualDynamicMatch =
      dynamicCandidateIndexes.size === 1 && dynamicCandidateIndexes.has(candidateIndex)
        ? dynamicAliases.find(({ value }) => {
            const alias = normalized(value);
            return alias === contextualToken || alias.startsWith(contextualToken);
          })
        : undefined;
    const matchedAlias =
      staticMatch ??
      (contextualDynamicMatch ? normalized(contextualDynamicMatch.value) : undefined);
    if (!matchedAlias) return;
    places.push(place);
    matches.push({
      rawReferenceType: "name",
      matched: true,
      matchType: matchedAlias === canonical ? "canonical" : "alias",
      candidateIndex,
      canonicalIdPresent: Boolean(place.googlePlaceId ?? place.placeId),
    });
    const dynamicMatch =
      contextualDynamicMatch ??
      dynamicAliases.find(({ value }) => normalized(value) === matchedAlias);
    if (dynamicMatch) {
      console.info("[PLANNING_CONTEXT_ALIAS_MATCH]", {
        destinationAliasUsed: normalizeAdministrativeAlias(dynamicMatch.destinationAliasUsed),
        prefixRemoved: true,
        candidateCount: shown.length,
        uniqueMatch: true,
        ambiguous: false,
      });
    }
  });
  if (!places.length && destination) {
    const possible = shown
      .flatMap((place) => destinationPrefixAliases(place, destination))
      .filter(({ value }) => {
        const alias = normalized(value);
        return Boolean(
          contextualToken && (alias === contextualToken || alias.startsWith(contextualToken)),
        );
      });
    if (dynamicCandidateIndexes.size > 1) {
      console.info("[PLANNING_CONTEXT_ALIAS_MATCH]", {
        destinationAliasUsed: normalizeAdministrativeAlias(possible[0]!.destinationAliasUsed),
        prefixRemoved: true,
        candidateCount: shown.length,
        uniqueMatch: false,
        ambiguous: true,
      });
    }
  }
  return { places, matches };
}

function placeRef(place: ChatPlaceItem): PlanningPlaceReference {
  return {
    rawMention: place.placeName ?? place.name,
    placeId: placeId(place),
    canonicalName: place.placeName ?? place.name,
    resolved: Boolean(place.googlePlaceId ?? place.placeId),
  };
}

function isNegative(text: string): boolean {
  return /不要|不用|拿掉|排除|去過|去过|不想|除了/.test(text);
}

function isInclude(text: string): boolean {
  return /還要去|还要去|也想去|想去|必去|一定要|排進|排进|安排在一起|順便去|顺便去|加進去|加进去|加入|幫我加|帮我加/.test(
    text,
  );
}

function extractUnresolvedIncludeMentions(text: string): string[] {
  if (!isInclude(text)) return [];
  const body = text
    .replace(
      /幫我|帮我|還要去|还要去|還要|还要|也想去|想去|一定要|必去|順便去|顺便去|安排|排進去|排进去|加進去|加进去|加入|在一起|也/g,
      " ",
    )
    .split(/跟|和|、|，|,|以及/)
    .map((part) => part.trim())
    .filter((part) => part.length >= 2 && part.length <= 30);
  return unique(body);
}

export function logPlanningParseStage(params: {
  stage: PlanningParseStage;
  candidateCount: number;
  clauseCount: number;
  entityCount: number;
}): void {
  console.info("[PLANNING_PARSE_STAGE]", params);
}

export function logPlanningParseFailure(params: {
  stage: PlanningParseStage;
  errorType: string;
  recursiveGuardTriggered: boolean;
  settled: boolean;
}): void {
  console.error("[PLANNING_PARSE_FAILURE]", params);
}

export function parsePlanningConstraintDelta(params: {
  text: string;
  shownCandidates?: ChatPlaceItem[];
  activePlace?: ChatPlaceItem;
  authoritativeDestination?: string;
  onStage?: (stage: PlanningParseStage) => void;
}): PlanningConstraintDelta {
  const text = params.text.trim();
  const shown = params.shownCandidates ?? [];
  const reportStage = (stage: PlanningParseStage, clauseCount: number, entityCount: number) => {
    params.onStage?.(stage);
    logPlanningParseStage({
      stage,
      candidateCount: shown.length,
      clauseCount,
      entityCount,
    });
  };
  reportStage("prepare_context", 0, 0);
  reportStage("normalize_candidates", 0, 0);
  const clauses = text
    .split(/[，,；;。]|\s*(?:但是|但|不過|不过)\s*/)
    .map((clause) => clause.trim())
    .filter(Boolean);
  reportStage("split_clauses", clauses.length, 0);
  const negativeClauses = clauses.filter(isNegative);
  const includeClauses = clauses.filter((clause) => isInclude(clause) && !isNegative(clause));
  const entityCount = negativeClauses.length + includeClauses.length;
  reportStage("extract_entities", clauses.length, entityCount);
  const negativeMentions = negativeClauses.map((clause) =>
    mentionedCandidates(clause, shown, params.authoritativeDestination),
  );
  const includeMentions = includeClauses.map((clause) =>
    mentionedCandidates(clause, shown, params.authoritativeDestination),
  );
  reportStage(
    "match_entities",
    clauses.length,
    [...negativeMentions, ...includeMentions].reduce(
      (count, result) => count + result.matches.length,
      0,
    ),
  );
  const contextualPlace = /這個不要|这个不要/.test(text)
    ? (params.activePlace ?? (shown.length === 1 ? shown[0] : undefined))
    : undefined;
  const contextual = contextualPlace ? [contextualPlace] : [];
  const excludedMatched = unique(
    [...negativeMentions.flatMap((result) => result.places), ...contextual].map(placeId),
  )
    .map((id) =>
      [...shown, ...(params.activePlace ? [params.activePlace] : [])].find(
        (p) => placeId(p) === id,
      ),
    )
    .filter((p): p is ChatPlaceItem => Boolean(p));
  const includedMatched = unique(includeMentions.flatMap((result) => result.places).map(placeId))
    .map((id) => shown.find((p) => placeId(p) === id))
    .filter((p): p is ChatPlaceItem => Boolean(p))
    .filter((place) => !excludedMatched.some((excluded) => placeId(excluded) === placeId(place)));
  const entityMatches = [
    ...negativeMentions.flatMap((result) => result.matches),
    ...includeMentions.flatMap((result) => result.matches),
    ...(contextualPlace
      ? [
          {
            rawReferenceType: "active_context" as const,
            matched: true,
            matchType: "active_context" as const,
            candidateIndex: shown.findIndex((place) => placeId(place) === placeId(contextualPlace)),
            canonicalIdPresent: Boolean(contextualPlace.googlePlaceId ?? contextualPlace.placeId),
          },
        ]
      : []),
  ];
  const negative = isNegative(text);
  const include = isInclude(text);
  const acceptRemainingCandidates =
    /其他(?:的)?都(?:可以|行)|其餘(?:的)?都(?:可以|行)|其余(?:的)?都(?:可以|行)|除了.+(?:以外)?都(?:可以|行)/.test(
      text,
    );
  // A resolved place exclusion is entity authority, not category authority.
  // Only negative clauses that did not resolve to a shown candidate may create
  // a category-level exclusion (e.g. 「不要博物館」).
  const categoryOnlyNegativeText = negativeClauses
    .filter((_, index) => (negativeMentions[index]?.places.length ?? 0) === 0)
    .join(" ");
  const excludedPlaceTypes = parseExcludedCategoriesFromText(categoryOnlyNegativeText);
  if (/觀光|观光/.test(categoryOnlyNegativeText)) excludedPlaceTypes.push("touristy");
  const cuisinePreferences =
    !negative &&
    (/吃|餐|料理|美食|咖啡|甜點|甜点/.test(text) ||
      CUISINE_HINTS.some((hint) => text.includes(hint)))
      ? CUISINE_HINTS.filter((hint) => text.includes(hint))
      : [];
  const attractionPreferences = !negative
    ? EXPERIENCE_HINTS.filter((hint) => text.includes(hint))
    : [];
  const pace = /不要排太趕|不要太趕|轻松|輕鬆|慢慢|悠閒|悠闲/.test(text)
    ? ("relaxed" as const)
    : undefined;
  const correctionMatches = [...text.matchAll(/([一二三四五六七八九十\d]+)天/g)];
  const correction = /不是|改成|改為|改为/.test(text) ? correctionMatches.at(-1) : undefined;
  const dayTable: Record<string, number> = {
    一: 1,
    二: 2,
    三: 3,
    四: 4,
    五: 5,
    六: 6,
    七: 7,
    八: 8,
    九: 9,
    十: 10,
  };
  const correctedDays = correction ? Number(correction[1]) || dayTable[correction[1]!] : undefined;
  const unresolved = unique(
    includeClauses.flatMap((clause) =>
      mentionedCandidates(clause, shown, params.authoritativeDestination).places.length
        ? []
        : extractUnresolvedIncludeMentions(clause),
    ),
  );
  const changedFields = [
    excludedMatched.length ? "excludedPlaces" : "",
    includedMatched.length ? "mustIncludePlaces" : "",
    acceptRemainingCandidates ? "acceptedCandidateIds" : "",
    cuisinePreferences.length ? "cuisinePreferences" : "",
    excludedPlaceTypes.length ? "excludedPlaceTypes" : "",
    attractionPreferences.length ? "attractionPreferences" : "",
    pace ? "pace" : "",
    correctedDays ? "days" : "",
    unresolved.length ? "unresolvedEntities" : "",
  ].filter(Boolean);
  const planning =
    changedFields.length > 0 ||
    /行程|安排|規劃|规划|幫我排|帮我排|排得|景點|景点|必去|好吃/.test(text);
  reportStage("build_delta", clauses.length, entityMatches.length);
  const unresolvedIncludeRefs: PlanningPlaceReference[] = unresolved.map((rawMention) => ({
    rawMention,
    canonicalName: rawMention,
    resolved: false,
  }));
  return {
    intent: negative || include ? "modify_trip" : planning ? "planning_preference" : "not_planning",
    confidence:
      excludedMatched.length ||
      includedMatched.length ||
      cuisinePreferences.length ||
      excludedPlaceTypes.length ||
      correctedDays
        ? "high"
        : planning
          ? "medium"
          : "low",
    changedFields,
    acceptRemainingCandidates,
    mustIncludePlaces: [...includedMatched.map(placeRef), ...unresolvedIncludeRefs],
    excludedPlaces: excludedMatched.map(placeRef),
    excludedPlaceTypes,
    cuisinePreferences,
    attractionPreferences,
    pace,
    correctedDays,
    unresolvedEntities: unresolved,
    clarificationRequired: unresolved.length > 1,
    freeformIntentSummary: planning ? text.slice(0, 160) : undefined,
    entityMatches,
  };
}

export function applyPlanningConstraintDelta(
  session: ChatPlanningSession,
  delta: PlanningConstraintDelta,
  shownCandidates: ChatPlaceItem[] = [],
): ChatPlanningSession {
  logPlanningParseStage({
    stage: "apply_delta",
    candidateCount: shownCandidates.length,
    clauseCount: 0,
    entityCount: delta.entityMatches?.length ?? 0,
  });
  const previous = session.planningConstraints ?? EMPTY;
  const excludedIds = new Set([
    ...previous.rejectedCandidateIds,
    ...((delta.excludedPlaces ?? []).map((p) => p.placeId).filter(Boolean) as string[]),
  ]);
  const acceptedIds = new Set([
    ...previous.acceptedCandidateIds,
    ...((delta.mustIncludePlaces ?? []).map((p) => p.placeId).filter(Boolean) as string[]),
  ]);
  if (delta.acceptRemainingCandidates) {
    for (const place of shownCandidates)
      if (!excludedIds.has(placeId(place))) acceptedIds.add(placeId(place));
  }
  for (const id of excludedIds) acceptedIds.delete(id);
  const selectedById = new Map(session.selectedPlaces.map((place) => [placeId(place), place]));
  for (const place of shownCandidates)
    if (acceptedIds.has(placeId(place))) selectedById.set(placeId(place), place);
  for (const id of excludedIds) selectedById.delete(id);
  const excludedNames = new Set(session.rejectedPlaceNames ?? []);
  for (const ref of delta.excludedPlaces ?? [])
    if (ref.canonicalName) excludedNames.add(ref.canonicalName);
  const constraints: PlanningConversationConstraints = {
    mustIncludePlaces: [...previous.mustIncludePlaces, ...(delta.mustIncludePlaces ?? [])].filter(
      (ref, i, all) =>
        !excludedIds.has(ref.placeId ?? "") &&
        all.findIndex((x) => (x.placeId ?? x.rawMention) === (ref.placeId ?? ref.rawMention)) === i,
    ),
    excludedPlaces: [...previous.excludedPlaces, ...(delta.excludedPlaces ?? [])].filter(
      (ref, i, all) =>
        all.findIndex((x) => (x.placeId ?? x.rawMention) === (ref.placeId ?? ref.rawMention)) === i,
    ),
    preferredPlaceTypes: unique([
      ...previous.preferredPlaceTypes,
      ...(delta.preferredPlaceTypes ?? []),
    ]),
    excludedPlaceTypes: unique([
      ...previous.excludedPlaceTypes,
      ...(delta.excludedPlaceTypes ?? []),
    ]),
    cuisinePreferences: unique([
      ...previous.cuisinePreferences,
      ...(delta.cuisinePreferences ?? []),
    ]),
    activityPreferences: unique([
      ...previous.activityPreferences,
      ...(delta.activityPreferences ?? []),
    ]),
    attractionPreferences: unique([
      ...previous.attractionPreferences,
      ...(delta.attractionPreferences ?? []),
    ]),
    areaPreferences: unique([...previous.areaPreferences, ...(delta.areaPreferences ?? [])]),
    acceptedCandidateIds: [...acceptedIds],
    rejectedCandidateIds: [...excludedIds],
    freeformIntentSummary: delta.freeformIntentSummary ?? previous.freeformIntentSummary,
    pace: delta.pace ?? previous.pace,
    clarificationRequired: delta.clarificationRequired ?? false,
    unresolvedEntities: unique([
      ...previous.unresolvedEntities,
      ...(delta.unresolvedEntities ?? []),
    ]),
  };
  const excludedCategories = unique([
    ...(session.excludedCategories ?? []),
    ...constraints.excludedPlaceTypes,
  ]);
  const selectedPlaces = [...selectedById.values()].filter(
    (place) => !placeMatchesExcludedCategories(place, excludedCategories),
  );
  return {
    ...session,
    planningConstraints: constraints,
    selectedPlaces,
    plannedStops: selectedPlaces.length ? selectedPlaces : session.plannedStops,
    // A rendered day plan predating an explicit rejection is stale authority.
    // Force the normal planner path to rebuild from the accepted-minus-rejected pool.
    currentDayPlan: delta.excludedPlaces?.length ? undefined : session.currentDayPlan,
    rejectedPlaceNames: [...excludedNames],
    excludedCategories,
    tripDays: delta.correctedDays ?? session.tripDays,
    pace: constraints.pace === "relaxed" ? "輕鬆" : session.pace,
    discovery: constraints.unresolvedEntities[0]
      ? { ...session.discovery, mustVisit: constraints.unresolvedEntities[0] }
      : session.discovery,
    travelContext: {
      ...(session.travelContext ?? { interests: [] }),
      interests: unique([
        ...((session.travelContext?.interests as string[] | undefined) ?? []),
        ...constraints.cuisinePreferences,
        ...constraints.attractionPreferences,
      ]),
      excludedCategories,
    },
  };
}

export function logPlanningConstraintDiagnostics(
  delta: PlanningConstraintDelta,
  session: ChatPlanningSession,
  opts?: { candidateCount?: number },
): void {
  const state = session.planningConstraints ?? EMPTY;
  const unresolvedAcceptRemaining =
    delta.acceptRemainingCandidates && (opts?.candidateCount ?? 0) === 0;
  const clarificationRequired = Boolean(delta.clarificationRequired) || unresolvedAcceptRemaining;
  console.info("[PLANNING_USER_INTENT]", {
    intent: delta.intent,
    confidence: delta.confidence,
    hasInclude: Boolean(delta.mustIncludePlaces?.length),
    hasExclude: Boolean(delta.excludedPlaces?.length),
    hasCuisine: Boolean(delta.cuisinePreferences?.length),
    hasCategory: Boolean(delta.excludedPlaceTypes?.length || delta.attractionPreferences?.length),
    hasCorrection: Boolean(delta.correctedDays),
    clarificationRequired,
  });
  console.info("[PLANNING_CONSTRAINT_DELTA]", {
    includeCount: delta.mustIncludePlaces?.length ?? 0,
    excludeCount: delta.excludedPlaces?.length ?? 0,
    acceptedCount: delta.acceptRemainingCandidates ? state.acceptedCandidateIds.length : 0,
    cuisineCount: delta.cuisinePreferences?.length ?? 0,
    categoryCount:
      (delta.excludedPlaceTypes?.length ?? 0) + (delta.attractionPreferences?.length ?? 0),
    changedFields: delta.changedFields,
    unresolvedAcceptRemaining,
    clarificationRequired,
  });
  console.info("[PLANNING_CONSTRAINT_STATE]", {
    destinationPresent: Boolean(session.tripDestination || session.travelContext?.destination),
    days: session.tripDays,
    mustIncludeCount: state.mustIncludePlaces.length,
    excludedCount: state.excludedPlaces.length,
    acceptedCount: state.acceptedCandidateIds.length,
    unresolvedEntityCount: state.unresolvedEntities.length,
    clarificationRequired,
  });
  console.info("[PLANNING_EXCLUSION_AUTHORITY]", {
    explicitPlaceCount: delta.excludedPlaces?.length ?? 0,
    explicitCategoryCount: delta.excludedPlaceTypes?.length ?? 0,
    keywordCategoryCount: delta.excludedPlaceTypes?.length ?? 0,
    acceptRemaining: delta.acceptRemainingCandidates,
    normalizedCategoryFamilies: delta.excludedPlaceTypes ?? [],
  });
  for (const match of delta.entityMatches ?? []) {
    console.info("[PLANNING_ENTITY_MATCH]", match);
  }
}

export function hasUnresolvedPlanningCandidateContext(
  delta: PlanningConstraintDelta,
  candidateCount: number,
): boolean {
  return (
    resolvePlanningContextRequirement({ text: "", delta, candidateCount })
      .requiresCandidateContext && candidateCount === 0
  );
}

function normalizedTripScopeEntity(value: string): string {
  return value
    .toLocaleLowerCase()
    .replace(/下個月|下个月|這個月|这个月|明年|今年/g, "")
    .replace(/[一二兩两三四五六七八九十\d]+\s*(?:天(?:一夜)?|日遊|日游|晚)/g, "")
    .replace(/我要去|我想去|想去|幫我排|帮我排|我要|安排|規劃|规划|我/g, "")
    .replace(/[\s，,。！!？?]/g, "");
}

/** Removes a trip-scope destination accidentally emitted as a must-include place. */
export function disambiguatePlanningDestinationEntity(params: {
  delta: PlanningConstraintDelta;
  destination?: string;
}): PlanningConstraintDelta {
  const destination = normalizedTripScopeEntity(params.destination ?? "");
  if (!destination) return params.delta;
  const duplicated = (value: string) => normalizedTripScopeEntity(value) === destination;
  const mustIncludePlaces = (params.delta.mustIncludePlaces ?? []).filter(
    (reference) => !duplicated(reference.rawMention),
  );
  const unresolvedEntities = (params.delta.unresolvedEntities ?? []).filter(
    (entity) => !duplicated(entity),
  );
  const duplicatedAsPlaceEntity =
    mustIncludePlaces.length !== (params.delta.mustIncludePlaces?.length ?? 0) ||
    unresolvedEntities.length !== (params.delta.unresolvedEntities?.length ?? 0);
  console.info("[PLANNING_DESTINATION_ENTITY_DISAMBIGUATION]", {
    destinationDetected: true,
    destinationConsumedAsTripScope: duplicatedAsPlaceEntity,
    duplicatedAsPlaceEntity,
    finalUnresolvedEntityCount: unresolvedEntities.length,
  });
  if (!duplicatedAsPlaceEntity) return params.delta;
  const changedFields = params.delta.changedFields.filter(
    (field) =>
      !(field === "mustIncludePlaces" && mustIncludePlaces.length === 0) &&
      !(field === "unresolvedEntities" && unresolvedEntities.length === 0),
  );
  return {
    ...params.delta,
    intent:
      params.delta.intent === "modify_trip" && changedFields.length === 0
        ? "not_planning"
        : params.delta.intent,
    changedFields,
    mustIncludePlaces,
    unresolvedEntities,
    clarificationRequired: unresolvedEntities.length > 1,
  };
}

/** Single authority deciding whether this turn semantically references candidate context. */
export function resolvePlanningContextRequirement(params: {
  text: string;
  delta: PlanningConstraintDelta;
  candidateCount: number;
  destinationDetected?: boolean;
  durationOrDateDetected?: boolean;
}): PlanningContextRequirement {
  const { delta, candidateCount } = params;
  const matches = delta.entityMatches ?? [];
  const groupReference =
    matches.some((match) => match.rawReferenceType === "group") ||
    /(?:第[一二兩两三四五六七八九十\d]+|這|这|那)組/.test(params.text);
  const ordinalReference =
    matches.some((match) => match.rawReferenceType === "ordinal") ||
    /第[一二兩两三四五六七八九十\d]+個|前[一二兩两三四五六七八九十\d]+個/.test(params.text);
  const reason: PlanningContextRequirement["reason"] = delta.acceptRemainingCandidates
    ? "accept_remaining"
    : groupReference
      ? "group_reference"
      : ordinalReference
        ? "ordinal"
        : matches.some((match) => match.rawReferenceType === "active_context") ||
            /剛剛|刚刚|那些|這個|这个|前面(?:的)?/.test(params.text)
          ? "previous_reference"
          : "none";
  const requiresCandidateContext = reason !== "none";
  const isNewTripSetup =
    reason === "none" &&
    Boolean(params.destinationDetected) &&
    (Boolean(params.durationOrDateDetected) ||
      /我要去|我想去|想去|幫我排|帮我排/.test(params.text));
  const intent: PlanningContextRequirement["intent"] =
    reason !== "none"
      ? "candidate_reference_modification"
      : isNewTripSetup
        ? "new_trip_setup"
        : "trip_level_modification";
  const result = { intent, requiresCandidateContext, reason, candidateCount };
  console.info("[PLANNING_CONTEXT_REQUIREMENT]", result);
  return result;
}

export function logPlanningStateInvariant(state: string, candidateCount: number): boolean {
  const valid = state !== "awaiting_combination_selection" || candidateCount > 0;
  console.info("[PLANNING_STATE_INVARIANT]", { state, candidateCount, valid });
  return valid;
}

export function logPlanningCandidateContext(params: {
  shownCandidateCount: number;
  persistedCandidateCount: number;
  activeContextAvailable: boolean;
  source:
    | "planning_suggestion"
    | "active_shown_candidates"
    | "recommended_places"
    | "rendered_messages"
    | "none";
}): void {
  console.info("[PLANNING_CANDIDATE_CONTEXT]", params);
}

export function logPlanningExclusionPropagation(params: {
  parsedExcludeCount: number;
  sessionExcludeCount: number;
  plannerExcludeCount: number;
  finalViolationCount: number;
}): void {
  console.info("[PLANNING_EXCLUSION_PROPAGATION]", params);
}
