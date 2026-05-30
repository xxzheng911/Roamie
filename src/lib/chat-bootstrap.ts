import type { ChatMsg } from "@/lib/chat-history";
import { loadChatHistory } from "@/lib/chat-history";
import {
  applyPersistedContextToSession,
  loadConversationContext,
} from "@/lib/conversation-context-store";
import { rehydrateSessionFromMessages } from "@/lib/ai/conversation-context";
import type { ChatPlanningSession } from "@/lib/chat-session";

/**
 * Login bootstrap order:
 * 1. Supabase conversation_context
 * 2. chat_messages history
 * 3. Merge parser state from messages into session
 */
export async function bootstrapChatFromSupabase(
  localSession: ChatPlanningSession,
): Promise<{ session: ChatPlanningSession; history: ChatMsg[] }> {
  const row = await loadConversationContext();
  let session = localSession;
  if (row) {
    session = applyPersistedContextToSession(session, row);
    console.info("[conversation_context] loaded", { destination: row.destination });
  }

  const history = await loadChatHistory();
  if (history.length > 0) {
    session = rehydrateSessionFromMessages(session, history);
    if (row) {
      session = applyPersistedContextToSession(session, row);
    }
  }

  return { session, history };
}
