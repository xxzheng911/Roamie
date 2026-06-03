import { describe, expect, it } from "vitest";
import { buildTripPlaceSearchQuery } from "./resolve-trip-place-id";

describe("buildTripPlaceSearchQuery", () => {
  it("includes name, address, city, and destination", () => {
    const q = buildTripPlaceSearchQuery({
      item: {
        date: "2026-12-14",
        time: "10:00",
        title: "雷門",
        placeName: "雷門",
        address: "東京都台東區淺草",
      },
      destination: "東京",
      city: "東京",
    });
    expect(q).toContain("雷門");
    expect(q).toContain("淺草");
    expect(q).toContain("東京");
  });
});
