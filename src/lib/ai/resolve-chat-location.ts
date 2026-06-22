import type { ChatPlanningSession } from "@/lib/chat-session";
import { getEffectiveLocationSnapshot } from "@/lib/effective-location";
import { requestDeviceLocation } from "@/lib/device-location";

/** 聊聊推薦用定位：session → effective-location → device GPS */
export async function resolveChatLocation(
  session: ChatPlanningSession,
): Promise<ChatPlanningSession> {
  if (
    session.location?.lat != null &&
    session.location?.lng != null &&
    (Math.abs(session.location.lat) > 0.001 || Math.abs(session.location.lng) > 0.001)
  ) {
    console.info(
      `[CHAT_LOCATION] lat=${session.location.lat} lng=${session.location.lng} source=session`,
    );
    return session;
  }

  const effective = getEffectiveLocationSnapshot();
  if (effective?.lat != null && effective?.lng != null && effective.isReadyForPlaces) {
    console.info(
      `[CHAT_LOCATION] lat=${effective.lat} lng=${effective.lng} source=${effective.source}`,
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

  try {
    const device = await requestDeviceLocation();
    if (device.lat != null && device.lng != null) {
      console.info(`[CHAT_LOCATION] lat=${device.lat} lng=${device.lng} source=device`);
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

  console.info("[CHAT_LOCATION] unavailable");
  return session;
}
