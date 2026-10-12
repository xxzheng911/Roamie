import { fixedPlacesFailureReason } from "../places-failure-reason";
import { classifyDiscoverySearch, discoverySearchFailureReason } from "./discovery-search-scope";
/** Hash only an opaque diagnostic generation ID; no dependency on chat/handoff state. */
function planCorrelationToken(generationId: string): string {
  let hash = 2166136261;
  for (let i = 0; i < generationId.length; i++) hash = Math.imul(hash ^ generationId.charCodeAt(i), 16777619);
  return (hash >>> 0).toString(16).padStart(8, "0");
}
const reasons = ['blocked_country','unresolved_destination','empty_candidates','filtered_candidates','destination_unresolved','destination_state_mismatch','cooldown_blocked','deadline_exceeded','provider_rate_limited','provider_failed','insufficient_candidates','insufficient_combinations','discovery_budget_exhausted','ip_rate_limited','user_rate_limited','guest_rate_limited','global_budget_limited','rate_limited','cooldown_skipped','stale_generation','timeout','provider_error','invalid_request','auth_error','network_error','unknown'] as const;
export type DiscoveryFailure = typeof reasons[number];
export function discoveryFailure(value: unknown): DiscoveryFailure {
  const code = typeof value === 'string' ? value : '';
  if (reasons.includes(code as DiscoveryFailure)) return code as DiscoveryFailure;
  if (['destination_resolution_failed','missing_destination'].includes(code)) return 'destination_unresolved';
  if (code === 'country_level_destination') return 'blocked_country';
  if (code === 'destination_state_desync') return 'destination_state_mismatch';
  if (code === 'places_rate_limited') return 'rate_limited';
  if (/timeout|deadline/.test(code)) return 'deadline_exceeded';
  if (code === 'places_no_results') return 'empty_candidates';
  if (code === 'place_discovery_failed') return 'provider_error';
  if (code === 'real_places_below_minimum') return 'insufficient_candidates';
  if (code === 'too_few_combinations' || code === 'combination_insufficient' || code === 'combination_candidates_insufficient') return 'insufficient_combinations';
  return 'unknown';
}
export function createCombinationDiscoveryTrace(correlationToken?: string, onFinal?: (combinationCount: number) => void) {
  const generationToken = planCorrelationToken(crypto.randomUUID());
  const correlation = /^[a-f0-9]{8}$/.test(correlationToken ?? '') ? correlationToken : undefined;
  const requests = { attempted:0, succeeded:0, failed:0, rateLimited:0, timedOut:0 };
  let candidates: {rawCount:number|null;uniqueCount:number|null;eligibleCount:number|null;combinationCount:number} = { rawCount:null, uniqueCount:null, eligibleCount:null, combinationCount:0 };
  let work = {deduped:0,reused:0,failFastReason:null as string|null};
  let finished = false;
  let failure: DiscoveryFailure | undefined;
  const emit = (stage: string, fields: Record<string, unknown>) => {
    try { console.info(`[COMBINATION_DISCOVERY_TRACE] ${stage}`, JSON.stringify({correlationToken:correlation,generationToken,...fields})); } catch { /* no behavioral effect */ }
  };
  const count = (n:number) => Number.isSafeInteger(n) && n >= 0 ? n : 0;
  return {
    work(stats:{attempted:number;succeeded:number;failed:number;rateLimited:number;timedOut:number;deduped:number;reused:number;failFastReason:string|null}) { for(const k of ["attempted","succeeded","failed","rateLimited","timedOut"] as const) requests[k]=count(stats[k]);work={deduped:count(stats.deduped),reused:count(stats.reused),failFastReason:stats.failFastReason ? discoveryFailure(stats.failFastReason) : null};},
    started(destinationReady:boolean, cacheHit:boolean) { emit('started',{destinationReady:destinationReady===true,cacheHit:cacheHit===true}); },
    guard(allowed:boolean, reason:unknown, cooldownActive:boolean, deadlineRemaining?:number) {
      const safeReason = allowed ? 'allowed' : discoveryFailure(reason);
      if (!allowed) failure = safeReason as DiscoveryFailure;
      emit('guard',{allowed:allowed===true,reason:safeReason,cooldownActive:cooldownActive===true,deadlineRemaining:deadlineRemaining == null ? null : count(Math.max(0,Math.floor(deadlineRemaining)))});
    },
    candidates(rawCount:number,uniqueCount:number,eligibleCount:number,combinationCount=0) { candidates={rawCount:count(rawCount),uniqueCount:count(uniqueCount),eligibleCount:count(eligibleCount),combinationCount:count(combinationCount)}; },
    async request<T>(run:()=>Promise<T>):Promise<T> {
      requests.attempted++;
      const record = (e:unknown) => {
        requests.failed++;
        const v=e as {status?:number;httpStatus?:number;error?:unknown;message?:unknown;name?:string}|null;
        const message = typeof v?.error === 'string' ? v.error : typeof v?.message === 'string' ? v.message : '';
        const fixed = fixedPlacesFailureReason(e);
        if (fixed) {
          failure = fixed;
          if (fixed.endsWith('rate_limited') || fixed === 'global_budget_limited') requests.rateLimited++;
          if (fixed === 'deadline_exceeded') requests.timedOut++;
        }
        else if (v?.status===429 || v?.httpStatus===429 || /429|rate[_ -]?limited/i.test(message)) {requests.rateLimited++;failure=discoveryFailure(discoverySearchFailureReason(e,classifyDiscoverySearch(e,true)));}
        else if (v?.name==='TimeoutError' || /timeout|timed[_ -]?out/i.test(message)) {requests.timedOut++;failure='deadline_exceeded';}
        else failure='provider_error';
        work.failFastReason = failure;
      };
      try { const result=await run(); if ((result as {error?:unknown}|null)?.error) record(result); else requests.succeeded++; return result; }
      catch(e) {record(e);throw e;}
    },
    finish(success:boolean, reason?:unknown, combinationCount=0) {
      if (finished) return; finished=true;
      // Failure may return no deliverable list while one actual assembled option remains.
      if (success || combinationCount > 0) candidates.combinationCount=count(combinationCount);
      emit('request_summary',{...requests,...work});emit('candidate_summary',candidates);
      try { onFinal?.(candidates.combinationCount); } catch { /* diagnostic observer only */ }
      emit('final',{success:success===true,failureReason:success ? null : work.failFastReason ?? failure ?? discoveryFailure(reason)});
    },
  };
}
export type CombinationDiscoveryTrace = ReturnType<typeof createCombinationDiscoveryTrace>;
