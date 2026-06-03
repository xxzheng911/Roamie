import { describe, expect, it, vi, beforeEach } from "vitest";
import type { RoamiePayloadV2 } from "@/lib/ai/types";

const logError = vi.spyOn(console, "error").mockImplementation(() => {});

vi.mock("@/lib/auth-session", () => ({
  getAuthenticatedUserId: vi.fn().mockResolvedValue("user-1"),
}));

const insertMock = vi.fn();
const updateMock = vi.fn();

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => ({
      insert: () => ({
        select: () => ({
          single: insertMock,
        }),
      }),
      update: () => ({
        eq: updateMock,
      }),
    }),
  },
}));

import { persistTripStaged } from "@/lib/trip/trip-staged-persist";

const shellPayload: RoamiePayloadV2 = {
  version: 2,
  title: "東京",
  summary: "test",
  moodTag: "",
  recommendations: [],
  itinerary: [],
  destination: "東京",
  days: 2,
  generatedAt: new Date().toISOString(),
  userSaved: true,
};

describe("persistTripStaged", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    logError.mockClear();
    insertMock.mockResolvedValue({
      data: {
        id: "trip-shell",
        title: "東京",
        mood: null,
        cover_image: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      error: null,
    });
    updateMock.mockResolvedValue({ error: null });
  });

  it("shellOnly completes after insert without stops update", async () => {
    const stored = await persistTripStaged(shellPayload, {
      source: "plan",
      coverMeta: { cover_image: null, cover_source: null, cover_query: null },
      shellOnly: true,
    });
    expect(stored.id).toBe("trip-shell");
    expect(insertMock).toHaveBeenCalled();
  });

  it("logs save timeout when insert hangs", async () => {
    insertMock.mockImplementation(() => new Promise(() => {}));
    vi.spyOn(await import("@/lib/async/with-timeout"), "withTimeout").mockImplementation(
      (promise, _ms, label) =>
        Promise.race([
          promise,
          new Promise<never>((_, reject) => {
            setTimeout(() => reject(new Error(`${label} 逾時（0 秒）`)), 15);
          }),
        ]),
    );
    await expect(
      persistTripStaged(shellPayload, {
        source: "plan",
        coverMeta: { cover_image: null, cover_source: null, cover_query: null },
        shellOnly: true,
      }),
    ).rejects.toThrow(/trip_staged_insert_shell 逾時/);
  });
});
