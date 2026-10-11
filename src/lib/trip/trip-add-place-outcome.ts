import { fixedPlacesFailureReason } from '../places-failure-reason';
import { getTripAddPlaceCopy } from '../i18n/trip-add-place-copy';
import type { Locale } from '../i18n/types';
export type TripSearchStatus = 'success' | 'empty' | 'filtered' | 'cooldown_skipped' | 'rate_limited' | 'provider_error' | 'network_error' | 'timeout' | 'stale' | 'auth_error' | 'missing_context';
export type TripSearchOutcome<T> = {
  status: TripSearchStatus;
  candidates: T[];
  rawCount: number;
  reason: string;
  blockedReason?: 'request_cooldown' | 'query_cooldown' | 'rate_window' | 'other';
  retryAfterSeconds?: number;
};
/** Whitelisted metadata only; never propagate provider text/body/headers. */
export function safeTripSearchMetadata(value: unknown) {
  const v = value as { blockedReason?: unknown; retryAfterSeconds?: unknown } | null;
  const blockedReason = ['request_cooldown','query_cooldown','rate_window','other'].includes(String(v?.blockedReason))
    ? v!.blockedReason as TripSearchOutcome<never>['blockedReason'] : undefined;
  const retryAfterSeconds = typeof v?.retryAfterSeconds === 'number' && Number.isFinite(v.retryAfterSeconds) && v.retryAfterSeconds >= 0
    ? Math.ceil(v.retryAfterSeconds) : undefined;
  return { ...(blockedReason ? {blockedReason} : {}), ...(retryAfterSeconds != null ? {retryAfterSeconds} : {}) };
}
export class TripSearchFailure extends Error {
  constructor(public outcome: TripSearchOutcome<never>) { super(outcome.reason); this.name='TripSearchFailure'; }
}
export function tripSearchFailure(value: unknown): TripSearchFailure {
  if (value instanceof TripSearchFailure) return value;
  const v=value as {error?: unknown; message?: unknown; name?: unknown; status?: unknown} | null;
  const text=String(v?.error ?? v?.message ?? value ?? '');
  const fixed=fixedPlacesFailureReason(value);
  const status: TripSearchStatus = fixed==='cooldown_skipped' ? 'cooldown_skipped'
    : /rate_limited|budget_limited|\b429\b/.test(fixed ?? text) ? 'rate_limited'
    : fixed==='stale_generation' || /stale_generation/.test(text) ? 'stale'
    : fixed==='deadline_exceeded' || /timeout|timed.out|deadline|AbortError/i.test(text+' '+v?.name) ? 'timeout'
    : /unauthoriz|forbidden|auth_error|\b40[13]\b/i.test(text) ? 'auth_error'
    : /network|failed to fetch|fetch failed|Load failed/i.test(text) || v?.name==='TypeError' ? 'network_error'
    : 'provider_error';
  return new TripSearchFailure({status,candidates:[],rawCount:0,reason:fixed ?? status,...safeTripSearchMetadata(value)});
}
export function requireTripCandidates<T>(outcome: TripSearchOutcome<T>): T[] {
  if (outcome.status==='success' || outcome.status==='empty') return outcome.candidates;
  throw new TripSearchFailure({...outcome,candidates:[]});
}
export function tripSearchOutcomeCopy(outcome: TripSearchOutcome<unknown>, locale: Locale) {
  const copy=getTripAddPlaceCopy(locale);
  if(outcome.status==='empty' && outcome.rawCount===0) return copy.empty;
  if(outcome.status==='cooldown_skipped' || outcome.status==='rate_limited') return copy.searchRestricted;
  if(outcome.status==='filtered') return copy.filtered;
  if(outcome.status==='missing_context') return copy.missingContext;
  return copy.searchUnavailable;
}
