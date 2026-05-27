import type { RoamiePayloadV2 } from "@/lib/ai/types";
import { readBootstrapDeviceLocation } from "@/lib/device-location";
import { confirmSaveTrip, type StoredItinerary } from "@/lib/itinerary-storage";
import { generateTripTitle } from "@/lib/trip/trip-title";

/** 建立空白收藏行程（不經 AI 聊天、不帶預設景點） */
export async function createBlankSavedTrip(): Promise<StoredItinerary> {
  const boot = readBootstrapDeviceLocation();
  const today = new Date().toISOString().slice(0, 10);
  const city = boot.city?.trim() || "未命名";
  const destination = city;

  const payload = {
    version: 2,
    title: generateTripTitle({ destination, mood: "", moodTag: "" }),
    summary: "空白行程，請自行新增想去的地點。",
    moodTag: "",
    recommendations: [],
    itinerary: [],
    destination,
    days: 1,
    generatedAt: new Date().toISOString(),
    tripSettings: {
      startTime: "10:00",
      transport: "walk",
      tripStartDate: today,
      tripEndDate: today,
      legMinutes: {},
      legTransport: {},
      transitLegs: {},
    },
    travelers: 1,
  } as RoamiePayloadV2;

  return confirmSaveTrip(payload, "manual");
}
