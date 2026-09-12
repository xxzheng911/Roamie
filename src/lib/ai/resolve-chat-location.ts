import type { ChatPlanningSession } from "@/lib/chat-session";
import { devVerboseInfo } from "@/lib/dev-verbose-log";
import {
  ensureEffectiveLocationBootstrap,
  getEffectiveLocationSnapshot,
} from "@/lib/effective-location";
import { requestDeviceLocation } from "@/lib/device-location";
import { isAppActiveForLocation } from "@/lib/location-app-gate";

export type NearbyRecommendationScope = "destination" | "current_location" | "none";

/** Recompute nearby vs destination scope from the latest session snapshot. */
export function resolveNearbyRecommendationScope(
  session: ChatPlanningSession,
  extraDestination?: string,
  options?: { explicitNearbyRequest?: boolean },
): {
  scope: NearbyRecommendationScope;
  hasExplicitDestination: boolean;
  deviceLocationAvailable: boolean;
  deviceLocationUsed: boolean;
} {
  const isNearbyShortcut =
    session.normalizedShortcutRequest?.structured === true &&
    session.normalizedShortcutRequest.intent === "nearby_recommendation";
  const nearbyOwnsScope = isNearbyShortcut || options?.explicitNearbyRequest === true;
  const hasExplicitDestination = nearbyOwnsScope
    ? false
    : Boolean(
        extraDestination?.trim() ||
        session.travelContext?.destination?.trim() ||
        session.tripPlanningContext?.destination?.trim() ||
        session.tripDestination?.city?.trim(),
      );
  const lat = session.nearbyLocationAuthority?.lat ?? session.location?.lat;
  const lng = session.nearbyLocationAuthority?.lng ?? session.location?.lng;
  const deviceLocationAvailable =
    lat != null && lng != null && (Math.abs(lat) > 0.001 || Math.abs(lng) > 0.001);
  const scope: NearbyRecommendationScope = hasExplicitDestination
    ? "destination"
    : deviceLocationAvailable
      ? "current_location"
      : "none";
  return {
    scope,
    hasExplicitDestination,
    deviceLocationAvailable,
    deviceLocationUsed: deviceLocationAvailable && !hasExplicitDestination,
  };
}

/** 聊聊推薦用定位：session → effective-location → device GPS（僅前景、非必須） */
export async function resolveChatLocation(
  session: ChatPlanningSession,
  options?: { requireNearbyAuthority?: boolean },
): Promise<ChatPlanningSession> {
  const authority = session.nearbyLocationAuthority;
  if (options?.requireNearbyAuthority && authority) {
    return {
      ...session,
      location: { lat: authority.lat, lng: authority.lng, city: authority.displayLabel },
    };
  }
  if (
    !options?.requireNearbyAuthority &&
    session.location?.lat != null &&
    session.location?.lng != null &&
    (Math.abs(session.location.lat) > 0.001 || Math.abs(session.location.lng) > 0.001)
  ) {
    devVerboseInfo(
      `[CHAT_LOCATION] lat=${session.location.lat} lng=${session.location.lng} source=session`,
    );
    return session;
  }

  const effective = getEffectiveLocationSnapshot();
  if (
    !options?.requireNearbyAuthority &&
    effective?.lat != null &&
    effective?.lng != null &&
    !effective.isFallback
  ) {
    devVerboseInfo(
      `[CHAT_LOCATION] lat=${effective.lat} lng=${effective.lng} source=${effective.source} fallback=${effective.isFallback}`,
    );
    return {
      ...session,
      location: {
        lat: effective.lat,
        lng: effective.lng,
        city: effective.city,
      },
    };
  }

  // Chat shortcut may race ahead of location bootstrap; wait once for the
  // same effective-location source used by Home before falling back.
  try {
    const bootstrapped = await ensureEffectiveLocationBootstrap();
    if (
      !options?.requireNearbyAuthority &&
      bootstrapped?.lat != null &&
      bootstrapped?.lng != null &&
      !bootstrapped.isFallback
    ) {
      devVerboseInfo(
        `[CHAT_LOCATION] lat=${bootstrapped.lat} lng=${bootstrapped.lng} source=${bootstrapped.source} fallback=${bootstrapped.isFallback}`,
      );
      return {
        ...session,
        location: {
          lat: bootstrapped.lat,
          lng: bootstrapped.lng,
          city: bootstrapped.city,
        },
      };
    }
  } catch (e) {
    console.warn(
      `[CHAT_LOCATION] bootstrap_unavailable message=${e instanceof Error ? e.message : String(e)}`,
    );
  }

  if (!isAppActiveForLocation()) {
    devVerboseInfo("[CHAT_LOCATION] skipped reason=app_inactive");
    return session;
  }

  try {
    const device = await requestDeviceLocation();
    if (device.lat != null && device.lng != null && !device.usedFallback) {
      devVerboseInfo(
        `[CHAT_LOCATION] lat=${device.lat} lng=${device.lng} source=device fallback=${device.usedFallback}`,
      );
      return {
        ...session,
        location: {
          lat: device.lat,
          lng: device.lng,
          city: device.city ?? session.location?.city ?? "",
        },
        nearbyLocationAuthority: {
          displayLabel: device.city ?? session.location?.city ?? "",
          lat: device.lat,
          lng: device.lng,
          source: "device",
        },
      };
    }
  } catch (e) {
    console.warn(
      `[CHAT_LOCATION] unavailable message=${e instanceof Error ? e.message : String(e)}`,
    );
  }

  devVerboseInfo("[CHAT_LOCATION] unavailable");
  return session;
}
