/** 輕量 re-export 層：不含 user-intent / trip-intent，避免 verify 與 runtime 循環載入 */
export { CHAT_PIPELINE_FALLBACK } from "@/lib/chat/chat-pipeline-constants";
export {
  appendAssistantToConversation,
  buildAssistantChatMsg,
  conversationMissingAssistantReply,
  resolveInstantChatReply,
  userAsksDestinationItineraryAdvice,
  type InstantChatReply,
} from "@/lib/chat/chat-instant-reply";
