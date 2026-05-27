import { useEffect } from "react";
import { useRouter } from "@tanstack/react-router";
import { AUTH_CALLBACK_PATH } from "@/constants/auth-redirect";
import { getClientAuthSession } from "@/lib/auth-session";
import {
  clearPendingCallbackPath,
  readPendingCallbackPath,
} from "@/lib/auth-oauth-deep-link";
import { shouldSkipOAuthCallbackNavigation } from "@/lib/oauth-callback-guard";
import {
  navigateOAuthAppPath,
  parseOAuthAppPath,
  registerOAuthAppNavigate,
} from "@/lib/oauth-app-navigate";

/**
 * Routes `roamie://auth/callback?code=…` into TanStack `/auth/callback` (Capacitor SPA).
 */
export function OAuthRouterBridge() {
  const router = useRouter();

  useEffect(() => {
    const unregister = registerOAuthAppNavigate(async (path) => {
      const { pathname, href, searchRecord } = parseOAuthAppPath(path);
      window.history.replaceState(window.history.state, "", href);

      await router.navigate({
        to: pathname,
        search: searchRecord,
        replace: true,
      });

      await router.load({ sync: true });

      if (pathname === AUTH_CALLBACK_PATH) {
        clearPendingCallbackPath();
      }
    });

    const pending = readPendingCallbackPath();
    if (pending) {
      void (async () => {
        if (await shouldSkipOAuthCallbackNavigation(pending)) return;
        const session = await getClientAuthSession();
        if (session?.user) {
          clearPendingCallbackPath();
          return;
        }
        await navigateOAuthAppPath(pending);
      })();
    }

    return unregister;
  }, [router]);

  return null;
}
