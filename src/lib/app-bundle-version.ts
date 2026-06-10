import { APP_BUNDLE_ID } from "@/constants/app";
import {
  APP_BUILD_BRANCH,
  APP_BUILD_COMMIT,
  APP_BUILD_COMMIT_SHORT,
  APP_BUILD_TIME,
} from "@/generated/app-bundle-meta";

function resolveRuntimeBundleEntry(): string | null {
  if (typeof document === "undefined") return null;
  for (const node of document.querySelectorAll("script[src]")) {
    const src = node.getAttribute("src") ?? "";
    if (/index-[A-Za-z0-9_-]+\.js/.test(src)) return src;
  }
  return null;
}

let logged = false;

/** 啟動時印一次，供 Xcode 對照是否為最新 build bundle */
export function logAppBundleVersion(caller = "boot"): void {
  if (logged) return;
  logged = true;
  const bundleEntry = resolveRuntimeBundleEntry();
  console.info("[APP_BUNDLE_VERSION]", {
    caller,
    bundleId: APP_BUNDLE_ID,
    commitHash: APP_BUILD_COMMIT,
    commitShort: APP_BUILD_COMMIT_SHORT,
    branch: APP_BUILD_BRANCH,
    buildTime: APP_BUILD_TIME,
    bundleEntry,
    href: typeof location !== "undefined" ? location.href : null,
  });
}
