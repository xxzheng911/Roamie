import { markSessionBootstrapped } from "@/components/StartupGate";
import { scheduleIosSnapshotRefreshBurst } from "@/lib/ios-snapshot-bridge";
import { detectPlatform } from "@/services/platform";

function toAbsoluteAppPath(path: string): string {
  const normalized = path.startsWith("/") ? path : `/${path}`;
  if (typeof window === "undefined") return normalized;
  return `${window.location.origin}${normalized}`;
}

type RouterNavigate = (opts: { to: string; replace?: boolean }) => void;

/**
 * OAuth 完成後導向。Capacitor 優先用 in-app router，避免整頁 reload 白屏。
 */
export function finishPostAuthRedirect(path: string, navigate?: RouterNavigate): void {
  markSessionBootstrapped();

  const normalized = path.startsWith("/") ? path : `/${path}`;
  const platform = detectPlatform();

  if (platform.isCapacitor && navigate) {
    if (platform.isIOS) {
      scheduleIosSnapshotRefreshBurst("post-auth");
    }
    navigate({ to: normalized, replace: true });
    return;
  }

  const url = toAbsoluteAppPath(normalized);
  if (platform.isCapacitor) {
    window.location.replace(url);
    return;
  }

  window.location.assign(url);
}
