import { supabase } from "@/integrations/supabase/client";
import type { Tables, TablesInsert } from "@/integrations/supabase/types";
import { getAuthenticatedUserId } from "@/lib/auth-session";
import type { ConversationContext } from "@/lib/ai/conversation-context";
import type { ChatPlanningSession } from "@/lib/chat-session";
import { placeDisplayName } from "@/lib/chat-session";
import type { PlusConversationMemory } from "@/lib/ai/plus-conversation-memory";
import { normalizeDestination } from "@/lib/ai/normalize-destination";

export type ConversationContextRow = Tables<"conversation_context">;
export type SessionExtras = {
  travelDateEnd?: string;
  travelMonth?: string;
  seasonHighlights?: string[];
  lastDiscussedPlace?: string;
  nearbyAnchor?: string;
  interests?: string[];
  outfitSuggestion?: string;
};

const EMPTY_PLUS_MEMORY: PlusConversationMemory = {};

function seasonText(ctx: ConversationContext | undefined): string | null {
  if (!ctx) return null;
  const label = ctx.travelSeason;
  const highlights = ctx.seasonHighlights?.filter(Boolean).join("、");
  if (label && highlights) return `${label}（${highlights}）`;
  if (label) return label;
  if (highlights) return highlights;
  if (ctx.travelMonth) return ctx.travelMonth;
  return null;
}

/** Map in-memory context → Supabase row (context parser summary). */
export function conversationContextToRow(
  userId: string,
  ctx: ConversationContext | undefined,
  session?: ChatPlanningSession,
): TablesInsert<"conversation_context"> {
  const season = seasonText(ctx);
  const extras: SessionExtras = {
    travelDateEnd: ctx?.travelDateEnd,
    travelMonth: ctx?.travelMonth,
    seasonHighlights: ctx?.seasonHighlights,
    lastDiscussedPlace: ctx?.lastDiscussedPlace,
    nearbyAnchor: ctx?.nearbyAnchor,
    interests: ctx?.interests,
    outfitSuggestion: ctx?.outfitSuggestion,
  };

  const cleanDest =
    normalizeDestination(ctx?.destination) ??
    normalizeDestination(session?.tripDestination?.city) ??
    null;

  return {
    user_id: userId,
    destination: cleanDest,
    travel_date: ctx?.travelDate ?? session?.travelDate ?? session?.tripStartDate ?? null,
    travel_days: ctx?.travelDays ?? session?.tripDays ?? null,
    season,
    weather: ctx?.weather ?? null,
    budget: ctx?.budget ?? session?.budget ?? null,
    transportation: ctx?.transportation ?? session?.transportation ?? null,
    companions:
      ctx?.companions ??
      session?.discovery?.companionship ??
      null,
    mood: ctx?.mood ?? session?.selectedMood ?? session?.mood ?? null,
    selected_places: ctx?.selectedPlaces?.length
      ? ctx.selectedPlaces
      : (session?.selectedPlaces ?? []).map(placeDisplayName),
    session_extras: extras as unknown as TablesInsert<"conversation_context">["session_extras"],
    plus_memory: EMPTY_PLUS_MEMORY as unknown as TablesInsert<"conversation_context">["plus_memory"],
    updated_at: new Date().toISOString(),
  };
}

export function rowToConversationContext(row: ConversationContextRow): ConversationContext {
  const extras = (row.session_extras ?? {}) as SessionExtras;
  const places = Array.isArray(row.selected_places)
    ? (row.selected_places as string[]).filter((p) => typeof p === "string" && p.trim())
    : [];

  let travelSeason: string | undefined;
  let seasonHighlights: string[] | undefined;
  if (row.season?.includes("（")) {
    const [label, rest] = row.season.split("（");
    travelSeason = label.trim();
    seasonHighlights = rest?.replace(/）$/, "").split("、").filter(Boolean);
  } else if (row.season) {
    travelSeason = row.season;
  }

  return {
    destination: row.destination ?? undefined,
    travelDate: row.travel_date ?? undefined,
    travelDateEnd: extras.travelDateEnd,
    travelDays: row.travel_days ?? undefined,
    travelMonth: extras.travelMonth,
    travelSeason: travelSeason ?? extras.travelMonth,
    seasonHighlights: seasonHighlights ?? extras.seasonHighlights,
    weather: row.weather ?? undefined,
    transportation: row.transportation ?? undefined,
    budget: row.budget ?? undefined,
    companions: row.companions ?? undefined,
    mood: row.mood ?? undefined,
    selectedPlaces: places,
    lastDiscussedPlace: extras.lastDiscussedPlace,
    nearbyAnchor: extras.nearbyAnchor,
    interests: extras.interests,
    outfitSuggestion: extras.outfitSuggestion,
    updatedAt: row.updated_at,
  };
}

/** Apply Supabase row onto local session (login / cross-device). */
export function applyPersistedContextToSession(
  session: ChatPlanningSession,
  row: ConversationContextRow,
): ChatPlanningSession {
  const ctx = rowToConversationContext(row);
  const discovery = { ...session.discovery };
  if (ctx.companions && !discovery.companionship) {
    discovery.companionship = ctx.companions;
  }

  return {
    ...session,
    conversationContext: ctx,
    conversationSummary: undefined,
    travelContext: {
      ...(session.travelContext ?? { interests: [] }),
      destination: ctx.destination ?? session.travelContext?.destination,
      startDate: ctx.travelDate ?? session.travelContext?.startDate,
      endDate: ctx.travelDateEnd ?? session.travelContext?.endDate,
      days: ctx.travelDays ?? session.travelContext?.days,
      travelMonth: ctx.travelMonth ?? session.travelContext?.travelMonth,
      companion: ctx.companions ?? session.travelContext?.companion,
      transportMode:
        ctx.transportation === "自駕"
          ? "drive"
          : ctx.transportation === "步行"
            ? "walk"
            : ctx.transportation === "大眾運輸"
              ? "transit"
              : session.travelContext?.transportMode,
      budgetLevel: ctx.budget ?? session.travelContext?.budgetLevel,
      mood: ctx.mood ?? session.travelContext?.mood,
      interests: [...new Set([...(session.travelContext?.interests ?? []), ...(ctx.interests ?? [])])],
    },
    tripDestination: ctx.destination
      ? {
          city: ctx.destination,
          displayLabel: ctx.destination,
          lat: session.tripDestination?.lat ?? 0,
          lng: session.tripDestination?.lng ?? 0,
        }
      : session.tripDestination,
    tripDays: ctx.travelDays ?? session.tripDays,
    travelDate: ctx.travelDate ?? session.travelDate,
    tripStartDate: ctx.travelDate ?? session.tripStartDate,
    tripEndDate: ctx.travelDateEnd ?? session.tripEndDate,
    transportation: ctx.transportation ?? session.transportation,
    budget: ctx.budget ?? session.budget,
    mood: ctx.mood ?? session.mood,
    selectedMood: ctx.mood ?? session.selectedMood,
    preferredArea: ctx.nearbyAnchor
      ? `${ctx.nearbyAnchor}附近`
      : ctx.destination
        ? ctx.destination
        : session.preferredArea,
    discovery,
  };
}

export async function loadConversationContext(): Promise<ConversationContextRow | null> {
  const uid = await getAuthenticatedUserId();
  if (!uid) return null;

  const { data, error } = await supabase
    .from("conversation_context")
    .select("*")
    .eq("user_id", uid)
    .maybeSingle();

  if (error) {
    console.error("[conversation_context] load failed", error);
    return null;
  }
  return data;
}

export async function saveConversationContext(
  session: ChatPlanningSession,
): Promise<void> {
  const uid = await getAuthenticatedUserId();
  if (!uid) return;

  const row = conversationContextToRow(uid, session.conversationContext, session);
  const { error } = await supabase.from("conversation_context").upsert(row, {
    onConflict: "user_id",
  });

  if (error) {
    console.error("[conversation_context] save failed", error);
    return;
  }
  console.info("[conversation_context] saved", {
    destination: row.destination,
    travel_days: row.travel_days,
  });
}

let saveDebounce: ReturnType<typeof setTimeout> | null = null;

/** Debounced write after each chat turn (parser-updated context). */
export function scheduleSaveConversationContext(session: ChatPlanningSession): void {
  if (saveDebounce) clearTimeout(saveDebounce);
  saveDebounce = setTimeout(() => {
    saveDebounce = null;
    void saveConversationContext(session);
  }, 450);
}

export async function clearConversationContext(): Promise<void> {
  const uid = await getAuthenticatedUserId();
  if (!uid) return;
  await supabase.from("conversation_context").delete().eq("user_id", uid);
}
