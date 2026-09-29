/** Ignore a load/error from a previous src. Token and URL must both match. */
export function acceptImageLoad(input: {
  eventToken: number;
  activeToken: number;
  eventSrc: string;
  expectedSrc: string | null;
}): boolean {
  if (!Number.isFinite(input.eventToken) || input.eventToken !== input.activeToken) return false;
  if (!input.expectedSrc) return false;
  const eventSrc = normalizeImageEventSrc(input.eventSrc);
  const expectedSrc = normalizeImageEventSrc(input.expectedSrc);
  return Boolean(eventSrc) && eventSrc === expectedSrc;
}

/** Error events often have an empty currentSrc; the generation token is the authority. */
export function acceptImageError(input: { eventToken: number; activeToken: number }): boolean {
  return Number.isFinite(input.eventToken) && input.eventToken === input.activeToken;
}

function normalizeImageEventSrc(src: string): string {
  const trimmed = src.trim();
  if (!trimmed) return "";
  try {
    const url = new URL(
      trimmed,
      typeof window === "undefined" ? "https://roamie.invalid" : window.location.href,
    );
    return url.href;
  } catch {
    return trimmed;
  }
}
