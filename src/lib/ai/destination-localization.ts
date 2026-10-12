import data from './destination-localization-data';
import type { Locale } from '@/lib/i18n/types';
import { displayDestinationForCopy } from './destination-locale-aliases';

/** Display-only reference. Never a resolver credential or Google Place ID mapping. */
export type LocalizationIdentity = {
  bindingId: string;
  qid?: string;
  countryCode?: string;
  administrativeId?: string;
};
export type LocalizationCandidate = {
  name: string;
  country: string;
  type: string;
  originalName?: string;
  /** Trusted source metadata only; never inferred from canonical text or UI locale. */
  englishName?: string;
  sourceLocale?: string;
  localizedNames?: Partial<Record<Locale, string>>;
  localizationIdentity?: LocalizationIdentity;
};
type OfficialDisplayBinding = {
  sourceType: 'official_travel_region' | 'official_destination';
  bindingId: string;
  countryCode: string;
  semanticType: 'city' | 'scenic_spot' | 'tourist_attraction' | 'travel_region' | 'tourism_route';
  candidateType: string;
  status: string;
  scope: 'display_name_only';
  boundaryEquivalence: false;
  reviewedAt: string;
  basis: string;
  labels: Partial<Record<Locale, { name: string; status: string; sourceUrl: string; snapshotVersion: string; basis: string }>>;
};
export type LocalizationRecord = {
  qid?: string;
  sourceRevision?: number;
  source?: string;
  status: string;
  originalLocale?: Locale;
  officialTravelRegion?: OfficialDisplayBinding;
  officialDestination?: OfficialDisplayBinding;
  review?: { method: string; evidenceUrls: string[]; reviewedAt: string; scope?: string; basis?: string };
  expected: { name: string; country: string; countryCode: string; type: string; administrativeId?: string };
  labels: Partial<Record<Locale, string | null>>;
};
const records: Record<string, LocalizationRecord> = data;

/** Only reviewed data is used; URLs are provenance, never fetched at runtime. */
function officialLabels(record: LocalizationRecord, bindingId: string) {
  // Ambiguous parallel official identities fail closed. Legacy region bindings stay strict.
  if (record.officialTravelRegion && record.officialDestination) return {};
  const source = record.officialDestination ?? record.officialTravelRegion;
  const semanticsValid = record.officialDestination
    ? source?.sourceType === 'official_destination' && ['city', 'scenic_spot', 'tourist_attraction', 'travel_region', 'tourism_route'].includes(source.semanticType)
    : source?.sourceType === 'official_travel_region' && source.semanticType === 'travel_region' && record.expected.type === 'region';
  if (!source || source.status !== 'approved' || !semanticsValid ||
      source.bindingId !== bindingId || source.countryCode !== record.expected.countryCode ||
      source.candidateType !== record.expected.type ||
      source.scope !== 'display_name_only' ||
      source.boundaryEquivalence !== false || !source.reviewedAt || !source.basis.trim()) return {};
  return Object.fromEntries(Object.entries(source.labels).filter(([, label]) =>
    label?.status === 'approved' && label.name.trim() && label.snapshotVersion.trim() &&
    label.basis.trim() && /^https:\/\/[^/]+\//.test(label.sourceUrl)
  ).map(([locale, label]) => [locale, label!.name.trim()])) as Partial<Record<Locale, string>>;
}

export function resolveCandidateDisplay(
  candidate: LocalizationCandidate,
  locale: Locale,
  registry: Readonly<Record<string, LocalizationRecord>> = records,
) {
  const identity = candidate.localizationIdentity;
  const record = identity && registry[identity.bindingId];
  const expected = record?.expected;
  const conflict = record && expected && (candidate.name !== expected.name || candidate.country !== expected.country ||
    candidate.type !== expected.type || (identity.qid && identity.qid !== record.qid) ||
    (identity.countryCode && identity.countryCode !== expected.countryCode) ||
    (identity.administrativeId && identity.administrativeId !== expected.administrativeId));
  const original = candidate.originalName ?? candidate.name;
  // A conflicting binding must not provide either target-language or English labels.
  if (conflict || (candidate.englishName?.trim() && candidate.localizedNames?.en?.trim() &&
      candidate.englishName.trim() !== candidate.localizedNames.en.trim()))
    return { name: original, source: 'original', reason: 'identity_conflict' } as const;
  const existing = candidate.localizedNames?.[locale]?.trim() ||
    (locale === 'en' ? candidate.englishName?.trim() : undefined);
  if (existing) return { name: existing, source: 'existing', reason: 'localized_name' } as const;
  const wikiValid = record?.status === 'approved' && /^Q\d+$/.test(record.qid ?? '') &&
    Number.isInteger(record.sourceRevision) && (record.sourceRevision ?? 0) > 0 &&
    record.source?.startsWith('https://www.wikidata.org/') &&
    (record.review?.method === 'external_identity_crosswalk' ||
      (record.review?.method === 'display_identity_evidence' && record.review.scope === 'display_name_only' &&
        !!record.review.basis?.trim() && record.review.evidenceUrls.length >= 2)) &&
    !!record.review?.evidenceUrls.length && !!record.review.reviewedAt;
  const official = record && identity ? officialLabels(record, identity.bindingId) : {};
  const labelFor = (language: Locale) => {
    const wiki = wikiValid ? record?.labels[language]?.trim() : undefined;
    const tourism = official[language];
    // Independent approved sources disagree: require review, never choose the first.
    return wiki && tourism && wiki !== tourism ? { conflict: true } : { name: wiki || tourism };
  };
  const target = labelFor(locale);
  if (target.conflict) return { name: original, source: 'original', reason: 'identity_conflict' } as const;
  if (target.name) return { name: target.name, source: 'offline', reason: 'localized_name' } as const;
  const alias = displayDestinationForCopy(candidate.name, undefined, locale);
  if (alias !== candidate.name) return { name: alias, source: 'alias', reason: 'localized_name' } as const;
  if (record?.originalLocale === locale) return { name: original, source: 'original', reason: 'original_fallback' } as const;
  if (locale !== 'en') {
    const english = labelFor('en');
    if (english.conflict) return { name: original, source: 'original', reason: 'identity_conflict' } as const;
    const name = candidate.localizedNames?.en?.trim() || candidate.englishName?.trim() || english.name;
    if (name) return { name, source: candidate.localizedNames?.en?.trim() || candidate.englishName?.trim() ? 'existing' : 'offline', reason: 'english_fallback' } as const;
  }
  const reason = record && !wikiValid && !Object.keys(official).length
    ? record.status === 'approved' ? 'invalid_binding' : 'binding_unreviewed'
    : record ? 'missing_locale_label' : 'original_fallback';
  return { name: original, source: 'original', reason } as const;
}

/** Shared title/header lookup: pending labels never become reverse-lookup aliases. */
export function findReviewedDisplayCandidate(name: string, countryCode: string | undefined) {
  if (!countryCode) return undefined;
  const matches = Object.entries(records).filter(([bindingId, record]) => {
    if (record.expected.countryCode !== countryCode) return false;
    const candidate = { ...record.expected, localizationIdentity: { bindingId } };
    const labels = (['zh-TW', 'en', 'ja', 'ko'] as Locale[]).map(locale => resolveCandidateDisplay(candidate, locale));
    return labels.some(label => label.source === 'offline') &&
      [record.expected.name, ...labels.filter(label => label.source === 'offline').map(label => label.name)]
        .some(label => label.toLocaleLowerCase() === name.toLocaleLowerCase());
  });
  if (matches.length !== 1) return undefined;
  const [bindingId, record] = matches[0];
  return { ...record.expected, localizationIdentity: { bindingId } };
}
