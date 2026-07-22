/**
 * Same session + same query → 5s cooldown (return cache / skip Places).
 */
import { PLACES_QUERY_COOLDOWN_MS } from "@/lib/ai/places-cost-cache/constants";
import { logPlacesSearchSkipped } from "@/lib/ai/places-cost-cache/log";

type CooldownEntry = {
  at: number;
  resultRef?: unknown;
};

const queryCooldown = new Map<string, CooldownEntry>();

export function placesQueryCooldownKey(params: {
  sessionId?: string | null;
  destination: string;
  query: string;
  category?: string;
}): string {
  const session = (params.sessionId ?? "default").trim() || "default";
  const dest = params.destination.trim().toLowerCase();
  const q = params.query.trim().toLowerCase();
  const cat = (params.category ?? "").trim().toLowerCase();
  return `${session}|${dest}|${cat}|${q}`;
}

export function isPlacesQueryOnCooldown(
  key: string,
  now = Date.now(),
): boolean {
  const entry = queryCooldown.get(key);
  if (!entry) return false;
  if (now - entry.at > PLACES_QUERY_COOLDOWN_MS) {
    queryCooldown.delete(key);
    return false;
  }
  return true;
}

export function notePlacesQueryCooldown(key: string, resultRef?: unknown): void {
  queryCooldown.set(key, { at: Date.now(), resultRef });
}

export function readPlacesQueryCooldownResult<T>(key: string): T | undefined {
  const entry = queryCooldown.get(key);
  if (!entry || !isPlacesQueryOnCooldown(key)) return undefined;
  return entry.resultRef as T | undefined;
}

/**
 * Returns true when caller should skip live Places and use cache.
 * Logs [PLACES_SEARCH_SKIPPED] on cooldown hit.
 */
export function shouldSkipPlacesForQueryCooldown(params: {
  sessionId?: string | null;
  destination: string;
  query: string;
  category?: string;
}): boolean {
  const key = placesQueryCooldownKey(params);
  if (!isPlacesQueryOnCooldown(key)) return false;
  logPlacesSearchSkipped({
    reason: "query_cooldown",
    destination: params.destination,
    query: params.query,
    category: params.category ?? "",
    cooldownMs: PLACES_QUERY_COOLDOWN_MS,
  });
  return true;
}

export function clearPlacesQueryCooldown(sessionId?: string): void {
  if (!sessionId) {
    queryCooldown.clear();
    return;
  }
  const prefix = `${sessionId.trim()}|`;
  for (const key of [...queryCooldown.keys()]) {
    if (key.startsWith(prefix)) queryCooldown.delete(key);
  }
}
