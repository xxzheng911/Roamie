import { resolveCandidateDisplay, type LocalizationCandidate } from './destination-localization';
import type { TripLocation } from '@/lib/location/types';
import { normalizeCountryReference } from './destination-country-normalize';

export type DestinationDisplayMetadata = LocalizationCandidate & { placeId?: string };
/** Match an explicitly offered display label; this never resolves geographic identity. */
export function displayMetadataMatchesLabel(candidate: DestinationDisplayMetadata, label: string): boolean {
  return [candidate.name, ...(['zh-TW','en','ja','ko'] as const).map(locale => resolveCandidateDisplay(candidate,locale).name)]
    .some(name => name.trim().toLocaleLowerCase() === label.trim().toLocaleLowerCase());
}
export function sameDisplayCountry(a: string, b: string): boolean {
  const left = normalizeCountryReference(a), right = normalizeCountryReference(b);
  return Boolean(a && b) && (left.countryCode ?? left.country) === (right.countryCode ?? right.country);
}
/** Projection only, after resolver validation. Never supplies geography to the resolver. */
export function attachDestinationDisplay<T extends TripLocation | null | undefined>(location: T, candidate?: DestinationDisplayMetadata): T {
  if (!location || !location.placeId?.trim() || !candidate || !["city", "region"].includes(candidate.type) || !sameDisplayCountry(candidate.country, location.country) ||
      (candidate.placeId && candidate.placeId !== location.placeId) ||
      !displayMetadataMatchesLabel(candidate, (candidate.type === 'region' ? location.region : location.city) ?? '')) return location;
  return { ...location, destinationDisplay: { ...candidate, placeId: location.placeId } } as T;
}
export function verifiedDestinationDisplay(location?: TripLocation | null): DestinationDisplayMetadata | undefined {
  const candidate = location?.destinationDisplay;
  return location && candidate?.placeId === location.placeId &&
    attachDestinationDisplay(location, candidate) !== location ? candidate : undefined;
}
