import { useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { isRoamiePayloadV2 } from "@/lib/ai/types";
import { normalizeStoredItinerary, type StoredItinerary } from "@/lib/itinerary-storage";

const TRIP_SELECT =
  "id, title, custom_title, is_title_customized, mood, cover_image, cover_image_url, custom_cover_image_url, is_cover_customized, cover_source, cover_query, created_at, updated_at, payload";

type Options = {
  tripId: string;
  enabled?: boolean;
  onRemoteUpdate: (stored: StoredItinerary) => void;
  /** Skip applying our own write echo */
  isLocalWrite?: () => boolean;
};

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
          const stored = normalizeStoredItinerary(payload.new);
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
