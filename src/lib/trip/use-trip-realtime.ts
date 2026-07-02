import { useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { RoamiePayloadV2 } from "@/lib/ai/types";
import { isRoamiePayloadV2 } from "@/lib/ai/types";
import type { Itinerary } from "@/lib/itinerary.functions";
import { isSavedCollectionTrip } from "@/lib/saved-collection";
import type { StoredItinerary } from "@/lib/itinerary-storage";

const TRIP_SELECT =
  "id, title, custom_title, is_title_customized, mood, cover_image, cover_image_url, custom_cover_image_url, is_cover_customized, cover_source, cover_query, created_at, updated_at, payload";

type Options = {
  tripId: string;
  enabled?: boolean;
  onRemoteUpdate: (stored: StoredItinerary) => void;
  /** Skip applying our own write echo */
  isLocalWrite?: () => boolean;
};

function rowToStored(row: Record<string, unknown>): StoredItinerary | null {
  const payload = row.payload as Itinerary | RoamiePayloadV2;
  if (!isSavedCollectionTrip(payload)) return null;
  return {
    id: String(row.id),
    title: String(row.title),
    custom_title: (row.custom_title as string | null) ?? null,
    is_title_customized: Boolean(row.is_title_customized),
    mood: (row.mood as string | null) ?? null,
    cover_image: (row.cover_image as string | null) ?? null,
    cover_image_url: (row.cover_image_url as string | null) ?? null,
    custom_cover_image_url: (row.custom_cover_image_url as string | null) ?? null,
    is_cover_customized: Boolean(row.is_cover_customized),
    cover_source: (row.cover_source as StoredItinerary["cover_source"]) ?? null,
    cover_query: (row.cover_query as string | null) ?? null,
    created_at: String(row.created_at),
    updated_at: String(row.updated_at ?? row.created_at),
    payload,
  };
}

/** Supabase Realtime：行程 payload 變更時同步（last-write-wins） */
export function useTripRealtimeSync({
  tripId,
  enabled = true,
  onRemoteUpdate,
  isLocalWrite,
}: Options): void {
  const onRemoteRef = useRef(onRemoteUpdate);
  onRemoteRef.current = onRemoteUpdate;
  const isLocalRef = useRef(isLocalWrite);
  isLocalRef.current = isLocalWrite;

  useEffect(() => {
    if (!tripId || !enabled) return;

    const channel = supabase
      .channel(`trip-collab:${tripId}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "saved_trips",
          filter: `id=eq.${tripId}`,
        },
        (payload) => {
          if (isLocalRef.current?.()) return;
          const row = payload.new as Record<string, unknown>;
          const stored = rowToStored(row);
          if (!stored || !isRoamiePayloadV2(stored.payload)) return;
          console.info("[TRIP_REALTIME] remote update", tripId);
          onRemoteRef.current(stored);
        },
      )
      .subscribe((status) => {
        console.info("[TRIP_REALTIME] subscribe", tripId, status);
      });

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [tripId, enabled]);
}
