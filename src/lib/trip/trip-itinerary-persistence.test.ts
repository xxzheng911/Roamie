import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RoamieItineraryItem, RoamiePayloadV2 } from "@/lib/ai/types";
import type { StoredItinerary } from "@/lib/itinerary-storage";
import {
  insertStopOnDate,
  moveStopInDay,
  removeStopAt,
} from "@/lib/trip/trip-stop-mutations";
import { applyTripDateRangeChange, applyTripDatesToPayload } from "@/lib/trip/trip-date-edit";
import { saveTripDatesToStorage } from "@/lib/trip/save-trip-dates";
import { saveTripItineraryAfterAddPlace } from "@/lib/trip/trip-add-place-persist";
import { saveTripItineraryAfterDeletePlace } from "@/lib/trip/trip-delete-place-persist";
import {
  dayStopNames,
  findStopByPlaceName,
  reloadTripItineraryPayload,
  saveTripItineraryToStorage,
} from "@/lib/trip/trip-itinerary-persist";
import { seedCoreTripPersistedFingerprint } from "@/lib/trip/core-trip-update-guard";

const TRIP_ID = "trip-persist-test";

const memory = new Map<string, StoredItinerary>();

function basePayload(items: RoamieItineraryItem[]): RoamiePayloadV2 {
  return {
    version: 2,
    title: "測試行程",
    summary: "",
    moodTag: "",
    recommendations: [],
    itinerary: items,
    tripSettings: {
      startTime: "10:00",
      transport: "walk",
      legMinutes: {},
      legTransport: {},
      tripStartDate: "2026-12-01",
      tripEndDate: "2026-12-01",
      tripDayDates: ["2026-12-01"],
    },
  };
}

function seedTrip(items: RoamieItineraryItem[]): void {
  const payload = basePayload(items);
  memory.set(TRIP_ID, {
    id: TRIP_ID,
    mood: "",
    payload,
    title: payload.title,
    updated_at: "2026-01-01T00:00:00.000Z",
    is_title_customized: false,
  });
  seedCoreTripPersistedFingerprint(TRIP_ID, payload, "");
}

vi.mock("@/lib/itinerary-storage", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/itinerary-storage")>();
  return {
    ...actual,
    getAuthenticatedUserId: vi.fn(async () => null),
    getItinerary: vi.fn(async (id: string) => memory.get(id) ?? null),
    updateItinerary: vi.fn(
      async (id: string, payload: RoamiePayloadV2, options?: { reason?: string }) => {
        const prev = memory.get(id);
        if (!prev) return null;
        const next: StoredItinerary = {
          ...prev,
          payload,
          updated_at: new Date().toISOString(),
        };
        memory.set(id, next);
        void options?.reason;
        return next;
      },
    ),
  };
});

describe("trip itinerary persistence (reload survives)", () => {
  beforeEach(() => {
    memory.clear();
    seedTrip([
      {
        date: "2026-12-01",
        time: "10:00",
        title: "淺草寺",
        placeName: "淺草寺",
      },
      {
        date: "2026-12-01",
        time: "14:00",
        title: "晴空塔",
        placeName: "晴空塔",
      },
    ]);
  });

  it("persists add place after reload", async () => {
    let items = memory.get(TRIP_ID)!.payload as RoamiePayloadV2;
    items = {
      ...items,
      itinerary: insertStopOnDate(items.itinerary ?? [], {
        date: "2026-12-01",
        time: "16:00",
        title: "東京鐵塔",
        placeName: "東京鐵塔",
      }, { date: "2026-12-01", position: "end" }),
    };
    await saveTripItineraryAfterAddPlace(TRIP_ID, items, "東京鐵塔");
    const reloaded = await reloadTripItineraryPayload(TRIP_ID);
    expect(reloaded?.itinerary?.some((i) => i.placeName === "東京鐵塔")).toBe(true);
  });

  it("persists delete place after reload", async () => {
    let items = (memory.get(TRIP_ID)!.payload as RoamiePayloadV2).itinerary ?? [];
    items = removeStopAt(items, "2026-12-01", 0);
    const payload = basePayload(items);
    const { stillExists } = await saveTripItineraryAfterDeletePlace(
      TRIP_ID,
      payload,
      "淺草寺",
    );
    expect(stillExists).toBe(false);
    const reloaded = await reloadTripItineraryPayload(TRIP_ID);
    expect(reloaded?.itinerary?.some((i) => i.placeName === "淺草寺")).toBe(false);
  });

  it("persists date change after reload", async () => {
    const payload = memory.get(TRIP_ID)!.payload as RoamiePayloadV2;
    const { settings, items: remapped } = applyTripDateRangeChange(
      TRIP_ID,
      payload.tripSettings!,
      payload.itinerary ?? [],
      { start: "2026-12-05", end: "2026-12-05" },
    );
    const next = applyTripDatesToPayload(payload, settings, remapped);
    await saveTripDatesToStorage(TRIP_ID, next);
    const reloaded = await reloadTripItineraryPayload(TRIP_ID);
    expect(reloaded?.tripSettings?.tripStartDate).toBe("2026-12-05");
    expect(reloaded?.itinerary?.[0]?.date).toBe("2026-12-05");
  });

  it("persists stop time change after reload", async () => {
    let items = [...((memory.get(TRIP_ID)!.payload as RoamiePayloadV2).itinerary ?? [])];
    items[0] = { ...items[0]!, time: "09:30" };
    await saveTripItineraryToStorage(TRIP_ID, basePayload(items), "trip_stop_time");
    const reloaded = await reloadTripItineraryPayload(TRIP_ID);
    const row = findStopByPlaceName(reloaded!, "淺草寺", "2026-12-01");
    expect(row?.time).toBe("09:30");
  });

  it("persists stop reorder after reload", async () => {
    let items = [...((memory.get(TRIP_ID)!.payload as RoamiePayloadV2).itinerary ?? [])];
    items = moveStopInDay(items, "2026-12-01", 0, 1);
    await saveTripItineraryToStorage(TRIP_ID, basePayload(items), "trip_stop_reorder");
    const reloaded = await reloadTripItineraryPayload(TRIP_ID);
    expect(dayStopNames(reloaded!, "2026-12-01")).toEqual(["晴空塔", "淺草寺"]);
  });
});
