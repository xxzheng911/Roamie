import { describe, expect, it } from "vitest";
import { listTripDates } from "./group-by-date";

describe("listTripDates", () => {
  it("extends sequential local calendar days without UTC shift", () => {
    const dates = listTripDates([], "2026-06-03", 3);
    expect(dates).toEqual(["2026-06-03", "2026-06-04", "2026-06-05"]);
  });
});
