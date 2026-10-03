/**
 * Pending auth action.
 * Stores only the action name, return path, and non-sensitive UI context.
 * Login recovery replays the existing action pipeline; it does not own business logic.
 */

export const AUTH_REQUIRED_ACTIONS = [
  "ai_chat",
  "ai_shortcut",
  "mood_shortcut",
  "ai_recommendation",
  "trip_generation",
  "trip_create",
  "trip_add_place",
  "trip_edit",
  "trip_delete",
  "favorite_write",
  "personalization_write",
  "chat_history",
  "collaboration",
  "subscription_action",
  "account_action",
] as const;

export type AuthRequiredAction = (typeof AUTH_REQUIRED_ACTIONS)[number];

export type PendingAuthMetadata = Record<string, string | number | boolean | null>;

export type PendingAuthAction = {
  id: string;
  action: AuthRequiredAction;
  sourcePath: string;
  createdAt: number;
  metadata: PendingAuthMetadata;
};

export const AUTH_ACTION_RESUME_EVENT = "roamie:auth-action-resume";

const STORAGE_KEY = "roamie:pending-auth-action";
const TTL_MS = 30 * 60 * 1000;
const MAX_METADATA_CHARS = 4_000;

const ACTION_SET = new Set<string>(AUTH_REQUIRED_ACTIONS);

export function isAuthRequiredAction(value: unknown): value is AuthRequiredAction {
  return typeof value === "string" && ACTION_SET.has(value);
}

/** App-internal path only. Rejects protocol-relative and absolute URLs. */
export function isSafeAppReturnPath(path: string): boolean {
  if (!path.startsWith("/") || path.startsWith("//") || path.includes("\\") || path.includes("://")) {
    return false;
  }
  if (path.length > 2000) return false;
  return true;
}

export function splitAppReturnPath(path: string): {
  pathname: string;
  search?: Record<string, string>;
} {
  const queryIndex = path.indexOf("?");
  const pathname = (queryIndex < 0 ? path : path.slice(0, queryIndex)) || "/";
  if (queryIndex < 0) return { pathname };
  const search: Record<string, string> = {};
  const params = new URLSearchParams(path.slice(queryIndex + 1));
  params.forEach((value, key) => {
    if (key.length > 64 || value.length > 1500) return;
    search[key] = value;
  });
  return Object.keys(search).length > 0 ? { pathname, search } : { pathname };
}

/** Welcome is no longer an app destination after onboarding and login are complete.
 * Keep the stored source context intact; navigation and resume share this mapping.
 */
export function resolvePendingAuthReturnPath(
  sourcePath: string,
  onboardingCompleted: boolean,
  authenticated: boolean,
): string {
  if (
    onboardingCompleted && authenticated && isSafeAppReturnPath(sourcePath) &&
    splitAppReturnPath(sourcePath).pathname.replace(/\/+$/, "") === "/welcome"
  ) return "/";
  return sourcePath;
}

export function returnPathsMatch(currentPath: string, sourcePath: string): boolean {
  if (!isSafeAppReturnPath(currentPath) || !isSafeAppReturnPath(sourcePath)) return false;
  const current = splitAppReturnPath(currentPath);
  const source = splitAppReturnPath(sourcePath);
  const currentPathname = current.pathname.replace(/\/+$/, "") || "/";
  const sourcePathname = source.pathname.replace(/\/+$/, "") || "/";
  if (currentPathname !== sourcePathname) return false;
  for (const [key, value] of Object.entries(source.search ?? {})) {
    if ((current.search ?? {})[key] !== value) return false;
  }
  return true;
}

function sanitizeMetadata(metadata: PendingAuthMetadata | undefined): PendingAuthMetadata {
  if (!metadata) return {};
  const next: PendingAuthMetadata = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (key.length > 64) continue;
    if (value == null || typeof value === "number" || typeof value === "boolean") {
      next[key] = value;
      continue;
    }
    if (typeof value === "string" && value.length <= MAX_METADATA_CHARS) next[key] = value;
  }
  const encoded = JSON.stringify(next);
  if (encoded.length > MAX_METADATA_CHARS) return {};
  return next;
}

function readRaw(): PendingAuthAction | null {
  if (typeof sessionStorage === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PendingAuthAction>;
    if (!parsed || typeof parsed !== "object") return null;
    if (typeof parsed.id !== "string" || typeof parsed.createdAt !== "number") return null;
    if (!isAuthRequiredAction(parsed.action)) return null;
    if (typeof parsed.sourcePath !== "string" || !isSafeAppReturnPath(parsed.sourcePath)) return null;
    if (!parsed.metadata || typeof parsed.metadata !== "object") return null;
    return {
      id: parsed.id,
      action: parsed.action,
      sourcePath: parsed.sourcePath,
      createdAt: parsed.createdAt,
      metadata: sanitizeMetadata(parsed.metadata as PendingAuthMetadata),
    };
  } catch {
    return null;
  }
}

export function clearPendingAuthAction(): void {
  if (typeof sessionStorage === "undefined") return;
  try {
    sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore quota / private mode
  }
}

export function peekPendingAuthAction(): PendingAuthAction | null {
  const pending = readRaw();
  if (!pending) {
    clearPendingAuthAction();
    return null;
  }
  if (Date.now() - pending.createdAt > TTL_MS) {
    clearPendingAuthAction();
    return null;
  }
  return pending;
}

export function stashPendingAuthAction(input: {
  action: AuthRequiredAction;
  sourcePath: string;
  metadata?: PendingAuthMetadata;
}): PendingAuthAction | null {
  if (typeof sessionStorage === "undefined") return null;
  if (!isSafeAppReturnPath(input.sourcePath)) return null;
  const pending: PendingAuthAction = {
    id: crypto.randomUUID(),
    action: input.action,
    sourcePath: input.sourcePath,
    createdAt: Date.now(),
    metadata: sanitizeMetadata(input.metadata),
  };
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(pending));
    return pending;
  } catch {
    return null;
  }
}

/** Removes the pending action before the canonical handler runs, so reload cannot replay it. */
export function claimPendingAuthAction(id: string): PendingAuthAction | null {
  const pending = peekPendingAuthAction();
  if (!pending || pending.id !== id) return null;
  clearPendingAuthAction();
  return pending;
}
