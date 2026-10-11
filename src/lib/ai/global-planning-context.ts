import { finalizePlanningContextAuthority } from "./planning-context-authority";
import type { ChatPlanningSession } from '@/lib/chat-session';
import type { CanonicalTravelContext } from './travel-context';
import { travelDestinationCandidates, safeDestinationCandidate, multilingualTravelIntent, nearbyLanguageSignal } from './travel-language-signals';
import { planningCalendarSignals, isCalendarOnly } from './planning-calendar-signals';
import { parseDayCountFromText } from '@/lib/parse-chinese-duration';
import { localizedCountryReference, normalizeCountryReference } from './destination-country-normalize';
import { isKnownDestinationLabel, normalizeDestinationLabel } from './trip-planning-context';
import { isResolvedDestination } from '@/lib/location/destination-authority';
import type { TripLocation } from '@/lib/location/types';

export function globalPlanningTurn(session: ChatPlanningSession, text: string): CanonicalTravelContext | undefined {
  if (nearbyLanguageSignal(text)) return;
  const prev = session.travelContext ?? {interests:[]};
  const duration = parseDayCountFromText(text);
  const dates = {...planningCalendarSignals(text, new Date(), session.tripDestination?.timezone),...(duration ? {days:duration} : {})};
  const active = Boolean(prev.destination || prev.destinationCandidate || prev.destinationClarification);
  let names = travelDestinationCandidates(text);
  const explicitChange = /^(?:instead|change (?:the )?destination to|switch to|改去|改成|換成|目的地改成)/i.test(text.trim());
  if (explicitChange) { const raw=text.trim().replace(/^(?:instead(?: of .+?,)?|change (?:the )?destination to|switch to|改去|改成|換成|目的地改成)\s*/i,'').replace(/[.!。]+$/,''); if(safeDestinationCandidate(raw)) names=[raw]; }
  const refinement = active && (prev.destinationType === 'country' || (prev.destinationCandidate && prev.destinationCandidate.status !== 'resolved') || prev.destinationClarification);
  if (!names.length && refinement && safeDestinationCandidate(text.trim()) && !isCalendarOnly(text) && !parseDayCountFromText(text)) names = [text.trim()];
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
    return {...prev,...dates,...destinationArtifacts,destinationCandidate:{raw,countryHint:explicitChange ? undefined : prev.destinationCountry,status:'pending'},
      destinationInputNames:[raw],destinationClarification:undefined,lastIntent:'trip_planning',tripPurpose:'region_selected'};
  }
  if (/^\d+$/.test(text.trim()) && active && (session.pendingQuestion?.type === 'ask_days' || session.pendingQuestion?.type === 'duration_choice')) {
    const days = Number(text);
    if (days >= 2 && days <= 365) return {...prev,days,lastIntent:'trip_planning'};
  }
  if (isCalendarOnly(text) || (active && (Object.keys(dates).length || parseDayCountFromText(text)))) {
    const monthChanged = Boolean(dates.travelMonth && dates.travelMonth !== prev.travelMonth);
    return {...prev,...dates,...(monthChanged ? {startDate:undefined,endDate:undefined,suggestedStartDate:undefined} : {}),...(parseDayCountFromText(text) ? {days:parseDayCountFromText(text)} : {}), lastIntent:'trip_planning'};
  }
  if (multilingualTravelIntent(text) && !prev.destination) return {...prev,...dates,days:parseDayCountFromText(text) ?? prev.days,lastIntent:'trip_planning'};
}
export function applyGlobalPlanningContext(session: ChatPlanningSession, context: CanonicalTravelContext) {
  const monthChanged = context.travelMonth && context.travelMonth !== session.travelContext?.travelMonth;
  const nextSession: ChatPlanningSession = {...session,travelContext:context,tripDays:context.days ?? session.tripDays,
    ...(context.destinationCandidate?.status === 'pending' || context.destination !== session.travelContext?.destination ? {tripDestination:undefined} : {}),
    ...(context.destinationType === 'country' && context.destination !== session.travelContext?.destination ? {pendingQuestion:undefined,lastResolvedPendingQuestion:undefined,preferredArea:context.destination,tripPlanningContext:session.tripPlanningContext ? {...session.tripPlanningContext,destination:context.destination} : undefined} : {}),
    ...(monthChanged ? {tripStartDate:context.startDate,tripEndDate:context.endDate,travelDate:context.startDate} : {})};
  if (context.destinationClarification || (context.destinationCandidate && context.destinationCandidate.status !== 'resolved')) return {context,session:nextSession};
  return finalizePlanningContextAuthority({before:session,context,session:nextSession});
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
  let status: 'resolved' | 'unresolved' | 'conflict' = isResolvedDestination(location) && Boolean(location.city?.trim() || location.region?.trim()) ? 'resolved' : 'unresolved';
  if (status === 'resolved' && candidate.countryHint && location) {
    const expected = normalizeCountryReference(candidate.countryHint);
    const actual = normalizeCountryReference(location.country);
    if ((expected.countryCode ?? expected.country) !== (actual.countryCode ?? actual.country)) status = 'conflict';
  }
  if (status !== 'resolved' || !location) return {...session,travelContext:{...ctx,destinationCandidate:{...candidate,status,locale}}};
  const label = location.city || location.region || location.formattedName;
  return {...session,tripDestination:location,preferredArea:label,
    pendingQuestion:{type:'ask_days',options:[],baseDestination:label,destinationCountry:location.country},
    lastResolvedPendingQuestion:undefined,
    tripPlanningContext:session.tripPlanningContext ? {...session.tripPlanningContext,destination:label} : undefined,
    travelContext:{...ctx,destination:label,destinationCountry:location.country,destinationCountryCode:normalizeCountryReference(location.country).countryCode,
    destinationCity:location.city || undefined,destinationRegion:location.region,destinationType:location.city ? 'city' : 'region',
    destinationCoordinates:{lat:location.lat,lng:location.lng},destinationCandidate:{...candidate,status:'resolved',locale}}};
}
