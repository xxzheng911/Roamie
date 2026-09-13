import { isNetworkFailureError } from "@/lib/user-facing-error";

export function isBrowserOnline(): boolean {
  return typeof navigator === "undefined" || navigator.onLine !== false;
}

export function subscribeBrowserConnectivity(listener: (online: boolean) => void): () => void {
  if (typeof window === "undefined") return () => {};
  const handleOnline = () => listener(true);
  const handleOffline = () => listener(false);
  window.addEventListener("online", handleOnline);
  window.addEventListener("offline", handleOffline);
  return () => {
    window.removeEventListener("online", handleOnline);
    window.removeEventListener("offline", handleOffline);
  };
}

/** Transport failures must return to the feature instead of entering Places backoff. */
export function shouldRetryPlacesFailure(error: unknown): boolean {
  return isBrowserOnline() && !isNetworkFailureError(error);
}
