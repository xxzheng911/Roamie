import type { ChatPlaceItem, ChatPlanningSession } from "@/lib/chat-session";
import { placeDisplayName } from "@/lib/chat-session";
import type { ChatConversationMode } from "@/lib/ai/trip-planning-context";

export type PlaceDetailFollowUpIntent =
  | "add_to_trip"
  | "nearby_cafe"
  | "nearby_late_snack"
  | "view_route"
  | "continue_chat";

export function isPlaceDetailChatActive(session: ChatPlanningSession): boolean {
  return Boolean(session.placeDetailFocus);
}

export function inferPreviousConversationMode(
  session: ChatPlanningSession,
): ChatConversationMode {
  if (session.previousConversationMode) return session.previousConversationMode;
  if (session.fromMoodFlow || session.fromMoodCard || session.homeMoodShortcutEntry) {
    return "mood_recommend";
  }
  if (session.conversationMode === "destination_planning") return "destination_planning";
  return "nearby_explore";
}

export function enterPlaceDetailChat(
  session: ChatPlanningSession,
  place: ChatPlaceItem,
): ChatPlanningSession {
  const previousMode = inferPreviousConversationMode(session);
  return {
    ...session,
    placeDetailFocus: place,
    selectedPlaceFromMood: place,
    previousConversationMode: previousMode,
    conversationMode: "place_focus",
    phase: "followup",
    activeChatIntent: undefined,
    foodPreference: undefined,
  };
}

function suggestStayDuration(place: ChatPlaceItem, mood: string): string {
  const blob = `${place.type ?? ""} ${place.description ?? ""} ${place.reason ?? ""}`;
  if (/(河|步道|公園|海邊|散步|堤)/.test(blob) || /深夜散步|夜景|走走/.test(mood)) {
    return "40～60 分鐘";
  }
  if (/(咖啡|café|cafe)/i.test(blob)) return "45～75 分鐘";
  if (/(餐廳|宵夜|夜市)/.test(blob)) return "60～90 分鐘";
  if (/(博物館|展覽|美術)/.test(blob)) return "90～120 分鐘";
  return "45～60 分鐘";
}

function moodFitLine(name: string, mood: string): string {
  if (/深夜散步|夜景/.test(mood)) {
    return `「${name}」很適合你剛剛說的深夜散步。這裡比較適合慢慢走、看夜景，不太像需要排很滿的景點。`;
  }
  if (/下雨天|雨/.test(mood)) {
    return `「${name}」蠻適合下雨天想找室內或仍有氛圍的節奏，不用趕行程。`;
  }
  if (/找咖啡|咖啡/.test(mood)) {
    return `「${name}」跟你剛剛想找咖啡的狀態很合拍，適合坐下來慢慢待一會。`;
  }
  if (/想放空|放鬆/.test(mood)) {
    return `「${name}」蠻符合你想放鬆的節奏，不用排得太滿。`;
  }
  if (/看海/.test(mood)) {
    return `「${name}」適合你想看海、吹吹風的狀態。`;
  }
  return `「${name}」值得停下來感受一下，我們可以從這裡往下細排。`;
}

function followUpSuggestions(mood: string): string {
  const lines = [
    "接下來你可以跟我說：",
    "· 加入行程",
    "· 找附近咖啡廳",
    "· 找附近宵夜",
    "· 查看路線",
  ];
  if (/深夜散步|夜景/.test(mood)) {
    lines.push("· 附近還能散步去哪");
  }
  return lines.join("\n");
}

export function buildPlaceDetailReply(
  place: ChatPlaceItem,
  session: ChatPlanningSession,
): string {
  const name = placeDisplayName(place);
  const mood = session.selectedMood ?? session.mood ?? session.travelContext?.mood ?? "";
  const duration = place.estimatedTime?.trim() || suggestStayDuration(place, mood);
  const reason = place.reason?.trim();

  const lines = [moodFitLine(name, mood)];

  if (reason && !lines[0]!.includes(reason)) {
    lines.push(reason);
  }

  lines.push(
    `如果你要把它放進今晚行程，我會建議停留 ${duration}，後面可以接一間附近咖啡廳或宵夜店。`,
    "",
    followUpSuggestions(mood),
  );

  return lines.join("\n");
}

export function parsePlaceDetailFollowUp(text: string): PlaceDetailFollowUpIntent {
  const t = text.trim();
  if (!t) return "continue_chat";
  if (/(加入行程|加進行程|放進行程|列入行程)/.test(t)) return "add_to_trip";
  if (/(查看路線|看路線|怎麼去|導航)/.test(t)) return "view_route";
  if (/(附近.*咖啡|咖啡廳|咖啡店|找咖啡)/.test(t)) return "nearby_cafe";
  if (/(宵夜|深夜食堂|夜市|附近.*吃)/.test(t)) return "nearby_late_snack";
  return "continue_chat";
}

export function sessionWithPlaceDetailSearchCenter(
  session: ChatPlanningSession,
): ChatPlanningSession {
  const focus = session.placeDetailFocus;
  if (focus?.lat == null || focus.lng == null) return session;
  return {
    ...session,
    location: {
      lat: focus.lat,
      lng: focus.lng,
      city: session.location?.city ?? focus.address ?? undefined,
    },
    preferredArea: placeDisplayName(focus),
  };
}

export function buildPlaceDetailFollowUpReply(
  intent: PlaceDetailFollowUpIntent,
  session: ChatPlanningSession,
): string | null {
  const name = session.placeDetailFocus
    ? placeDisplayName(session.placeDetailFocus)
    : "這個地點";

  switch (intent) {
    case "add_to_trip":
      return `好的，我先把「${name}」記下來。你還想再接咖啡、宵夜，或直接排成今晚的小路線？`;
    case "view_route":
      return `你可以點上方「${name}」卡片裡的查看路線；若要我幫你串下一站，跟我說想接咖啡、宵夜或散步。`;
    case "nearby_cafe":
      return `好，我以「${name}」為中心幫你找附近咖啡廳。`;
    case "nearby_late_snack":
      return `好，我以「${name}」為中心幫你找附近宵夜或小吃。`;
    default:
      return null;
  }
}
