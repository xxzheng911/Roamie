// Frozen legacy reader + its actual normalizers/schemas from 62fb6901c59ae16d7d01ec85a5571548fbeba4c9.
// Sources: src/lib/chat-history.ts and src/lib/ai/types.ts. No current parser imports.
// Extracted TypeScript SHA-256: efadc48808cd3344fe3fdc859e916d5b89efee2c2e6400df737e657c26b8c821
import { z } from "zod";
export const RoamieRecommendationItemSchema = z.object({
    name: z.string(),
    type: z.string(),
    primaryType: z.string().nullable().optional(),
    description: z.string(),
    reason: z.string(),
    estimatedTime: z.string(),
    address: z.string(),
    lat: z.number().nullable(),
    lng: z.number().nullable(),
    googleMapsUrl: z.string(),
    placeName: z.string(),
    reasonSource: z.enum(["template", "ai", "evidence", "fallback"]),
    googlePlaceId: z.string().optional(),
    photoName: z.string().nullable().optional(),
    rating: z.number().nullable().optional(),
    userRatingCount: z.number().nullable().optional(),
    businessStatus: z.string().nullable().optional(),
    openStatusLabel: z.string().optional(),
    todayHoursLabel: z.string().optional(),
    closingSoonNote: z.string().optional(),
    nextOpenHint: z.string().optional(),
    types: z.array(z.string()).optional(),
    sourceCombinationId: z.number().optional(),
    sourceCombinationIds: z.array(z.number()).optional(),
    matchedCombinationIds: z.array(z.number()).optional(),
    matchedSelectedCombinationIds: z.array(z.number()).optional(),
    sourceRegionCandidate: z.string().optional(),
    destinationScope: z.enum(["primary", "nearby_extension"]).optional(),
    extensionDestination: z.string().optional(),
    isRequiredBySelection: z.boolean().optional(),
});
export const RoamieItineraryItemSchema = z.object({
    date: z.string(),
    time: z.string(),
    title: z.string(),
    description: z.string(),
    placeName: z.string(),
    lat: z.number().nullable(),
    lng: z.number().nullable(),
    address: z.string().optional(),
    googlePlaceId: z.string().optional(),
    placeType: z.string().optional(),
    notes: z.string().optional(),
    originalName: z.string().optional(),
    localizedDisplayName: z.string().optional(),
    translationConfidence: z.number().optional(),
    brandNameException: z.boolean().optional(),
    languageCode: z.string().optional(),
    localizationSource: z.string().optional(),
    navigationLatitude: z.number().nullable().optional(),
    navigationLongitude: z.number().nullable().optional(),
    coordinateSource: z
        .enum([
        "google_places",
        "place_details",
        "navigation",
        "approx_center",
        "generated",
        "fallback",
        "region_center",
        "geocode",
        "unknown",
    ])
        .optional(),
    dayIndex: z.number().optional(),
    sortIndex: z.number().optional(),
    order: z.number().optional(),
    sourceCombinationId: z.number().optional(),
    sourceCombinationIds: z.array(z.number()).optional(),
    matchedCombinationIds: z.array(z.number()).optional(),
    matchedSelectedCombinationIds: z.array(z.number()).optional(),
    sourceRegionCandidate: z.string().optional(),
    destinationScope: z.enum(["primary", "nearby_extension"]).optional(),
    extensionDestination: z.string().optional(),
    photoName: z.string().nullable().optional(),
    rating: z.number().nullable().optional(),
    userRatingCount: z.number().nullable().optional(),
    businessStatus: z.string().nullable().optional(),
    openStatusLabel: z.string().optional(),
    todayHoursLabel: z.string().optional(),
    website: z.string().optional(),
    phone: z.string().optional(),
    types: z.array(z.string()).optional(),
    placeSnapshotSource: z.enum(["selected_place", "places_details", "handoff"]).optional(),
    recommendationReason: z.string().optional(),
    recommendationReasonSource: z.enum(["template", "ai", "evidence", "fallback"]).optional(),
    recommendationSource: z
        .enum(["explore", "map", "place_detail", "chat", "home", "selection", "favorites", "unknown"])
        .optional(),
    recommendationReasonVersion: z.literal(1).optional(),
});
export const RoamieResponseSchema = z.object({
    title: z.string(),
    summary: z.string(),
    moodTag: z.string(),
    recommendations: z.array(RoamieRecommendationItemSchema),
    itinerary: z.array(RoamieItineraryItemSchema),
});
export function isRoamiePayloadV2(payload) {
    if (!payload || typeof payload !== "object")
        return false;
    const p = payload;
    return p.version === 2 || Array.isArray(p.recommendations);
}
export function normalizeItineraryItem(raw) {
    return {
        date: raw.date ?? "",
        time: raw.time ?? "",
        title: raw.title,
        description: raw.description ?? "",
        placeName: raw.placeName,
        lat: raw.lat ?? null,
        lng: raw.lng ?? null,
        address: raw.address,
        googlePlaceId: raw.googlePlaceId,
        placeType: raw.placeType,
        notes: raw.notes,
        originalName: raw.originalName,
        localizedDisplayName: raw.localizedDisplayName,
        languageCode: raw.languageCode,
        localizationSource: raw.localizationSource,
        navigationLatitude: raw.navigationLatitude,
        navigationLongitude: raw.navigationLongitude,
        coordinateSource: raw.coordinateSource,
        dayIndex: raw.dayIndex,
        sortIndex: raw.sortIndex,
        order: raw.order,
        sourceCombinationId: raw.sourceCombinationId,
        sourceCombinationIds: raw.sourceCombinationIds,
        matchedCombinationIds: raw.matchedCombinationIds,
        matchedSelectedCombinationIds: raw.matchedSelectedCombinationIds,
        sourceRegionCandidate: raw.sourceRegionCandidate,
        destinationScope: raw.destinationScope,
        extensionDestination: raw.extensionDestination,
        photoName: raw.photoName,
        rating: raw.rating,
        userRatingCount: raw.userRatingCount,
        businessStatus: raw.businessStatus,
        openStatusLabel: raw.openStatusLabel,
        todayHoursLabel: raw.todayHoursLabel,
        website: raw.website,
        phone: raw.phone,
        types: raw.types,
        placeSnapshotSource: raw.placeSnapshotSource,
        recommendationReason: raw.recommendationReason,
        recommendationReasonSource: raw.recommendationReasonSource,
        recommendationSource: raw.recommendationSource,
        recommendationReasonVersion: raw.recommendationReasonVersion,
    };
}
export function normalizeRoamieResponse(raw) {
    const recs = Array.isArray(raw.recommendations)
        ? raw.recommendations.map((r) => normalizeRecommendationItem(r))
        : [];
    const itin = Array.isArray(raw.itinerary)
        ? raw.itinerary.map((i) => normalizeItineraryItem(i))
        : [];
    return RoamieResponseSchema.parse({
        title: raw.title ?? "",
        summary: raw.summary ?? "",
        moodTag: raw.moodTag ?? "",
        recommendations: recs,
        itinerary: itin,
    });
}
export function normalizeRecommendationItem(raw) {
    const localized = (raw.localizedDisplayName ?? "").trim() || (raw.placeName ?? "").trim() || raw.name;
    return {
        name: localized,
        type: raw.type ?? "地點",
        primaryType: raw.primaryType ?? raw.type ?? null,
        description: raw.description ?? "",
        reason: raw.reason ?? "",
        estimatedTime: raw.estimatedTime ?? "1-2 小時",
        address: raw.address ?? "",
        lat: raw.lat ?? null,
        lng: raw.lng ?? null,
        googleMapsUrl: raw.googleMapsUrl ?? "",
        placeName: localized,
        reasonSource: raw.reasonSource ?? "template",
        googlePlaceId: raw.googlePlaceId,
        photoName: raw.photoName ?? null,
        rating: raw.rating ?? null,
        userRatingCount: raw.userRatingCount ?? null,
        businessStatus: raw.businessStatus ?? null,
        openStatusLabel: raw.openStatusLabel,
        todayHoursLabel: raw.todayHoursLabel,
        closingSoonNote: raw.closingSoonNote,
        nextOpenHint: raw.nextOpenHint,
        types: raw.types,
        sourceCombinationId: raw.sourceCombinationId,
        sourceCombinationIds: raw.sourceCombinationIds,
        matchedCombinationIds: raw.matchedCombinationIds,
        matchedSelectedCombinationIds: raw.matchedSelectedCombinationIds,
        sourceRegionCandidate: raw.sourceRegionCandidate,
        destinationScope: raw.destinationScope,
        extensionDestination: raw.extensionDestination,
        localizedDisplayName: raw.localizedDisplayName ?? localized,
        originalName: raw.originalName,
        languageCode: raw.languageCode,
        localizationSource: raw.localizationSource,
    };
}
export function parseAssistantContent(content) {
    const trimmed = content.trim();
    if (!trimmed.startsWith("{"))
        return { content: trimmed };
    try {
        const roamie = normalizeRoamieResponse(JSON.parse(trimmed));
        return { content: roamie.summary, roamie };
    }
    catch {
        return { content: trimmed };
    }
}
