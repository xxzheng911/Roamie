import type { ChatPlanningSession } from "@/lib/chat-session";
import { devVerboseInfo } from "@/lib/dev-verbose-log";
import { getEffectiveLocationSnapshot } from "@/lib/effective-location";
import { requestDeviceLocation } from "@/lib/device-location";
import { isAppActiveForLocation } from "@/lib/location-app-gate";

/** 聊聊推薦用定位：session → effective-location → device GPS（僅前景、非必須） */
export async function resolveChatLocation(
  session: ChatPlanningSession,
): Promise<ChatPlanningSession> {
  if (
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
  if (effective?.lat != null && effective?.lng != null) {
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

  if (!isAppActiveForLocation()) {
    devVerboseInfo("[CHAT_LOCATION] skipped reason=app_inactive");
    return session;
  }

  try {
    const device = await requestDeviceLocation();
    if (device.lat != null && device.lng != null) {
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
