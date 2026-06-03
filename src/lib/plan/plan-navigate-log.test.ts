import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  logPlanAiNavigateFailed,
  logPlanAiNavigateTrip,
} from "@/lib/plan/plan-ai-generation-log";
import { logManualTripNavigateFailure } from "@/lib/plan/plan-manual-flow";

describe("plan navigate logs", () => {
  beforeEach(() => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("logs PLAN_AI_NAVIGATE_TRIP with route", () => {
    logPlanAiNavigateTrip({ tripId: "t1", route: "/saved/$tripId" });
    expect(console.info).toHaveBeenCalledWith("[PLAN_AI_NAVIGATE_TRIP]", {
      tripId: "t1",
      route: "/saved/$tripId",
    });
  });

  it("logs PLAN_AI_NAVIGATE_FAILED with tripId and route", () => {
    logPlanAiNavigateFailed({
      tripId: "t1",
      route: "/saved/$tripId",
      error: new Error("nav blocked"),
    });
    expect(console.error).toHaveBeenCalledWith(
      "[PLAN_AI_NAVIGATE_FAILED]",
      expect.objectContaining({
        tripId: "t1",
        route: "/saved/$tripId",
        message: "nav blocked",
      }),
    );
  });

  it("logs MANUAL_TRIP_NAVIGATE_FAILED on manual navigate error", () => {
    logManualTripNavigateFailure("t2", "/saved/$tripId", new Error("timeout"));
    expect(console.error).toHaveBeenCalledWith(
      "[MANUAL_TRIP_NAVIGATE_FAILED]",
      expect.objectContaining({ tripId: "t2", route: "/saved/$tripId" }),
    );
  });
});
