import { attachDestinationDisplay } from "./destination-display-metadata";
import { finalizePlanningContextAuthority } from "./planning-context-authority";
import type { ChatPlanningSession } from '@/lib/chat-session';
import type { CanonicalTravelContext } from './travel-context';
import { travelDestinationCandidates, safeDestinationCandidate, multilingualTravelIntent, nearbyLanguageSignal } from './travel-language-signals';
import { planningCalendarSignals, isCalendarOnly } from './planning-calendar-signals';
import { parseDayCountFromText } from '@/lib/parse-chinese-duration';
import { parseTravelDateRangeFromText } from './parse-travel-date-range';
import { localizedCountryReference, normalizeCountryReference } from './destination-country-normalize';
import { categorySwitchSearchText, cityOnlyAnswerDestination, isCategoryActivityLabel, isCategoryNonDestinationLabel, isNonPlaceDestinationText, isKnownCountryLabel, isKnownDestinationLabel, isKnownTouristCityLabel, normalizeDestinationLabel, sameHanPlaceVariant, stripTravelWishSuffix } from './trip-planning-context';
import { isResolvedDestination } from '@/lib/location/destination-authority';
import { applyCityLocaleAlias, canonicalFromDisplayName } from './destination-locale-aliases';
import { stripTravelDateRangeFromText } from './parse-travel-date-range';
import { resolveDestinationScopeFields } from './destination-scope';
import { listNearbyRegionVocabulary } from './region-adjacency';
import { parseTravelMonthFromText, resetForDestinationChange } from './trip-planning-session-reset';
import { isRejectAllCombinationsReply, isUserAllOrAutoCombinationReply } from './destination-combination-suggestions';
import { midMonthIsoDate } from './resolve-suggested-trip-dates';
import { isValidItineraryDayCount } from './itinerary-days';
import { isTripLengthOnlyCombinationReply } from './combination-partial-modify-reply';
import type { TripLocation } from '@/lib/location/types';

export function globalPlanningTurn(session: ChatPlanningSession, text: string): CanonicalTravelContext | undefined {
  const turn = globalPlanningTurnOnce(session, text);
  // The re-ask mark (destinationInputNames []) is never cleared on the caller's session (a legacy turn carries it);
  // a global turn still without destination / candidate re-asks the city, so the mark is set again on the returned copy.
  const names = session.travelContext?.destinationInputNames;
  if (turn && Array.isArray(names) && !names.length && !turn.destination && !turn.destinationCandidate
    && !turn.destinationClarification && !turn.destinationInputNames?.length) return {...turn, destinationInputNames: []};
  return turn;
}
function globalPlanningTurnOnce(session: ChatPlanningSession, text: string): CanonicalTravelContext | undefined {
  if (nearbyLanguageSignal(text)) return;
  // 「mix and match」「全部都不要」while choosing combinations: a mix / select-all / reject-all reply,
  // never destination names (the combination flow handles it).
  if (session.pendingQuestion?.type === 'combination_choice' && (isUserAllOrAutoCombinationReply(text) || isRejectAllCombinationsReply(text))) return;
  const prevContext = session.travelContext ?? {interests:[]};
  // destinationInputNames [] marks the city re-asked after 「不是」 dropped the candidate (below): this
  // turn's bare single name (「那霸」"Naha"「나하」) is the answer (one geocode); the mark is used once.
  const reasked = Array.isArray(prevContext.destinationInputNames) && !prevContext.destinationInputNames.length
    && !prevContext.destination && !prevContext.destinationCandidate && isReaskedCityAnswerShape(text);
  const prev = Array.isArray(prevContext.destinationInputNames) && !prevContext.destinationInputNames.length ? {...prevContext,destinationInputNames:undefined} : prevContext;
  const duration = parseDayCountFromText(text);
  const range = parseTravelDateRangeFromText(text);
  const dates = {...planningCalendarSignals(text, new Date(), session.tripDestination?.timezone),...(duration ? {days:duration} : {}),
    ...(range.startDate && range.endDate ? {startDate:range.startDate,endDate:range.endDate,...(range.days ? {days:range.days} : {}),
      // This turn's own date range is a confirmed user date (as combinationSwitchDatePatch).
      suggestedStartDate:undefined,dateProvenance:{source:'user_date' as const,confirmed:true,startDate:range.startDate,endDate:range.endDate}} : {})};
  const active = Boolean(prev.destination || prev.destinationCandidate || prev.destinationClarification);
  const refinement = active && (prev.destinationType === 'country' || (prev.destinationCandidate && prev.destinationCandidate.status !== 'resolved') || prev.destinationClarification);
  // 「Sorry it's 12/10-12/13」 with a destination set: the dated remainder is not a new destination.
  // 「Kyoto 12/10-12/13」 on a Sydney trip is a switch; 「Sydney 12/10-12/13」 or unknown text only changes dates.
  const current = currentDestinationLabels(session);
  const knownOtherDestination = (rest: string) => {
    const label = normalizeDestinationLabel(rest);
    const known = isKnownDestinationLabel(label) || applyCityLocaleAlias(rest) !== rest.trim();
    return known && !current.includes(label);
  };
  // 「Kyoto 12/10-12/13」「switch to Kyoto」「改去京都」「京都に変更」「교토로 바꿔」 while choosing
  // combinations: another locally known destination switches the trip; this turn's dates win,
  // otherwise the previous dates / days are kept. Combinations are offered again for it.
  const switchTo = combinationChoiceSwitchForSession(session, text);
  if (switchTo) {
    const {scope, destination} = switchTo;
    return {...prev,...dates,...combinationSwitchDatePatch(prev, text, dates),
      destinationScopeId:undefined,destinationCoordinates:undefined,weather:null,
      offeredCombinations:undefined,selectedCombinationIds:undefined,
      selectedCombinationPlaceNames:undefined,excludedCombinationPlaceNames:undefined,
      nearbyExtensions:undefined,unresolvedNearbyExtensions:undefined,destinationCities:undefined,destinationDisplay:undefined,
      destination,destinationCountry:scope.destinationCountry,
      destinationCountryCode:normalizeCountryReference(scope.destinationCountry).countryCode,
      destinationType:scope.destinationType,destinationCity:scope.destinationCity,destinationRegion:scope.destinationRegion,
      destinationCandidate:undefined,destinationInputNames:[switchTo.surface],destinationClarification:undefined,
      lastIntent:'trip_planning',tripPurpose:'region_selected'};
  }
  // While choosing combinations (or re-asking a candidate that started there), a geocoded
  // candidate is a combination-choice destination switch once resolved (resolveGlobalPlanningCandidate).
  // A country-level trip (日本 → 京都 / 熱海) keeps the narrowing flow: no switch, dates kept.
  const retriedSwitch = Boolean(prev.destinationCandidate?.combinationSwitch && prev.destinationCandidate.status !== 'resolved');
  const countryLevel = prev.destinationType === 'country';
  const switchStage = isCombinationSwitchStage(session, text);
  const switchTurn = (switchStage && !countryLevel) || retriedSwitch;
  // 「熱海, 日本」"Atami, Japan"「아타미, 일본」 answering the city-and-country confirmation: the city
  // is the candidate, the country its hint (one geocode), never a country destination.
  // 「不是」「いいえ」 on the candidate confirmation drops the candidate (the city is asked again, nothing is
  // copied into the destination); 「不是京都，是大阪」「いいえ、大阪です」"no, Osaka" names the new candidate.
  const correction = prev.destinationCandidate && prev.destinationCandidate.status !== 'resolved' ? candidateNegationReply(text) : undefined;
  if (correction && !correction.rest) return {...prev,...dates,destinationCandidate:undefined,destinationInputNames:[],destinationClarification:undefined};
  const cityCountry = prev.destinationCandidate && prev.destinationCandidate.status !== 'resolved' && !correction ? cityCountryReply(text) : undefined;
  const correctionNames = correction?.rest ? travelDestinationCandidates(correction.rest) : [];
  // 「不是，我再想想」"no thanks": a rest that names no place is a bare 「不是」 (no candidate, no geocode).
  if (correction && !correctionNames.length && !cityOnlyAnswerDestination(correction.rest)) return {...prev,...dates,destinationCandidate:undefined,destinationInputNames:[],destinationClarification:undefined};
  let names = cityCountry ? [cityCountry.city] : correction?.rest ? (correctionNames.length ? correctionNames : [correction.rest]) : travelDestinationCandidates(text, active && !refinement ? {acceptDatedRemainder: knownOtherDestination} : {});
  const explicitChange = !cityCountry && /^(?:instead|change (?:the )?destination to|switch to|改去|改成|換成|目的地改成)/i.test(text.trim());
  if (explicitChange) { const stripped=text.trim().replace(/^(?:instead(?: of .+?,)?|change (?:the )?destination to|switch to|改去|改成|換成|目的地改成)\s*/i,'').replace(/[.!。]+$/,'');
    // "instead of Sydney, let's switch to Atami": switch wording left in the name is dropped (never geocoded as written).
    const raw = isNonPlaceDestinationText(stripped) ? stripCombinationSwitchWording(stripped) : stripped;
    // 「改去シドニー」 on the Sydney trip names the current destination: the context stays as it is
    // (no candidate, no geocode, no reset).
    if (!refinement && active && withCanonicalLabels(current).includes(normalizeDestinationLabel(canonicalFromDisplayName(raw) ?? raw))) return {...prev};
    if(safeDestinationCandidate(raw) && !isCategoryNonDestinationLabel(raw)) names=[raw]; }
  // 「熱海に変更」「해운대로 바꿔」 while choosing combinations: the ja / ko form of 「改去熱海」"switch to Atami"
  // (same candidate → one geocode path). Known destinations are handled by the local switch above.
  // A country-level trip (日本) reads the same ja / ko switch wording (「海雲台に変更」 → 海雲台), as zh / en 「改去」"switch to".
  const jaKoRaw = cityCountry || explicitChange || !(switchStage || retriedSwitch || countryLevel) ? undefined
    : jaKoSwitchCandidate(text, current, session.pendingQuestion?.baseDestination ?? prev.destination);
  if (jaKoRaw) names = [jaKoRaw];
  // "not sydney anymore, switch to Atami"「シドニーはやめて、熱海に変更」「시드니 말고 해운대로 바꿔」: the
  // negated current destination (any locale spelling) is dropped; the rest is the geocode candidate.
  const negatedRaw = cityCountry || explicitChange || jaKoRaw || !switchTurn ? undefined : negatedCurrentSwitchCandidate(text, current);
  if (negatedRaw) names = [negatedRaw];
  const switchChange = explicitChange || Boolean(jaKoRaw) || Boolean(negatedRaw);
  if (!names.length && (refinement || reasked) && !isCalendarOnly(text) && !parseDayCountFromText(text)) {
    // A negated clause is never part of the candidate (「시드니 말고 해운대로 바꿔」 → 해운대).
    const negated = matchNegatedDestinationClause(text.trim());
    const fallback = negated ? stripCombinationSwitchWording(negated.rest) : text.trim();
    // 「我想泡溫泉」「想去泡湯」 on a country-level trip: a category / activity wish is no place name (no geocode).
    if (fallback && safeDestinationCandidate(fallback) && (!negated || !isCategoryActivityLabel(fallback))
      && !categorySwitchSearchText(fallback)) names = [fallback];
  }
  // Final guard: switch / negation residue, a time word, "a cheaper hotel" or a category / activity
  // (「休息」) is never a destination candidate (no geocode, no reset); a city + country reply keeps its city.
  // 「別府に行きたい」「벳푸에 가고 싶어」: the travel-wish wording is dropped before the guard (the place is kept).
  if (!cityCountry) names = names.map(n => isNonPlaceDestinationText(n) ? stripTravelWishSuffix(n) : n).filter(n => !isNonPlaceDestinationText(n));
  if (names.length > 1) return {...prev,...dates,destinationInputNames:names,destinationClarification:'multiple_destinations',destinationCandidate:undefined};
  if (names.length === 1) {
    const destinationArtifacts: Partial<CanonicalTravelContext> = {
      destinationScopeId:undefined,destinationCoordinates:undefined,weather:null,
      offeredCombinations:undefined,selectedCombinationIds:undefined,
      selectedCombinationPlaceNames:undefined,excludedCombinationPlaceNames:undefined,
    };
    const raw = names[0];
    const country = localizedCountryReference(raw);
    // Existing known-destination flows remain intact. Country refinement must retain dates.
    if (!refinement && isKnownDestinationLabel(normalizeDestinationLabel(raw)) && !country) return;
    if (country) return {...prev,...dates,...destinationArtifacts,destination:country.country,destinationCountry:country.country,destinationCountryCode:country.code,
      destinationType:'country',destinationCity:undefined,destinationRegion:undefined,destinationCoordinates:undefined,
      destinationCandidate:undefined,destinationInputNames:[raw],destinationClarification:undefined,lastIntent:'trip_planning',tripPurpose:'region_selected'};
    // "not Sydney anymore, I want to see the night view": a negated current destination without switch
    // wording (negatedCurrentSwitchCandidate) is no combination-choice switch.
    const combinationSwitch = switchTurn && (Boolean(cityCountry) || retriedSwitch || !negatesCurrentWithoutSwitchWording(text, current));
    // A re-typed name for that candidate keeps its country hint (none after explicit switch wording);
    // 「熱海, 日本」 gives its own.
    const countryHint = cityCountry ? cityCountry.country
      : retriedSwitch ? prev.destinationCandidate?.countryHint
      : switchChange ? undefined : prev.destinationCountry;
    return {...prev,...dates,...(combinationSwitch ? combinationSwitchDatePatch(prev, text, dates) : {}),...destinationArtifacts,
      destinationCandidate:{raw,countryHint,status:'pending',...(combinationSwitch ? {combinationSwitch:true as const} : {}),
        // A bare name (「海雲台」"Springfield") keeps the country-hint conflict confirmation.
        ...(countryLevel && !cityCountry && raw.trim() !== text.trim() ? {countryTrip:true as const} : {}),
        ...(prev.destinationCandidate && prev.destinationCandidate.status !== 'resolved' ? {afterMiss:true as const} : {})},
      destinationInputNames:[raw],destinationClarification:undefined,lastIntent:'trip_planning',tripPurpose:'region_selected'};
  }
  if (/^\d+$/.test(text.trim()) && active && (session.pendingQuestion?.type === 'ask_days' || session.pendingQuestion?.type === 'duration_choice')) {
    const days = Number(text);
    // A length other than the kept range's clears that range (dates and days stay consistent).
    const span = rangeDays(prev.startDate, prev.endDate);
    if (days >= 2 && days <= 365) return {...prev,days,...(span != null && span !== days ? {startDate:undefined,endDate:undefined,suggestedStartDate:undefined,dateProvenance:undefined} : {}),lastIntent:'trip_planning'};
  }
  if (isCalendarOnly(text) || (active && (Object.keys(dates).length || parseDayCountFromText(text)))) {
    // While choosing combinations, a month equal to the typed range's own month (and year) keeps
    // the range, days and provenance; only a different month / year clears them.
    const statedNum = monthNumber(dates.travelMonth);
    const prevStart = prev.startDate?.match(/^(\d{4})-(\d{2})-\d{2}$/);
    const sameAsTripDates = session.pendingQuestion?.type === 'combination_choice' && Boolean(statedNum && prevStart && prev.endDate)
      && Number(prevStart![2]) === statedNum
      && Number(prevStart![1]) === ((dates as {travelYear?: number}).travelYear ?? Number(midMonthIsoDate(statedNum!, new Date()).slice(0, 4)));
    const monthChanged = Boolean(dates.travelMonth && dates.travelMonth !== prev.travelMonth) && !dates.startDate && !sameAsTripDates;
    // Answering the days question (「1」 after narrowing 日本 → 京都) with a length other than the
    // kept range's: the new length wins and the range it contradicts is cleared (never days 1 on 12/10–12/14).
    const answeredDays = parseDayCountFromText(text) ?? (dates as {days?: number}).days;
    const daysQuestion = session.pendingQuestion?.type === 'ask_days' || session.pendingQuestion?.type === 'duration_choice';
    // 「3天」 while choosing combinations (trip length only, never a combination number): same rule.
    const lengthOnlyCombinationReply = session.pendingQuestion?.type === 'combination_choice'
      && Boolean(parseDayCountFromText(text)) && isTripLengthOnlyCombinationReply(text);
    const rangeConflicts = (daysQuestion || lengthOnlyCombinationReply) && !dates.startDate && answeredDays != null && rangeDays(prev.startDate, prev.endDate) != null
      && rangeDays(prev.startDate, prev.endDate) !== answeredDays;
    return {...prev,...dates,...(monthChanged || rangeConflicts ? {startDate:undefined,endDate:undefined,suggestedStartDate:undefined,dateProvenance:undefined} : {}),...(parseDayCountFromText(text) ? {days:parseDayCountFromText(text)} : {}), lastIntent:'trip_planning'};
  }
  if (multilingualTravelIntent(text) && !prev.destination) return {...prev,...dates,days:parseDayCountFromText(text) ?? prev.days,lastIntent:'trip_planning'};
}
/**
 * The combination-choice destination switch globalPlanningTurn applies for this turn (local tables
 * only), or undefined. Shared with isNewTripPlanning so both read the same switch.
 */
export function combinationChoiceSwitchForSession(session: ChatPlanningSession, text: string): {label: string; surface: string; destination: string; scope: ReturnType<typeof resolveDestinationScopeFields>} | undefined {
  const target = combinationChoiceSwitchLabel(session, text);
  if (!target) return undefined;
  const scope = resolveDestinationScopeFields(target.label);
  // The user's own Han spelling (台東) is kept as the label, as the legacy merge does.
  const sameHan = (a: string, b: string) => /^\p{Script=Han}+$/u.test(a) && a.replace(/臺/g, '台') === b.replace(/臺/g, '台');
  const destination = sameHan(target.surface, target.label) || sameHan(target.surface, scope.destinationName) ? target.surface : scope.destinationName;
  return {...target, destination, scope};
}
/**
 * A combination was already picked (「1」: the itinerary is being / has been generated) and no other
 * question is pending: an explicit switch here is the same destination switch as while choosing
 * combinations (one reset, dates kept, combinations listed for the new destination).
 */
function isPostCombinationSelection(session: ChatPlanningSession): boolean {
  const ctx = session.travelContext;
  if (ctx?.destinationType === 'country' || !ctx?.destination?.trim()) return false;
  const pending = session.pendingQuestion?.type;
  // 「找不到組合」後的重新整理推薦（ask_preference）: the same switch as after a pick.
  if (pending === 'ask_preference') return true;
  // Generation failed (the App leaves the retry activity_choice pending): the same switch as after a
  // pick. An ordinary activity_choice (no generation failure) keeps its own behavior.
  const generationFailed = session.chatPlanningState === 'generationFailed' || session.aiItineraryState === 'FAILED';
  if (pending && !POST_SELECTION_PENDING_TYPES.has(pending) && !(pending === 'activity_choice' && generationFailed)) return false;
  return Boolean(ctx.selectedCombinationIds?.length) || hasGeneratedTripState(session);
}
/** Questions asked after a combination was picked (next step / trip style); an explicit switch still switches. */
const POST_SELECTION_PENDING_TYPES = new Set<string>(['itinerary_next_step', 'trip_style_choice']);
/**
 * The itinerary of the current destination was generated (phase done / SUCCESS, the App's
 * trip_created cleanup leaves selectedCombinationIds []), is being generated, or failed.
 * Chat planning state only (saved trips are never read or touched).
 */
function hasGeneratedTripState(session: ChatPlanningSession): boolean {
  const ai = session.aiItineraryState;
  return session.phase === 'done' || session.phase === 'generating' || Boolean(session.lastGeneratedTripId)
    || ai === 'BUILDING_ITINERARY' || ai === 'CREATING_TRIP' || ai === 'SUCCESS' || ai === 'FAILED';
}
/**
 * The confirmed-switch wrapper re-lists combinations (dates kept) for this base: choosing
 * combinations, a candidate re-asked there, or after a combination was picked / the itinerary
 * was generated (isPostCombinationSelection).
 */
export function isCombinationSwitchRelistBase(session: ChatPlanningSession): boolean {
  const candidate = session.travelContext?.destinationCandidate;
  return session.pendingQuestion?.type === 'combination_choice'
    || Boolean(candidate?.combinationSwitch && candidate.status !== 'resolved')
    || isPostCombinationSelection(session);
}
/** Choosing combinations, or an explicit switch after a combination was picked. */
function isCombinationSwitchStage(session: ChatPlanningSession, text: string): boolean {
  return session.pendingQuestion?.type === 'combination_choice'
    || (isPostCombinationSelection(session) && (EXPLICIT_COMBINATION_SWITCH_RE.test(text) || negatesCurrentDestination(session, text)));
}
/**
 * 「熱海不去了，我要去雪梨」"instead of Atami, …"「熱海じゃなくて…」「아타미 대신 …」: a leading clause rejecting
 * the current destination is explicit switch wording too (same rule as combinationChoiceSwitchTarget).
 */
function negatesCurrentDestination(session: ChatPlanningSession, text: string): boolean {
  const plain = stripTravelDateRangeFromText(text).replace(TRAVEL_TIME_WORD_RE, '').replace(/\s{2,}/g, ' ').trim();
  const negated = matchNegatedDestinationClause(plain);
  if (!negated) return false;
  const current = currentDestinationLabels(session);
  return negatedCurrentLabel(negated.negated, [...current, ...current.map(c => normalizeDestinationLabel(canonicalFromDisplayName(c) ?? c))]) != null;
}
function combinationChoiceSwitchLabel(session: ChatPlanningSession, text: string): {label: string; surface: string} | undefined {
  if (!isCombinationSwitchStage(session, text) || nearbyLanguageSignal(text)) return undefined;
  if (isUserAllOrAutoCombinationReply(text) || isRejectAllCombinationsReply(text)) return undefined;
  const prev = session.travelContext ?? {interests:[]};
  const active = Boolean(prev.destination || prev.destinationCandidate || prev.destinationClarification);
  const refinement = active && (prev.destinationType === 'country' || (prev.destinationCandidate && prev.destinationCandidate.status !== 'resolved') || prev.destinationClarification);
  // A country-level trip (日本) narrows to its own cities (京都 / 熱海); only a known city of another
  // country (日本 → 首爾) is a destination switch.
  const countryOnly = prev.destinationType === 'country' && !prev.destinationClarification
    && !(prev.destinationCandidate && prev.destinationCandidate.status !== 'resolved');
  if (refinement && !countryOnly) return undefined;
  const current = currentDestinationLabels(session);
  const pendingBase = session.pendingQuestion?.baseDestination;
  const target = combinationChoiceSwitchTarget(text, [...current, ...(pendingBase ? [normalizeDestinationLabel(pendingBase)] : [])], pendingBase ?? prev.destination);
  if (target && countryOnly) {
    const targetCode = normalizeCountryReference(resolveDestinationScopeFields(target.label).destinationCountry).countryCode;
    const tripCode = normalizeCountryReference(prev.destinationCountry, prev.destinationCountryCode).countryCode;
    if (!targetCode || !tripCode || targetCode === tripCode) return undefined;
  }
  return target;
}

/**
 * The current destination's labels: the active label / city, plus — for a geocoded destination
 * (海雲臺區 / 해운대구 / Haeundae-gu) — the name the user typed (해운대) and the label without its
 * district / city suffix, so 「해운대 말고 시드니로 바꿔」 negates the current destination.
 */
function currentDestinationLabels(session: ChatPlanningSession): string[] {
  const prev = session.travelContext ?? {interests:[]};
  // Only fields naming the current destination count (a destinationCity / typed name left over
  // from a previous destination never blocks switching to that name).
  // The resolved candidate counts only when it is this destination's own: its name is the
  // destination, or it is the name typed for it (input names) while the trip destination is this
  // destination. An old resolved candidate (熱海 on a 雪梨 trip) never reads as current.
  const candidateRaw = prev.destinationCandidate?.status === 'resolved' ? prev.destinationCandidate.raw?.trim() : undefined;
  const tripIsDestination = Boolean(session.tripDestination && prev.destination?.trim()
    && [session.tripDestination.city, session.tripDestination.displayLabel].some(v => namesSamePlace(v, prev.destination)));
  const candidateIsCurrent = Boolean(candidateRaw && (namesSamePlace(candidateRaw, prev.destination)
    || (tripIsDestination && (prev.destinationInputNames ?? []).some(v => v.trim() === candidateRaw))));
  const sameAsDestination = (v: string | undefined) => !prev.destination?.trim() || namesSamePlace(v, prev.destination)
    || (candidateIsCurrent && namesSamePlace(v, candidateRaw));
  const base = [prev.destination, sameAsDestination(prev.destinationCity) ? prev.destinationCity : undefined]
    .filter(Boolean).map(v => normalizeDestinationLabel(v!));
  if (!base.length) return base;
  const trip = session.tripDestination;
  const tripLabels = trip && [trip.city, trip.displayLabel].some(v => v?.trim() && base.includes(normalizeDestinationLabel(v)))
    ? [trip.city, trip.displayLabel] : [];
  const typed = prev.destinationClarification ? [] : (prev.destinationInputNames ?? []).filter(v => sameAsDestination(v)
    || tripLabels.some(t => Boolean(t?.trim()) && namesSamePlace(v, t!)));
  // The name the user typed for this geocoded destination (아타미 → 아타미시).
  const resolvedRaw = candidateIsCurrent && candidateRaw ? [candidateRaw] : [];
  const extra = [...tripLabels, ...typed, ...resolvedRaw].filter((v): v is string => Boolean(v?.trim())).map(v => normalizeDestinationLabel(v));
  const DISTRICT_SUFFIX_RE = /(?<=\p{Script=Han}{2,})(?:區|区)$|(?<=\p{Script=Hangul}{2,})(?:구|군|시)$|-(?:gu|gun|si)$|\s+(?:district|ward)$/iu;
  const stripped = [...base, ...extra].map(v => v.replace(DISTRICT_SUFFIX_RE, '')).filter(Boolean);
  const all = [...base, ...extra, ...stripped];
  return [...new Set([...all, ...all.map(v => v.toLowerCase())])];
}

/** District / city suffix of a geocoded label (海雲臺區 / 해운대구 / 아타미시 / Haeundae-gu), comparison only. */
const SAME_PLACE_SUFFIX_RE = /(?<=\p{Script=Han}{2,})(?:區|区|市)$|(?<=\p{Script=Hangul}{2,})(?:구|군|시)$|-(?:gu|gun|si|shi)$|\s+(?:district|ward|city)$/iu;
/** Comparison forms of a name: normalized, locale-alias canonical, suffix stripped, 臺／台 区／區 folded. */
function samePlaceForms(value: string): string[] {
  const v = value.trim();
  if (!v) return [];
  const labels = [normalizeDestinationLabel(v), normalizeDestinationLabel(canonicalFromDisplayName(v) ?? v),
    normalizeDestinationLabel(applyCityLocaleAlias(v))].map(l => l.toLowerCase());
  const fold = (l: string) => l.replace(/臺/g, '台').replace(/區/g, '区');
  return [...new Set([...labels, ...labels.map(l => l.replace(SAME_PLACE_SUFFIX_RE, ''))].map(fold).filter(Boolean))];
}
/** Two names of the same destination (any locale spelling / script variant / district suffix); never a substring match. */
function namesSamePlace(a: string | undefined, b: string | undefined): boolean {
  if (!a?.trim() || !b?.trim()) return false;
  const right = samePlaceForms(b);
  return samePlaceForms(a).some(f => right.includes(f));
}

/** Inclusive day count of an ISO start / end range, or undefined. */
const rangeDays = (start?: string, end?: string) => {
  if (!start || !end || !/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) return undefined;
  const n = Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000) + 1;
  return Number.isFinite(n) && n > 0 ? n : undefined;
};
const monthNumber = (month?: string | null) => { const n = Number(month?.match(/\d{1,2}/)?.[0]); return n >= 1 && n <= 12 ? n : undefined; };

/**
 * Spec A dates for a combination-choice destination switch (both the global switch and the
 * route's confirmed-switch wrapper):
 * - this turn's date range wins (user dates, confirmed);
 * - a month only that differs from the current trip's month (start date's month / year when the
 *   trip has dates, else its travelMonth): old start / end dates cleared, days kept, travelYear
 *   recomputed for the stated month;
 * - otherwise the previous start / end / days are carried together with their date provenance
 *   exactly as it was (never upgraded to a confirmed user date).
 */
export function combinationSwitchDatePatch(prev: CanonicalTravelContext, text: string,
  dates: {startDate?: string; endDate?: string; days?: number; travelMonth?: string; travelYear?: number} = {}, now = new Date()): Partial<CanonicalTravelContext> {
  if (dates.startDate && dates.endDate) {
    return {startDate:dates.startDate,endDate:dates.endDate,suggestedStartDate:undefined,
      dateProvenance:{source:'user_date',confirmed:true,startDate:dates.startDate,endDate:dates.endDate}};
  }
  const statedMonth = dates.travelMonth ?? (new RegExp(TRAVEL_TIME_WORD_RE.source, 'iu').test(text) ? parseTravelMonthFromText(text, now) : undefined);
  const statedNum = monthNumber(statedMonth);
  if (statedMonth && statedNum) {
    const statedYear = dates.travelYear ?? Number(midMonthIsoDate(statedNum, now).slice(0, 4));
    const prevStart = prev.startDate?.match(/^(\d{4})-(\d{2})-\d{2}$/);
    const differs = prevStart
      ? Number(prevStart[2]) !== statedNum || Number(prevStart[1]) !== statedYear
      : statedMonth !== prev.travelMonth || (prev.travelYear != null && dates.travelYear != null && prev.travelYear !== dates.travelYear);
    if (differs) {
      return {travelMonth:statedMonth,travelYear:statedYear,startDate:undefined,endDate:undefined,suggestedStartDate:undefined,dateProvenance:undefined};
    }
  }
  if (prev.startDate && prev.endDate) {
    // The dates keep their own confirmation state: provenance carried as it is (undefined stays
    // undefined); only this turn's own date range (above) is a confirmed user date.
    return {startDate:prev.startDate,endDate:prev.endDate,dateProvenance:prev.dateProvenance};
  }
  return {};
}

/** True when applyGlobalPlanningContext(session, context) takes the combination-choice destination switch (a destination reset). */
export function isCombinationDestinationSwitchContext(session: ChatPlanningSession, context: CanonicalTravelContext): boolean {
  return (session.pendingQuestion?.type === 'combination_choice' || isPostCombinationSelection(session)) && !context.destinationCandidate
    && !context.destinationClarification && context.destinationType !== 'country' && Boolean(context.destination)
    && normalizeDestinationLabel(context.destination!) !== normalizeDestinationLabel(session.travelContext?.destination ?? '');
}

/** Combination-choice switch target (local tables only): the whole sentence, minus dates and switch wording, is one known non-country destination not in `current`. */
function combinationChoiceSwitchTarget(text: string, currentLabels: string[], primary: string | undefined): {label: string; surface: string} | undefined {
  // 「시드니」 from a ko geocode and 「雪梨」 are the same destination.
  const current = [...currentLabels, ...currentLabels.map(c => normalizeDestinationLabel(canonicalFromDisplayName(c) ?? c))];
  // A nearby extension of the current destination (東京 → 鎌倉 / Kamakura / 가마쿠라) keeps the
  // existing nearby-extension behavior; only explicit switch wording (「改去鎌倉」"switch to Kamakura") switches.
  // Region Adjacency graph only (same data as parseNearbyExtensionsFromText, without its generic
  // fallback list, which also names unrelated cities such as 京都 for a Sydney trip).
  const labelOf = (s: string) => normalizeDestinationLabel(canonicalFromDisplayName(s) ?? s);
  const plain = stripTravelDateRangeFromText(text).replace(TRAVEL_TIME_WORD_RE, '').replace(/\s{2,}/g, ' ').trim();
  // 「雪梨不去了，我要去京都」"Not Sydney anymore, switch to Kyoto"「シドニーはやめて、京都に変更」
  // 「시드니 말고 교토로 바꿔」: a leading negated clause naming a destination is dropped; the rest
  // must still be only the new destination (plus switch wording), never the negated one.
  const negated = matchNegatedDestinationClause(plain);
  const negatedLabel = negated && (negatedCurrentLabel(negated.negated, current) ?? ((isKnownDestinationLabel(labelOf(negated.negated))
    || applyCityLocaleAlias(negated.negated) !== negated.negated) ? labelOf(negated.negated) : undefined));
  // 「海じゃなくて箱根に変更」「不去海邊了，改去箱根」「바다 말고 해운대로」: a negated category / activity
  // (海・beach・바다) is not a destination either; the rest is read the same way.
  const negatedCategory = Boolean(negated && !negatedLabel && isCategoryActivityLabel(negated.negated));
  const source = (negatedLabel || negatedCategory) && negated ? negated.rest : plain;
  // Rejecting the current destination is explicit switch wording too (nearby cities switch).
  const explicit = EXPLICIT_COMBINATION_SWITCH_RE.test(text) || Boolean(negatedLabel && current.includes(negatedLabel));
  const nearby = !explicit && primary ? listNearbyRegionVocabulary(normalizeDestinationLabel(primary)) : [];
  const isNearby = (label: string, surface: string) => nearby.some(v =>
    normalizeDestinationLabel(canonicalFromDisplayName(v) ?? v) === label || v.toLowerCase() === surface.toLowerCase());
  const known = (raw: string | undefined): {label: string; surface: string} | undefined => {
    const s = raw?.trim();
    if (!s || s.length > 40 || /\d/.test(s)) return undefined;
    const label = normalizeDestinationLabel(canonicalFromDisplayName(s) ?? s);
    if (!isKnownDestinationLabel(label) || (isKnownCountryLabel(label) && !isKnownTouristCityLabel(label))) return undefined;
    // 「十分」 alone is also "enough" (ja 十分 / zh 十分), never a switch on its own.
    if (label === '十分') return undefined;
    if (current.includes(label) || label === negatedLabel) return undefined;
    if (isNearby(label, s)) return undefined;
    return {label, surface: s};
  };
  const body = stripCombinationSwitchWording(source);
  const bare = body.replace(/(?<=[\p{Script=Han}\p{Script=Katakana}])(?:に|へ|で)$|(?<=\p{Script=Hangul})(?:으로|로|에)$/u, '').trim();
  return known(body) ?? known(bare);
}

/** Explicit switch wording (zh / en / ja / ko); 「我要去X」"I'm going to X" alone is not. */
const EXPLICIT_COMBINATION_SWITCH_RE =
  /改去|改成去|換成|换成|換去|换去|換到|换到|改到|改成|改為|改为|目的地|\b(?:switch|change|swap)\b[^.?!]*\bto\b|\binstead\b|(?:に|へ)\s*(?:変更|変え|かえ)|に\s*(?:して|しよう|しましょう)|に\s*する(?:[\s.!?。！？~～]|$)|(?:으로|로)\s*(?:바꿔|바꿀|바꾸|변경|하자|할게|할래|해\s*주|해줘|합시다)/i;

/**
 * Sentence-initial negated destination clause (zh / en / ja / ko) and the wording after it; the
 * caller decides whether the negated wording names a destination. Lexical only.
 */
const NEGATED_DESTINATION_CLAUSE_RES: RegExp[] = [
  /^(?:我們|我们|那我|那就|我|那)?(?:不去|不要去|不想去|別去|别去)([^\s，,、。了]{1,24}?)了?[，,、。\s]+/,
  /^([^\s，,、。]{1,24}?)(?:就)?(?:不去|不要去|不想去|不要)了?[，,、。\s]+/,
  /^(?:not|no\s+more|skip|forget(?:\s+about)?|instead\s+of|rather\s+than)\s+([A-Za-z][A-Za-z .'-]{0,40}?)(?:\s+(?:anymore|any\s+more))?(?:\s*[,;.!]\s*|\s+(?:and|but)\s+)/i,
  // "not 雪梨 anymore, switch to Kyoto": the same English clause around a Han / kana / Hangul name.
  /^(?:not|no\s+more|skip|forget(?:\s+about)?|instead\s+of|rather\s+than)\s+([\p{Script=Han}\p{Script=Katakana}\p{Script=Hangul}ー]{1,24})(?:\s+(?:anymore|any\s+more))?(?:\s*[,;.!]\s*|\s+(?:and|but)\s+)/iu,
  /^([^\s、,，。]{1,24}?)(?:は|を)?(?:やめて|やめます|やめる|やめた|やめにして|じゃなくて|じゃなく|ではなくて|ではなく)[、,，。\s]*/,
  /^([^\s,，。]{1,24}?)(?:은|는|을|를)?\s*(?:말고|대신에?|빼고|안\s*(?:가고|갈래요?|갈게요?)|취소하고)[,，\s]*/,
];
/**
 * The current-destination label a negated clause names (locale canonical / alias form, or the same Han
 * name up to 臺／台 via sameHanPlaceVariant: 「不去海雲臺了」 on 海雲台), or undefined.
 */
function negatedCurrentLabel(negated: string, current: string[]): string | undefined {
  const forms = [normalizeDestinationLabel(canonicalFromDisplayName(negated) ?? negated), normalizeDestinationLabel(applyCityLocaleAlias(negated))];
  return forms.find(f => current.includes(f)) ?? current.find(c => sameHanPlaceVariant(c, negated));
}
function matchNegatedDestinationClause(text: string): {negated: string; rest: string} | undefined {
  for (const re of NEGATED_DESTINATION_CLAUSE_RES) {
    const m = text.match(re);
    const negated = m?.[1]?.trim();
    const rest = m ? text.slice(m[0].length).trim() : '';
    if (negated && rest) return {negated, rest};
  }
  return undefined;
}

/** Month / relative-month words around the name (「我下個月要去台東」「12月に京都に行きます」「다음 달에」"next month"). */
const TRAVEL_TIME_WORD_RE =
  /下下?個月|下下?个月|這個月|这个月|本月|明年|今年|後年|后年|再?来月|今月|来年|(?:\d{1,2}|十二|十一|十|[一二三四五六七八九])\s*月(?:份|初|中旬|上旬|下旬|中|底)?(?:に|の)?|다음\s*달(?:에)?|이번\s*달(?:에)?|내년(?:에)?|올해|\d{1,2}\s*월(?:에)?|\b(?:in\s+)?(?:next|this)\s+(?:month|year)\b|\b(?:in\s+)?(?:january|february|march|april|may|june|july|august|september|october|november|december)\b/giu;

const PUNCT_EDGE_RE = /^[\s.,!?、。，！？~～]+|[\s.,!?、。，！？~～]+$/gu;

/** Switch / travel wording around a destination name (zh / en / ja / ko); never touches the name itself. */
function stripCombinationSwitchWording(text: string): string {
  return text.replace(PUNCT_EDGE_RE, '')
    .replace(/^(?:(?:ok(?:ay)?|actually|sorry|oh|hmm|wait|no|then|well|fine|good|great|nice|sure|yes|yeah|alright|but)\b[\s,!.]*)+/i, '')
    .replace(/^(?:(?:i['’]m|i am|we['’]re|we are)\s+(?:going|travell?ing|heading)\s+to|(?:i|we)\s+(?:want|would\s+like|['’]d\s+like)\s+to\s+go\s+to|let['’]?s\s+go\s+to|let['’]?s\s+(?:do|go\s+with|try|pick)|let['’]?s\s+(?:switch|change|swap)(?:\s+(?:it|the\s+destination|destination|the\s+trip|trip|plans?))?\s+to|go\s+with|(?:please\s+)?(?:switch|change|swap)(?:\s+(?:it|the\s+destination|destination|the\s+trip|trip|plans?))?\s+to|how\s+about|what\s+about|make\s+it|go(?:ing)?\s+to)\s+/i, '')
    .replace(/\s+(?:instead|please|then)$/i, '')
    // 「可以但換成台東」「都不錯，不過改去台東」: agreement + contrast before the switch.
    .replace(/^(?:都不錯|不錯|都可以|可以|都很好|很好|都好|好的|好啊|好|沒問題|没问题|行)?[，,\s]*(?:但是|但|不過|不过|可是)[，,\s]*/, '')
    .replace(/^(?:那|那就|那我|我們|我们|我|還是|还是|其實|其实|抱歉|不好意思)*(?:要|想)?(?:改去|改成去|換成去|换成去|換去|换去|換到|换到|改到|改成|改為|改为|換成|换成|目的地(?:改成|換成|换成|改為|改为)|去)/, '')
    .replace(/(?:吧|好了|了|啦|呢|旅行|旅遊|旅游|玩)+$/, '')
    .replace(/^(?:(?:(?:いい|良い|よい)(?:です)?(?:けど|けれど|が)|でも|けど|やっぱり|じゃあ|すみません|ごめんなさい)[、,\s]*)+/, '')
    .replace(/(?:に|へ)\s*(?:変更|変え|かえ)(?:て|して)?(?:ください|下さい|ほしい|欲しい|ます|たい)?$/, '')
    .replace(/に\s*(?:して|しよう|しましょう|します|する)(?:ください|下さい)?$/, '')
    .replace(/(?:に|へ)\s*(?:行きます|行きたい|行く|旅行(?:します|したい)?)$/, '')
    .replace(/(?:で|に)\s*お願いします$/, '')
    .replace(/^(?:그럼|아니|죄송해요|죄송합니다|사실|좋은데|좋긴\s*한데|좋지만|괜찮은데|근데|그런데|하지만)[,\s]*/, '')
    .replace(/(?:으로|로)\s*(?:바꿔|바꿀|바꾸|변경)[가-힣\s]*$/, '')
    .replace(/(?:으로|로)\s*(?:하자|할게요?|할래요?|해\s*주세요|해\s*줘|해요|합시다)$/, '')
    .replace(/(?:에|으로|로)\s*(?:갈래|갈게|가요|가고\s*싶)[가-힣\s]*$/, '')
    .replace(/\s*여행[가-힣\s]*$/, '')
    .replace(PUNCT_EDGE_RE, '')
    .trim();
}

/** ja / ko switch wording at the end of the sentence (「Xに変更」「Xに変えて」「Xにして」「Xに行きます」「X로 바꿔」「X(으)로 갈게요」「X로 하자」). */
const JA_KO_SWITCH_SUFFIX_RE =
  /(?:(?:に|へ)\s*(?:変更|変え|かえ)(?:て|して)?(?:ください|下さい|ほしい|欲しい|ます|たい)?|に\s*(?:して|しよう|しましょう|します|する)(?:ください|下さい)?|(?:に|へ)\s*行きます|(?:으로|로)\s*(?:바꿔|바꿀|바꾸|변경)[가-힣\s]*|(?:으로|로)\s*(?:하자|할게요?|합시다)|(?:으로|로)\s*갈게요?)[\s.!?。！？~～]*$/u;
/** Not a place: hold / mix / keep / all, hotel, ko date / day / "another place" wording, or a leftover negated clause. */
const JA_KO_NON_PLACE_RE =
  /말고|대신|빼고|취소|じゃな|ではな|やめ|ホテル|호텔|숙소|そのまま|このまま|今のまま|保留|キープ|ミックス|全部|すべて|おまかせ|お任せ|日付|日程|日数|別の|그대로|유지|보류|믹스|섞|전부|모두|알아서|날짜|날|일정|하루|이틀|사흘|나흘|닷새|다른|곳|\b(?:mix|hold|keep|all)\b/iu;
/** Candidate for 「熱海に変更」「해운대로 바꿔」 (switch wording, particles, dates removed), or undefined. */
function jaKoSwitchCandidate(text: string, currentLabels: string[], primary: string | undefined): string | undefined {
  const plain = stripTravelDateRangeFromText(text).replace(TRAVEL_TIME_WORD_RE, '').replace(/\s{2,}/g, ' ').trim();
  if (!JA_KO_SWITCH_SUFFIX_RE.test(plain)) return undefined;
  // 「シドニー」「시드니」 from a geocode and 「雪梨」 are the same current destination.
  const current = withCanonicalLabels(currentLabels);
  // 「海じゃなくて熱海に変更」「시드니 말고 해운대로 바꿔」: only a negated category or the current destination is dropped.
  const negated = matchNegatedDestinationClause(plain);
  const labelOf = (s: string) => normalizeDestinationLabel(canonicalFromDisplayName(s) ?? s);
  if (negated && !isCategoryActivityLabel(negated.negated) && !current.includes(labelOf(negated.negated)) && !negatedCurrentLabel(negated.negated, current)) return undefined;
  const source = negated ? negated.rest : plain;
  if (JA_KO_NON_PLACE_RE.test(source)) return undefined;
  const body = stripCombinationSwitchWording(source);
  if (!body || !safeDestinationCandidate(body) || /\p{Script=Hiragana}/u.test(body)) return undefined;
  if (isCategoryNonDestinationLabel(body) || isCategoryActivityLabel(body) || parseDayCountFromText(body)) return undefined;
  const label = labelOf(body);
  // Countries keep their current behavior (short ja / ko names the Intl region list lacks included).
  if (current.includes(label) || localizedCountryReference(body) || normalizeCountryReference(body).countryCode
    || /^(?:アメリカ|米国|イギリス|英国|豪州|한국|남한|미국|영국|호주)$/u.test(body)
    || (isKnownCountryLabel(label) && !isKnownTouristCityLabel(label))) return undefined;
  // 「箱根に行きます」on a Tokyo trip stays a nearby extension; only explicit switch wording switches.
  if (!EXPLICIT_COMBINATION_SWITCH_RE.test(text) && primary && listNearbyRegionVocabulary(normalizeDestinationLabel(primary))
    .some(v => labelOf(v) === label || v.toLowerCase() === body.toLowerCase())) return undefined;
  return body;
}

/** Labels plus their canonical forms (「シドニー」「시드니」"Sydney" → 雪梨), for comparing the current destination in any locale. */
function withCanonicalLabels(labels: string[]): string[] {
  return [...labels, ...labels.map(c => normalizeDestinationLabel(canonicalFromDisplayName(c) ?? c)),
    ...labels.map(c => normalizeDestinationLabel(applyCityLocaleAlias(c)))];
}

/**
 * "not sydney anymore, switch to Atami"「シドニーはやめて、熱海に変更」「시드니 말고 해운대로 바꿔」 while
 * choosing combinations: a leading clause negating the current destination (any locale spelling),
 * then one place name — that name (the geocode candidate), or undefined. Lexical only.
 */
/** Switch / go-to wording after a negated clause ("switch to X"「Xに変更」「X로 바꿔」「X로 갈래」"I'm going to X"). */
function hasNegatedRestSwitchWording(rest: string): boolean {
  return EXPLICIT_COMBINATION_SWITCH_RE.test(rest) || JA_KO_SWITCH_SUFFIX_RE.test(rest)
    // "I want to go to the beach": go-to wording before a category is no switch.
    || (NEGATED_REST_GO_TO_RE.test(rest) && !isCategoryActivityLabel(stripCombinationSwitchWording(rest)))
    || /(?:으로|로)\s*갈래요?[\s.!?。！？~～]*$/u.test(rest);
}
/**
 * True when a leading negated clause names the current destination (any locale spelling / 臺台 variant)
 * and no switch wording follows it ("not Sydney anymore, I want to see the night view").
 */
function negatesCurrentWithoutSwitchWording(text: string, currentLabels: string[]): boolean {
  const plain = stripTravelDateRangeFromText(text).replace(TRAVEL_TIME_WORD_RE, '').replace(/\s{2,}/g, ' ').trim();
  const negated = matchNegatedDestinationClause(plain);
  if (!negated || hasNegatedRestSwitchWording(negated.rest)) return false;
  const current = withCanonicalLabels(currentLabels);
  return current.includes(normalizeDestinationLabel(canonicalFromDisplayName(negated.negated) ?? negated.negated))
    || current.includes(normalizeDestinationLabel(applyCityLocaleAlias(negated.negated)))
    || Boolean(negatedCurrentLabel(negated.negated, current));
}
/** en go-to wording before a name after a negated clause ("I'm going to Atami", "let's go to Atami"). */
const NEGATED_REST_GO_TO_RE =
  /^(?:(?:ok(?:ay)?|actually|then|so|but|and)\b[\s,]*)*(?:(?:i['’]m|i am|we['’]re|we are)\s+(?:going|heading|travell?ing)\s+to|(?:i|we)\s+(?:want|would\s+like|['’]d\s+like)\s+to\s+go\s+to|let['’]?s\s+go\s+to|go(?:ing)?\s+to|how\s+about|what\s+about|make\s+it)\s+\S/i;
function negatedCurrentSwitchCandidate(text: string, currentLabels: string[]): string | undefined {
  const plain = stripTravelDateRangeFromText(text).replace(TRAVEL_TIME_WORD_RE, '').replace(/\s{2,}/g, ' ').trim();
  const negated = matchNegatedDestinationClause(plain);
  if (!negated) return undefined;
  const current = withCanonicalLabels(currentLabels);
  const labelOf = (s: string) => normalizeDestinationLabel(canonicalFromDisplayName(s) ?? s);
  const negatedLabels = [labelOf(negated.negated), normalizeDestinationLabel(applyCityLocaleAlias(negated.negated))];
  if (!negatedLabels.some(l => current.includes(l)) && !negatedCurrentLabel(negated.negated, current)) return undefined;
  if (JA_KO_NON_PLACE_RE.test(negated.rest)) return undefined;
  // Only explicit switch / go-to wording around a name ("switch to Atami"「熱海に変更」「해운대로 바꿔」);
  // "I want to go surfing"「サーフィンに行きたい」「쉬고 싶어」 are activities, never a candidate.
  if (!hasNegatedRestSwitchWording(negated.rest)) return undefined;
  const body = stripCombinationSwitchWording(negated.rest);
  if (!body || !safeDestinationCandidate(body) || /\p{Script=Hiragana}/u.test(body)) return undefined;
  // The name is a noun phrase: no en verb / gerund wording, no ko 「…하러」「…고 싶어」.
  if (/^[a-z]+ing\b/.test(body) || /\b(?:i|we|want|wanna|would|like|go|going|to)\b/i.test(body)
    || /(?:하러|으러|고\s*싶|싶어)/u.test(body)) return undefined;
  if (isCategoryNonDestinationLabel(body) || isCategoryActivityLabel(body) || parseDayCountFromText(body)) return undefined;
  const label = labelOf(body);
  if (current.includes(label) || localizedCountryReference(body) || normalizeCountryReference(body).countryCode
    || (isKnownCountryLabel(label) && !isKnownTouristCityLabel(label))) return undefined;
  return body;
}

/** Short ja / ko country names the Intl region list lacks. */
const SHORT_COUNTRY_CODES: Record<string, string> = {
  アメリカ: 'US', 米国: 'US', イギリス: 'GB', 英国: 'GB', 豪州: 'AU', 한국: 'KR', 남한: 'KR', 미국: 'US', 영국: 'GB', 호주: 'AU',
};
const CANDIDATE_NEGATION_LEAD_RE = /^(?:不是|不要|沒有|没有|不對|不对|いいえ|ううん|いや|아니요|아뇨|아니|(?:nope|nah|no)(?![a-z]))/iu;
/**
 * A reply to the candidate confirmation that starts with a negation: 「不是」「いいえ」"nope" → {rest: ''};
 * 「不是，是大阪」「不是京都，是大阪」「いいえ、大阪です」「아니요, 오사카요」"no, Osaka" → {rest: the new name}.
 * A negation run into a phrase without a separator (「不要去京都」) is no reply here (undefined). Lexical only.
 */
function candidateNegationReply(text: string): {rest: string} | undefined {
  const t = (text ?? '').trim().replace(/[\s.!?。！？~～]+$/u, '');
  const lead = t.match(CANDIDATE_NEGATION_LEAD_RE);
  if (!lead) return undefined;
  const after = t.slice(lead[0].length);
  if (!after.trim()) return {rest: ''};
  const parts = after.split(/[,，、。.!！]\s*/u).map(p => p.trim()).filter(Boolean);
  // 「不是京都，是大阪」: the negated name before the separator is dropped; 「不要去京都」 has no separator.
  if (!/^[\s,，、。.!！]/u.test(after) && parts.length < 2) return undefined;
  const rest = (parts[parts.length - 1] ?? '')
    .replace(/^(?:是|在|改成|改去|it's|it is)\s*/iu, '')
    .replace(/\s*(?:です|だよ|입니다|이요|요|please)$/iu, '')
    .trim();
  return rest && !CANDIDATE_NEGATION_LEAD_RE.test(rest) ? {rest} : undefined;
}
/** A bare single name after the city re-ask: no negation, digits, hesitation (「我再想想」"not yet"「まだ…」「아직…」) or sentence. */
function isReaskedCityAnswerShape(text: string): boolean {
  const t = (text ?? '').trim().replace(/[\s.!?。！？~～]+$/u, '');
  // 「鞆の浦」: の／ノ／ヶ inside a place name are allowed; any other hiragana is a sentence.
  // Latin names are bounded by word count only (below); other scripts keep the 20-character bound.
  if (!t || (t.length > 20 && !/^[\p{Script=Latin}\s.'’-]+$/u.test(t)) || candidateNegationReply(t) || /\p{Script=Hiragana}/u.test(t.replace(/[のノヶ]/gu, '')) || isNonPlaceDestinationText(t)) return false;
  if (/想想|考慮|考虑|不知道|還沒|还没|再說|再说|不用|^我|まだ|未定|아직|몰라|모르|\b(?:later|not|yet|maybe|dunno|thanks?|sure|unsure|undecided|don'?t|know)\b/iu.test(t)) return false;
  // No preference / thanks (「隨便」"surprise me"「おまかせ」「고마워요」): whole reply only, never geocoded.
  if (/^(?:隨便|随便|都可以|都行|你決定|你决定|你推薦|你推荐|anywhere|anything|you choose|surprise me|whatever|아무데나|아무거나|どこでも|おまかせ|お任せ|謝謝|谢谢|thank you|ありがとう|고마워요|감사합니다)(?:啦|吧|喔|囉|です|요)?$/iu.test(t)) return false;
  return /^[\p{Script=Latin}\s.'’-]+$/u.test(t) ? t.split(/\s+/).length <= 5 : !/\s/.test(t);
}
/** 「熱海, 日本」「熱海 日本」"Atami, Japan"「아타미, 일본」: city + country hint, or undefined. Lexical only. */
function cityCountryReply(text: string): {city: string; country: string} | undefined {
  const t = (text ?? '').trim().replace(/[.!?。！？~～]+$/u, '').trim();
  const m = t.match(/^(.+?)\s*[,，、]\s*([^,，、]+)$/u) ?? t.match(/^(\S+)\s+(\S+)$/u);
  if (!m) return undefined;
  const city = m[1].trim();
  const countryText = m[2].trim();
  const code = SHORT_COUNTRY_CODES[countryText] ?? localizedCountryReference(countryText)?.code ?? normalizeCountryReference(countryText).countryCode;
  if (!code) return undefined;
  const country = normalizeCountryReference(undefined, code).country ?? localizedCountryReference(countryText)?.country;
  if (!country || !city || /\d/.test(city) || !safeDestinationCandidate(city)) return undefined;
  if (localizedCountryReference(city) || normalizeCountryReference(city).countryCode || SHORT_COUNTRY_CODES[city]) return undefined;
  if (isCategoryNonDestinationLabel(city) || isCategoryActivityLabel(city)) return undefined;
  return {city, country};
}

export function applyGlobalPlanningContext(session: ChatPlanningSession, context: CanonicalTravelContext) {
  const monthChanged = context.travelMonth && context.travelMonth !== session.travelContext?.travelMonth;
  // Combination-choice switch (globalPlanningTurn): the old combination pending gives way to the new
  // destination, exactly as a resolved global candidate (ask_days with the new base destination).
  if (isCombinationDestinationSwitchContext(session, context)) return applyCombinationDestinationSwitch(session, context);
  // 「不是」 dropped the unresolved candidate (no destination): the mirrors never restore that name.
  const prevCandidate = session.travelContext?.destinationCandidate;
  const droppedCandidate = Boolean(prevCandidate && prevCandidate.status !== 'resolved' && !context.destinationCandidate && !context.destination);
  // 「いいえ、大阪です」"no, Osaka": a new candidate replaces the unresolved one; mirrors still holding the
  // replaced name are cleared as above (a different GPS city and lat / lng are kept).
  const replacedName = (v?: string) => Boolean(v?.trim() && prevCandidate && normalizeDestinationLabel(v!) === normalizeDestinationLabel(prevCandidate.raw));
  const replacedCandidate = Boolean(prevCandidate && prevCandidate.status !== 'resolved' && context.destinationCandidate && !replacedName(context.destinationCandidate.raw));
  const nextSession: ChatPlanningSession = {...session,travelContext:context,tripDays:context.days ?? session.tripDays,
    ...(replacedCandidate && replacedName(session.preferredArea) ? {preferredArea:undefined} : {}),
    ...(replacedCandidate && session.tripPlanningContext && replacedName(session.tripPlanningContext.destination) ? {tripPlanningContext:{...session.tripPlanningContext,destination:undefined}} : {}),
    ...(replacedCandidate && replacedName(session.location?.city) ? {location:{...session.location!,city:undefined}} : {}),
    ...(droppedCandidate ? {preferredArea:undefined,tripDestination:undefined,tripPlanningContext:session.tripPlanningContext ? {...session.tripPlanningContext,destination:undefined} : undefined} : {}),
    // The dropped name mirrored into location.city (trip-intent) is cleared too; GPS lat / lng are kept.
    ...(droppedCandidate && session.location?.city && normalizeDestinationLabel(session.location.city) === normalizeDestinationLabel(prevCandidate!.raw) ? {location:{...session.location,city:undefined}} : {}),
    ...(context.destinationCandidate?.status === 'pending' || context.destination !== session.travelContext?.destination ? {tripDestination:undefined} : {}),
    ...(context.destinationType === 'country' && context.destination !== session.travelContext?.destination ? {pendingQuestion:undefined,lastResolvedPendingQuestion:undefined,preferredArea:context.destination,tripPlanningContext:session.tripPlanningContext ? {...session.tripPlanningContext,destination:context.destination} : undefined} : {}),
    ...(monthChanged || (session.travelContext?.startDate && !context.startDate) ? {tripStartDate:context.startDate,tripEndDate:context.endDate,travelDate:context.startDate} : {})};
  if (context.destinationClarification || (context.destinationCandidate && context.destinationCandidate.status !== 'resolved')) return {context,session:nextSession};
  return finalizePlanningContextAuthority({before:session,context,session:nextSession});
}
/**
 * Combination-choice destination switch: the same destination-change reset as the legacy switch
 * (new planningSessionId, Planner / scope cleanup, old combinations / places / pending dropped, so
 * an older async result can never write into the new destination); then this turn's dates — or
 * the previous ones — are carried back onto the new session.
 */
const SWITCH_CLEARED_CONTEXT_KEYS = new Set([
  'selectionSource','generationRequestId','lastItineraryFailure','partiallyResolvedPlaces','failedCombinationIds',
  'mustVisitGenerated','planningStage','conversationState','selectedPlanMode','planningTripStyle','selectedTripStyle',
  'generatedItinerary','draftTrip','currentDayPlan','weatherContext','candidatePools','regionExpansionCache',
  'placeResolutionCache','dailyClusters','coverageReport','combinationSelectionState','aiItineraryState',
]);
/** Carried onto the new destination by the switch itself (dates / days per spec A, the new destination). */
const SWITCH_CARRIED_CONTEXT_KEYS = new Set([
  'days','travelMonth','travelYear','startDate','endDate','suggestedStartDate','dateProvenance',
  'destination','destinationCountry','destinationCountryCode','destinationCity','destinationRegion','destinationType',
  'destinationInputNames','lastIntent','tripPurpose','interests',
]);
function applyCombinationDestinationSwitch(session: ChatPlanningSession, context: CanonicalTravelContext) {
  const prevCode = normalizeCountryReference(session.travelContext?.destinationCountry, session.travelContext?.destinationCountryCode).countryCode;
  const nextCode = context.destinationCountryCode ?? normalizeCountryReference(context.destinationCountry).countryCode;
  const reset = resetForDestinationChange(session, {
    reason: prevCode && prevCode === nextCode ? 'city_changed' : 'destination_changed',
    incomingDestination: context.destination,
    incomingTravelMonth: context.travelMonth,
  });
  // The new destination's context from globalPlanningTurn (dates / days carried), minus the old
  // trip's planning artifacts the reset clears; old-trip fields the legacy reset drops (mood, vibe,
  // budget, pace, currentLocation …) are dropped here too, so both paths keep the same fields.
  const kept = reset.travelContext ?? {interests: []};
  const travelContext = Object.fromEntries(Object.entries(context).filter(([key]) => !SWITCH_CLEARED_CONTEXT_KEYS.has(key)
    && (SWITCH_CARRIED_CONTEXT_KEYS.has(key) || (kept as Record<string, unknown>)[key] !== undefined))) as CanonicalTravelContext;
  // The previous destination's city never stays on the new destination (雪梨 with destinationCity 熱海).
  if (travelContext.destinationCity?.trim() && context.destination?.trim() && !namesSamePlace(travelContext.destinationCity, context.destination)) {
    travelContext.destinationCity = resolveDestinationScopeFields(context.destination).destinationCity;
  }
  const nextSession: ChatPlanningSession = {...reset,travelContext,
    // The previous destination's generation (crashed mid-way) never stays on the new destination.
    ...(reset.phase === 'generating' ? {phase:'discover' as const} : {}),
    tripDays:context.days,travelDate:context.startDate,tripStartDate:context.startDate,tripEndDate:context.endDate,
    preferredArea:context.destination,
    tripPlanningContext:reset.tripPlanningContext ? {...reset.tripPlanningContext,destination:context.destination!,
      travelMonth:context.travelMonth,startDate:context.startDate,endDate:context.endDate,days:context.days} : undefined};
  return finalizePlanningContextAuthority({before:session,context:travelContext,session:nextSession});
}
/** One attempt per submitted candidate; never on renders, date answers, or a restored failed candidate. */
export function isGlobalResolutionCurrent(expectedEpoch: number, currentEpoch: number,
  before: ChatPlanningSession, current: ChatPlanningSession): boolean {
  return expectedEpoch === currentEpoch && before === current;
}
export type GlobalResolutionResponse = null | undefined | { location: TripLocation | null; rawResultCount: number };
export async function resolveGlobalPlanningCandidate(session: ChatPlanningSession, locale: string,
  resolve: (query: string) => Promise<GlobalResolutionResponse>, timeoutMs = 10_000): Promise<ChatPlanningSession> {
  const ctx = session.travelContext;
  const candidate = ctx?.destinationCandidate;
  if (!ctx || !candidate || candidate.status !== 'pending') return session;
  let location: TripLocation | null | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const response = await Promise.race([
      resolve([candidate.raw,candidate.countryHint].filter(Boolean).join(', ')),
      new Promise<undefined>(done => { timer = setTimeout(() => done(undefined), timeoutMs); }),
    ]);
    location = response?.rawResultCount === 1 ? response.location : undefined;
  } catch { /* Explicit resubmission can retry through the existing provider guard. */ }
  finally { if (timer) clearTimeout(timer); }
  // A country-level hit (city fell back to the country name, no region) is not a city destination,
  // unless the user typed that very name (city-states such as Singapore).
  const countryKey = (v?: string | null) => { const n = normalizeCountryReference(v); return (n.countryCode ?? n.country ?? '').toLowerCase(); };
  const countryLevel = Boolean(location && !location.region?.trim() && location.city?.trim()
    && countryKey(location.city) === countryKey(location.country) && countryKey(candidate.raw) !== countryKey(location.country));
  let status: 'resolved' | 'unresolved' | 'conflict' = !countryLevel && isResolvedDestination(location) && Boolean(location.city?.trim() || location.region?.trim()) ? 'resolved' : 'unresolved';
  // Country-level trip (日本): the hint, if any, is the trip's own country, never the user's.
  const tripCode = candidate.countryTrip && ctx.destinationType === 'country'
    ? normalizeCountryReference(ctx.destinationCountry, ctx.destinationCountryCode).countryCode : undefined;
  const actualCode = location ? normalizeCountryReference(location.country).countryCode : undefined;
  const hintFromTrip = !candidate.countryHint || normalizeCountryReference(candidate.countryHint).countryCode === tripCode;
  if (status === 'resolved' && candidate.countryHint && location) {
    const expected = normalizeCountryReference(candidate.countryHint);
    const actual = normalizeCountryReference(location.country);
    if ((expected.countryCode ?? expected.country) !== (actual.countryCode ?? actual.country)) status = 'conflict';
  }
  // A geocode-confirmed city of another country (海雲台 on a 日本 trip): a destination switch
  // (one reset, dates kept, combinations for the new destination), never a narrowing.
  const otherCountrySwitch = Boolean(tripCode && actualCode && actualCode !== tripCode && hintFromTrip && location
    && !countryLevel && isResolvedDestination(location) && (location.city?.trim() || location.region?.trim()));
  if (otherCountrySwitch) status = 'resolved';
  if (status !== 'resolved' || !location) return {...session,travelContext:{...ctx,destinationCandidate:{...candidate,status,locale}}};
  const label = location.city || location.region || location.formattedName;
  const {combinationSwitch, countryTrip: _countryTrip, afterMiss: _afterMiss, ...resolvedCandidate} = candidate;
  if (combinationSwitch || otherCountrySwitch) {
    // Spec A: the same switch as a local combination-choice switch (dates / days / provenance kept,
    // one destination reset, combinations offered again for the new destination), never ask_days.
    const switched = applyCombinationDestinationSwitch(session, {...ctx,destination:label,destinationCountry:location.country,
      destinationCountryCode:normalizeCountryReference(location.country).countryCode,destinationCity:location.city || undefined,
      destinationRegion:location.region,destinationType:location.city ? 'city' : 'region',destinationCandidate:undefined,destinationClarification:undefined});
    const travelContext: CanonicalTravelContext = {...switched.context,destinationCoordinates:{lat:location.lat,lng:location.lng},
      destinationCandidate:{...resolvedCandidate,status:'resolved',locale}};
    return {...switched.session,travelContext,preferredArea:label,
      tripDestination:attachDestinationDisplay(location, location.destinationDisplay ?? ctx.destinationDisplay)};
  }
  // Days / dates already kept (「12/10-12/14 我要去熱海」 missed, then 「熱海, 日本」): not asked again.
  // Narrowing a country-level trip (日本 → 熱海) keeps its days question.
  // A first-turn candidate keeps the existing ask_days pending (answered in the same turn).
  // Narrowing a country-level trip that holds confirmed user dates (日本 12/10–12/14 → 別府): the
  // dates answer the days question; the range's day count is kept as days (no ask_days).
  const provenance = ctx.dateProvenance;
  const confirmedRangeDays = ctx.destinationType === 'country' && provenance?.source === 'user_date' && provenance.confirmed === true
    && provenance.startDate === ctx.startDate && provenance.endDate === ctx.endDate
    ? rangeDays(ctx.startDate, ctx.endDate) : undefined;
  const keptConfirmedDates = isValidItineraryDayCount(confirmedRangeDays);
  const keptDays = keptConfirmedDates || (Boolean(candidate.afterMiss) && ctx.destinationType !== 'country'
    && ((ctx.days ?? 0) >= 1 || rangeDays(ctx.startDate, ctx.endDate) != null));
  return {...session,tripDestination:attachDestinationDisplay(location, location.destinationDisplay ?? ctx.destinationDisplay),preferredArea:label,
    pendingQuestion:keptDays ? undefined : {type:'ask_days',options:[],baseDestination:label,destinationCountry:location.country},
    lastResolvedPendingQuestion:undefined,
    tripPlanningContext:session.tripPlanningContext ? {...session.tripPlanningContext,destination:label} : undefined,
    travelContext:{...ctx,destination:label,destinationCountry:location.country,destinationCountryCode:normalizeCountryReference(location.country).countryCode,
    destinationCity:location.city || undefined,destinationRegion:location.region,destinationType:location.city ? 'city' : 'region',
    ...(keptConfirmedDates ? {days:confirmedRangeDays} : {}),
    destinationCoordinates:{lat:location.lat,lng:location.lng},destinationCandidate:{...candidate,status:'resolved',locale}}};
}
