/**
 * Session-level Candidate Pool binding.
 * One pool per destination until destination changes.
 */
import type { PlaceResult } from "@/lib/place-result";
import type { CandidatePoolResult } from "@/lib/ai/candidate-pool/types";
import { normalizeDestinationLabel } from "@/lib/ai/trip-planning-context";
import { logSessionPoolReused } from "@/lib/ai/places-cost-cache/log";

export type SessionCandidatePool = {
  sessionId: string;
  destination: string;
  places: PlaceResult[];
  poolResult?: CandidatePoolResult;
  boundAt: number;
};

const sessionPools = new Map<string, SessionCandidatePool>();

function sessionKey(sessionId: string): string {
  return (sessionId || "default").trim() || "default";
}

export function bindSessionCandidatePool(params: {
  sessionId: string;
  destination: string;
  places: PlaceResult[];
  poolResult?: CandidatePoolResult;
}): SessionCandidatePool {
  const destination = normalizeDestinationLabel(params.destination);
  const entry: SessionCandidatePool = {
    sessionId: sessionKey(params.sessionId),
    destination,
    places: params.places,
    poolResult: params.poolResult,
    boundAt: Date.now(),
  };
  sessionPools.set(entry.sessionId, entry);
  return entry;
}

export function readSessionCandidatePool(params: {
  sessionId?: string | null;
  destination: string;
}): SessionCandidatePool | null {
  const sid = sessionKey(params.sessionId ?? "default");
  const entry = sessionPools.get(sid);
  if (!entry) return null;
  const dest = normalizeDestinationLabel(params.destination);
  if (entry.destination !== dest) return null;
  if (!entry.places.length) return null;
  logSessionPoolReused({
    sessionId: sid,
    destination: dest,
    places: entry.places.length,
  });
  return entry;
}

export function clearSessionCandidatePool(sessionId?: string): void {
  if (!sessionId) {
    sessionPools.clear();
    return;
  }
  sessionPools.delete(sessionKey(sessionId));
}

/** When destination changes mid-chat, drop prior session pool. */
export function ensureSessionDestination(
  sessionId: string | null | undefined,
  destination: string,
): void {
  const sid = sessionKey(sessionId ?? "default");
  const entry = sessionPools.get(sid);
  if (!entry) return;
  const dest = normalizeDestinationLabel(destination);
  if (entry.destination !== dest) {
    sessionPools.delete(sid);
  }
}
