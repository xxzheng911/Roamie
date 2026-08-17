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
  return sessionId.trim();
}

export function bindSessionCandidatePool(params: {
  sessionId: string;
  destination: string;
  places: PlaceResult[];
  poolResult?: CandidatePoolResult;
}): SessionCandidatePool {
  const destination = normalizeDestinationLabel(params.destination);
  const rawSessionId = params.sessionId?.trim();
  const scopedSessionId =
    rawSessionId && rawSessionId !== "chat_default" && rawSessionId !== "default"
      ? rawSessionId
      : `ephemeral-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const entry: SessionCandidatePool = {
    sessionId: sessionKey(scopedSessionId),
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
  const rawSessionId = params.sessionId?.trim();
  if (!rawSessionId) return null;
  const sid = sessionKey(rawSessionId);
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
  const sid = sessionId.trim();
  if (!sid) return;
  sessionPools.delete(sessionKey(sid));
}

/** When destination changes mid-chat, drop prior session pool. */
export function ensureSessionDestination(
  sessionId: string | null | undefined,
  destination: string,
): void {
  const sidRaw = sessionId?.trim();
  if (!sidRaw) return;
  const sid = sessionKey(sidRaw);
  const entry = sessionPools.get(sid);
  if (!entry) return;
  const dest = normalizeDestinationLabel(destination);
  if (entry.destination !== dest) {
    sessionPools.delete(sid);
  }
}
