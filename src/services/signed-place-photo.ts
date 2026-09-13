import { supabase } from "@/integrations/supabase/client";
import { resolveApiUrl } from "@/lib/api-url";
import { extractGooglePlacePhotoName } from "@/lib/safe-image-url";

const cache = new Map<string, { url: string; expiresAt: number }>();
const inflight = new Map<string, Promise<string | null>>();

export async function getSignedPlacePhotoUrl(
  photoOrUrl: string,
  width: number,
): Promise<string | null> {
  const photo = photoOrUrl.startsWith("places/")
    ? photoOrUrl.trim()
    : extractGooglePlacePhotoName(photoOrUrl);
  if (!photo) return null;
  const normalizedWidth = Math.min(1600, Math.max(120, Math.round(width)));
  const key = `${photo}@${normalizedWidth}`;
  const existing = cache.get(key);
  if (existing && existing.expiresAt > Date.now() + 30_000) return existing.url;
  const pending = inflight.get(key);
  if (pending) return pending;
  const request = (async () => {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) return null;
    const response = await fetch(resolveApiUrl("/api/place-photo/sign"), {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ photo, width: normalizedWidth }),
    });
    if (!response.ok) return null;
    const body = (await response.json()) as { url?: string };
    if (!body.url) return null;
    const resolvedUrl = resolveApiUrl(body.url);
    const parsed = new URL(resolvedUrl, window.location.origin);
    const expires = Number(parsed.searchParams.get("expires"));
    cache.set(key, {
      url: resolvedUrl,
      expiresAt: Number.isFinite(expires) ? expires * 1000 : Date.now(),
    });
    return resolvedUrl;
  })().finally(() => inflight.delete(key));
  inflight.set(key, request);
  return request;
}
