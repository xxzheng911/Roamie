/** Server-only diagnostic vocabulary. Never attach context, URLs, exceptions or provider data. */
export type ClimateFailure =
  | 'guard_blocked' | 'budget_exhausted' | 'queue_rejected' | 'guard_unavailable'
  | 'provider_timeout' | 'provider_http_error' | 'provider_invalid_json'
  | 'invalid_timezone' | 'invalid_coordinates' | 'incomplete_dates' | 'incomplete_stats'
  | 'invalid_normal_values' | 'unknown_provider_failure' | 'unexpected_query_cost'
  | 'cached_unavailable' | 'source_unavailable' | 'adapter_timeout' | 'adapter_unavailable';
export function climateUnavailable(failure: ClimateFailure): null {
  // One fixed-code completion summary; no user identifiers or arbitrary strings.
  console.warn('[climate_failure]', failure);
  return null;
}
