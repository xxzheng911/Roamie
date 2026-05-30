import type { SupabaseClient } from "@supabase/supabase-js";

/** Payload from client after context parser runs (each chat turn). */
export type KnownTravelContextPayload = {
  destination?: string;
  travelDate?: string;
  travelDays?: number;
  season?: string;
  weather?: string;
  budget?: string;
  transportation?: string;
  companions?: string;
  mood?: string;
  selectedPlaces?: string[];
  sessionExtras?: Record<string, unknown>;
};

export async function upsertKnownTravelContext(
  client: SupabaseClient,
  userId: string,
  payload: KnownTravelContextPayload,
): Promise<void> {
  if (!payload || Object.keys(payload).length === 0) return;

  const { error } = await client.from("conversation_context").upsert(
    {
      user_id: userId,
      destination: payload.destination ?? null,
      travel_date: payload.travelDate ?? null,
      travel_days: payload.travelDays ?? null,
      season: payload.season ?? null,
      weather: payload.weather ?? null,
      budget: payload.budget ?? null,
      transportation: payload.transportation ?? null,
      companions: payload.companions ?? null,
      mood: payload.mood ?? null,
      selected_places: payload.selectedPlaces ?? [],
      session_extras: (payload.sessionExtras ?? {}) as Record<string, unknown>,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" },
  );

  if (error) {
    console.error("[conversation_context] server upsert failed", error);
    return;
  }
  console.info("[conversation_context] server upsert ok", {
    destination: payload.destination,
  });
}

export function knownTravelContextFromPayload(
  payload: KnownTravelContextPayload | undefined,
): string {
  if (!payload) return "";
  const lines = ["【Known Travel Context — persistent, cross-device】"];
  const fields: [string, string | number | undefined][] = [
    ["Destination", payload.destination],
    ["Travel Date", payload.travelDate],
    ["Travel Days", payload.travelDays != null ? `${payload.travelDays}` : undefined],
    ["Season", payload.season],
    ["Weather", payload.weather],
    ["Transportation", payload.transportation],
    ["Companions", payload.companions],
    ["Budget", payload.budget],
    ["Mood", payload.mood],
    [
      "Selected Places",
      payload.selectedPlaces?.length ? payload.selectedPlaces.join("、") : undefined,
    ],
  ];
  for (const [label, value] of fields) {
    if (value != null && String(value).trim()) lines.push(`${label}: ${value}`);
  }
  lines.push(
    "Rules: Never contradict the above unless the user explicitly changes plans in the latest message.",
  );
  return lines.join("\n");
}
