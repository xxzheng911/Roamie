import { readCachedAuthenticatedUserIdSync } from "@/lib/auth-session";
import {
  stashPendingAuthAction,
  type AuthRequiredAction,
  type PendingAuthMetadata,
} from "@/lib/auth-pending-action";

type AuthActionNavigator = (path: string) => void;

export type AuthRequirementRequest = {
  action: AuthRequiredAction;
  metadata?: PendingAuthMetadata;
};

type AuthRequirementPrompt = (request: AuthRequirementRequest) => void;

let navigator: AuthActionNavigator | null = null;
let promptListener: AuthRequirementPrompt | null = null;

export function registerAuthActionNavigator(next: AuthActionNavigator | null): void {
  navigator = next;
}

export function registerAuthRequirementPrompt(next: AuthRequirementPrompt | null): void {
  promptListener = next;
}

/** Saves the existing pending action, then opens the existing login flow. */
export function commitAuthRequirementLogin(request: AuthRequirementRequest): void {
  const sourcePath = currentAppPath();
  stashPendingAuthAction({ action: request.action, sourcePath, metadata: request.metadata });
  if (navigator) navigator("/login");
  else if (typeof window !== "undefined") window.location.assign("/login");
}

export function currentAppPath(): string {
  if (typeof window === "undefined") return "/";
  return `${window.location.pathname}${window.location.search}`;
}

/**
 * Logged-in: allow the caller to run its existing action.
 * Guest: ask first. Nothing is stashed, requested, reserved, or written until the user chooses login.
 */
export function requireAuthForAction(
  action: AuthRequiredAction,
  metadata?: PendingAuthMetadata,
): boolean {
  if (readCachedAuthenticatedUserIdSync()) return true;
  const request = { action, metadata };
  if (promptListener) promptListener(request);
  else commitAuthRequirementLogin(request);
  return false;
}
