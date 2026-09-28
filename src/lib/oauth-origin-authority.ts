import {
  AUTH_CALLBACK_PATH,
  LOCAL_DEV_AUTH_CALLBACK,
  OAUTH_DEEP_LINK_REDIRECT,
  PRODUCTION_AUTH_ORIGIN,
} from "@/constants/auth-redirect";

/** Validate the raw origin before URL normalization can hide ports or userinfo. */
export function validateOAuthOrigin(raw: string, development = false): string {
  if (development && raw === "http://localhost:8080") return raw;
  if (!/^https:\/\/(?:roamie\.tw|[0-9a-f]{8}-roamie\.vvbwb6bw52\.workers\.dev)$/.test(raw))
    throw new Error("oauth_origin_not_allowed");
  const url = new URL(raw);
  if (url.protocol !== "https:" || url.username || url.password || url.port || url.origin !== raw)
    throw new Error("oauth_origin_not_allowed");
  return url.origin;
}

export function resolveOAuthCallback(input: {
  native: boolean;
  origin?: string;
  development?: boolean;
}): string {
  if (input.native) return OAUTH_DEEP_LINK_REDIRECT;
  const origin = validateOAuthOrigin(input.origin ?? "", input.development);
  if (origin === PRODUCTION_AUTH_ORIGIN) return `${PRODUCTION_AUTH_ORIGIN}${AUTH_CALLBACK_PATH}`;
  if (origin === "http://localhost:8080") return LOCAL_DEV_AUTH_CALLBACK;
  return `${origin}${AUTH_CALLBACK_PATH}`;
}
