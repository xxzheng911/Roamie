import { describe, expect, it, vi } from "vitest";
import {
  applyTripDateRangeChange,
  datesFromInclusiveRange,
} from "./trip-date-edit";

describe("datesFromInclusiveRange", () => {
  it("produces 6 inclusive days from 2026-12-14 to 2026-12-19", () => {
    expect(datesFromInclusiveRange("2026-12-14", "2026-12-19")).toEqual([
      "2026-12-14",
      "2026-12-15",
      "2026-12-16",
      "2026-12-17",
      "2026-12-18",
      "2026-12-19",
    ]);
  });
});

describe("applyTripDateRangeChange", () => {
  it("recalculates sequential day dates from new start", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const items = [
      {
        date: "2026-12-01",
        time: "10:00",
        title: "A",
        description: "",
        placeName: "A",
        lat: null,
        lng: null,
      },
      {
        date: "2026-12-02",
        time: "11:00",
        title: "B",
        description: "",
        placeName: "B",
        lat: null,
        lng: null,
      },
    ];
    const { settings, items: nextItems } = applyTripDateRangeChange(
      "trip-1",
      {
        tripStartDate: "2026-12-01",
        tripEndDate: "2026-12-02",
        tripDayDates: ["2026-12-01", "2026-12-02"],
      },
      items,
      { start: "2026-12-23", end: "2026-12-24" },
    );

    expect(settings.tripStartDate).toBe("2026-12-23");
    expect(settings.tripEndDate).toBe("2026-12-24");
    expect(settings.tripDayDates).toEqual(["2026-12-23", "2026-12-24"]);
    expect(nextItems[0]?.date).toBe("2026-12-23");
    expect(nextItems[1]?.date).toBe("2026-12-24");
    const recalc = info.mock.calls.find((c) => c[0] === "[TRIP_DATES_RECALCULATED]");
    expect(recalc).toBeTruthy();
    expect((recalc![1] as { day1: string }).day1).toBe("2026-12-23");
    info.mockRestore();
  });

  it("does not extend beyond selected end when prior trip had more days", () => {
    const sevenDayDates = [
      "2026-12-14",
      "2026-12-15",
      "2026-12-16",
      "2026-12-17",
      "2026-12-18",
      "2026-12-19",
      "2026-12-20",
    ];
    const { settings } = applyTripDateRangeChange(
      "trip-1",
      {
        tripStartDate: "2026-12-14",
        tripEndDate: "2026-12-20",
        tripDayDates: sevenDayDates,
      },
      [],
      { start: "2026-12-14", end: "2026-12-19" },
    );

    expect(settings.tripDayDates).toHaveLength(6);
    expect(settings.tripDayDates).toEqual([
      "2026-12-14",
      "2026-12-15",
      "2026-12-16",
      "2026-12-17",
      "2026-12-18",
      "2026-12-19",
    ]);
    expect(settings.tripEndDate).toBe("2026-12-19");
  });
});
