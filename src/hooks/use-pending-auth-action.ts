import { useEffect, useRef } from "react";
import {
  AUTH_ACTION_RESUME_EVENT,
  type AuthRequiredAction,
  type PendingAuthAction,
} from "@/lib/auth-pending-action";

/**
 * After login, the runtime dispatches one resume event.
 * The handler must call the same function the original button uses.
 */
export function usePendingAuthActionResume(
  action: AuthRequiredAction,
  handler: (pending: PendingAuthAction) => void,
): void {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    const onResume = (event: Event) => {
      const pending = (event as CustomEvent<PendingAuthAction>).detail;
      if (!pending || pending.action !== action) return;
      handlerRef.current(pending);
    };
    window.addEventListener(AUTH_ACTION_RESUME_EVENT, onResume);
    return () => window.removeEventListener(AUTH_ACTION_RESUME_EVENT, onResume);
  }, [action]);
}
