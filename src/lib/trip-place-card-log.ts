export function logTripPlaceCardRendered(params: {
  placeName: string;
  stayDurationLabel: string;
  buttons: string[];
}): void {
  console.info("[TRIP_PLACE_CARD_RENDERED]", params);
}

export function logOutfitSuggestionRendered(tripId: string, hasOutfitSuggestion: boolean): void {
  console.info("[OUTFIT_SUGGESTION_RENDERED]", { tripId, hasOutfitSuggestion });
}
