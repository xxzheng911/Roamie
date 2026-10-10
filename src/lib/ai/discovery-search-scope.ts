import { fixedPlacesFailureReason } from "../places-failure-reason";
import type { PlaceSearchData, PlaceSearchFn } from './chat-place-recommendation';
export type DiscoverySearchStatus = 'success_with_results'|'success_empty'|'rate_limited'|'cooldown_skipped'|'stale_generation'|'timeout'|'provider_error'|'invalid_request'|'auth_error'|'network_error';
export const DISCOVERY_REQUEST_BUDGET = 12;
const searchStates = new WeakMap<PlaceSearchFn, () => boolean>();
export function discoverySearchStopped(search: PlaceSearchFn): boolean { return searchStates.get(search)?.() ?? false; }
export class DiscoverySearchStopped extends Error {
  constructor(public readonly status: DiscoverySearchStatus, public readonly reason: string) { super(reason); this.name='DiscoverySearchStopped'; }
}
export function classifyDiscoverySearch(value: unknown, thrown=false): DiscoverySearchStatus {
  const fixed = fixedPlacesFailureReason(value);
  if (fixed === 'cooldown_skipped' || fixed === 'stale_generation' || fixed === 'provider_error') return fixed;
  if (fixed === 'deadline_exceeded') return 'timeout';
  if (fixed) return 'rate_limited';
  const v=value as {error?:unknown;message?:unknown;name?:string;places?:unknown[];status?:number;httpStatus?:number}|null;
  const msg=typeof v?.error==='string'?v.error:typeof v?.message==='string'?v.message:'';
  const status=v?.httpStatus??v?.status;
  if (/stale_generation/.test(msg)) return 'stale_generation';
  if (/cooldown|rate_window|provider_protection|foreground_.*budget|guard_skipped/.test(msg)) return 'cooldown_skipped';
  if (status===429 || /429|rate_limited|RESOURCE_EXHAUSTED/i.test(msg)) return 'rate_limited';
  if (v?.name==='TimeoutError' || /timeout|timed_out|deadline/.test(msg)) return 'timeout';
  if (status===401 || status===403 || /401|403|unauthorized|forbidden|auth_error/.test(msg)) return 'auth_error';
  if (status===400 || /400|invalid_request|invalid_google_request|INVALID_ARGUMENT/.test(msg)) return 'invalid_request';
  if (v?.name==='TypeError' || /network|fetch failed|Failed to fetch/i.test(msg)) return 'network_error';
  if (thrown || v?.error || (status!=null && status>=400)) return 'provider_error';
  if (!Array.isArray(v?.places)) return 'provider_error';
  return v.places.length?'success_with_results':'success_empty';
}
export function discoverySearchFailureReason(value:unknown,status:DiscoverySearchStatus):string {
  const fixed = fixedPlacesFailureReason(value);
  if (fixed) return fixed;
  const v=value as {error?:unknown;message?:unknown}|null;
  const message=typeof v?.error==='string'?v.error:typeof v?.message==='string'?v.message:'';
  if(status==='timeout' && /deadline/.test(message)) return 'deadline_exceeded';
  if(status!=='rate_limited') return status;
  for(const code of ['ip_rate_limited','user_rate_limited','guest_rate_limited','provider_rate_limited']) if(message.includes(code)) return code;
  return message.includes('RESOURCE_EXHAUSTED')?'provider_rate_limited':'rate_limited';
}
/** Private canonical key; never logged. Keep all filters, omit only diagnostic routing fields. */
export function discoveryRequestSignature(data: PlaceSearchData): string {
  const omitted=new Set(['placesCaller','placesScreen','placesLane','placesRound','placesScopeSource','placesRecommendationRequestId']);
  const canonical=(v:unknown,key=''):unknown=> {
    if(Array.isArray(v)) return key==='includedTypes'?[...new Set(v)].sort():v.map(x=>canonical(x));
    if(v && typeof v==='object') return Object.fromEntries(Object.entries(v).filter(([k,x])=>!omitted.has(k)&&x!==undefined).sort(([a],[b])=>a.localeCompare(b)).map(([k,x])=>[k,canonical(x,k)]));
    return typeof v==='string' && key==='query'?v.normalize('NFKC').trim().replace(/\s+/g,' '):v;
  };
  return JSON.stringify(canonical(data));
}
export function createDiscoverySearchScope(search:PlaceSearchFn, options:{deadlineAt:number;now?:()=>number;budget?:number}) {
  const now=options.now??Date.now;
  const cache=new Map<string,Promise<Awaited<ReturnType<PlaceSearchFn>>>>();
  const stats={attempted:0,deduped:0,reused:0,succeeded:0,failed:0,rateLimited:0,timedOut:0,failFastReason:null as string|null};
  let stopped:DiscoverySearchStopped|undefined;
  const stop=(status:DiscoverySearchStatus,reason:string):never=>{stopped??=new DiscoverySearchStopped(status,reason);stats.failFastReason=stopped.reason;throw stopped;};
  const run:PlaceSearchFn=async args=> {
    if(stopped) throw stopped;
    const key=discoveryRequestSignature(args.data);
    const existing=cache.get(key);
    if(existing){stats.deduped++;stats.reused++;return structuredClone(await existing);}
    const low=/fallback|theme|topup|repair/.test(args.data.placesCaller??'');
    if(options.deadlineAt-now() <= (low?5000:0)) return stop('timeout','deadline_exceeded');
    if(stats.attempted>=Math.min(options.budget??DISCOVERY_REQUEST_BUDGET,DISCOVERY_REQUEST_BUDGET)) return stop('cooldown_skipped','discovery_budget_exhausted');
    stats.attempted++;
    const promise=Promise.resolve().then(async()=> {
      let result:Awaited<ReturnType<PlaceSearchFn>>;
      try {result=await search(args);} catch(error){stats.failed++;const status=classifyDiscoverySearch(error,true);if(status==='rate_limited') stats.rateLimited++;if(status==='timeout') stats.timedOut++;return stop(status,discoverySearchFailureReason(error,status));}
      const status=classifyDiscoverySearch(result);
      if(status!=='success_empty'&&status!=='success_with_results'){stats.failed++;if(status==='rate_limited') stats.rateLimited++;if(status==='timeout') stats.timedOut++;return stop(status,discoverySearchFailureReason(result,status));}
      stats.succeeded++;return {...result,discoveryStatus:status};
    });
    cache.set(key,promise);
    return structuredClone(await promise);
  };
  searchStates.set(run, () => Boolean(stopped));
  return {search:run,stats};
}

// Retain only short-lived generation work, including in-flight results. Never reuse across IDs.
const generationScopes = new Map<string, {expiresAt:number;scope:ReturnType<typeof createDiscoverySearchScope>}>();
export function generationDiscoverySearchScope(generationId:string|undefined, search:PlaceSearchFn, options:{deadlineAt:number}) {
  if(!generationId) return createDiscoverySearchScope(search,options);
  const now=Date.now();
  for(const [id,entry] of generationScopes) if(entry.expiresAt<now) generationScopes.delete(id);
  const existing=generationScopes.get(generationId);
  if(existing) return existing.scope;
  // Fail closed rather than evict active work and re-dispatch an existing generation.
  if(generationScopes.size>=64) return createDiscoverySearchScope(search,{...options,budget:0});
  const scope=createDiscoverySearchScope(search,options);
  generationScopes.set(generationId,{scope,expiresAt:options.deadlineAt+60_000});
  return scope;
}
