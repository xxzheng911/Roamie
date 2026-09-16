import { isCapacitorNativeShell } from "@/lib/capacitor-native-shell";
import { OpenExternalUrl } from "@/lib/open-external-url-native";

/** Scene-safe outbound URL authority. Native iOS uses UIWindowScene.open; Web uses window.open. */
export async function openExternalUrl(url: string): Promise<boolean> {
  const trimmed = url.trim();
  if (!trimmed) return false;

  if (isCapacitorNativeShell()) {
    try {
      await OpenExternalUrl.open({ url: trimmed });
      return true;
    } catch (error) {
      console.warn("[open-external-url] native open failed", error);
      return false;
    }
  }

  if (typeof window === "undefined") return false;
  const opened = window.open(trimmed, "_blank", "noopener,noreferrer");
  return Boolean(opened);
}
