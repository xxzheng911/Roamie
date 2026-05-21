import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const listSavedTrips = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase } = context;
    const { data, error } = await supabase
      .from("saved_trips")
      .select("id, title, mood, cover_image, created_at")
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return { trips: data ?? [] };
  });

export const saveTrip = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        title: z.string().min(1).max(120),
        mood: z.string().max(40).optional(),
        cover_image: z.string().url().optional(),
        payload: z.record(z.string(), z.unknown()).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: row, error } = await supabase
      .from("saved_trips")
      .insert({
        user_id: userId,
        title: data.title,
        mood: data.mood ?? null,
        cover_image: data.cover_image ?? null,
        payload: (data.payload ?? {}) as never,
      })
      .select()
      .single();
    if (error) throw new Error(error.message);
    return { trip: row };
  });

export const getMyProfile = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data, error } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", userId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return { profile: data };
  });
