import { useSyncExternalStore } from "react";
import { toast } from "sonner";
import { CREDITS_RESERVE_STALE_MAX_AGE_MS } from "@/lib/credits/constants";
import { effectiveAppLocale } from "@/lib/i18n/effective-app-locale";
import { translate } from "@/lib/i18n/translate";

/**
 * 行程生成中的全域鎖（A2 第 6 項）。
 *
 * - 狀態只在模組記憶體：聊聊頁卸載不會解鎖；重新載入 App 後不鎖（不寫任何 storage）。
 * - begin／end 比對 owner：舊生成結束不得解除新生成的鎖。同一 owner 巢狀 begin 只計數、不重設計時。
 * - 90 秒設「比平常久」旗標；滿 CREDITS_RESERVE_STALE_MAX_AGE_MS 強制解鎖，
 *   被強制解鎖的 owner 之後再 begin 不會重新上鎖。
 */
export const CHAT_GENERATION_SLOW_AFTER_MS = 90_000;
export const CHAT_GENERATION_FORCE_UNLOCK_MS = CREDITS_RESERVE_STALE_MAX_AGE_MS;

export type ChatGenerationLockState = {
  locked: boolean;
  slow: boolean;
  owner: string | null;
};

const UNLOCKED: ChatGenerationLockState = { locked: false, slow: false, owner: null };

let state: ChatGenerationLockState = UNLOCKED;
let depth = 0;
let slowTimer: ReturnType<typeof setTimeout> | null = null;
let forceTimer: ReturnType<typeof setTimeout> | null = null;
const expiredOwners = new Set<string>();
const listeners = new Set<() => void>();

function emit(next: ChatGenerationLockState) {
  state = next;
  listeners.forEach((fn) => fn());
}

function clearTimers() {
  if (slowTimer != null) clearTimeout(slowTimer);
  if (forceTimer != null) clearTimeout(forceTimer);
  slowTimer = null;
  forceTimer = null;
}

export function beginChatGenerationLock(owner: string): void {
  if (!owner || expiredOwners.has(owner)) return;
  if (state.locked && state.owner === owner) {
    depth += 1;
    return;
  }
  clearTimers();
  depth = 1;
  emit({ locked: true, slow: false, owner });
  slowTimer = setTimeout(() => {
    if (state.owner === owner) emit({ ...state, slow: true });
  }, CHAT_GENERATION_SLOW_AFTER_MS);
  forceTimer = setTimeout(() => {
    if (state.owner !== owner) return;
    console.info("[CHAT_GENERATION_LOCK_FORCE_RELEASED]", {
      afterMs: CHAT_GENERATION_FORCE_UNLOCK_MS,
    });
    expiredOwners.add(owner);
    clearTimers();
    depth = 0;
    emit(UNLOCKED);
  }, CHAT_GENERATION_FORCE_UNLOCK_MS);
}

export function endChatGenerationLock(owner: string): void {
  if (!state.locked || state.owner !== owner) return;
  depth -= 1;
  if (depth > 0) return;
  clearTimers();
  depth = 0;
  emit(UNLOCKED);
}

export function isChatGenerationLocked(): boolean {
  return state.locked;
}

export function getChatGenerationLockState(): ChatGenerationLockState {
  return state;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useChatGenerationLock(): ChatGenerationLockState {
  return useSyncExternalStore(subscribe, getChatGenerationLockState, () => UNLOCKED);
}

/**
 * 其他頁帶入／改寫聊聊狀態的入口共用：鎖住時顯示提示並回傳 true（呼叫端應直接 return，
 * 不寫入聊聊 store、不導向、不送出任何請求）。未鎖時回傳 false、不做任何事。
 */
export function blockIfChatGenerationLocked(message: string): boolean {
  if (!state.locked) return false;
  toast.message(message);
  return true;
}

/** 目前掛載中的聊聊頁數量（判斷使用者是否仍在聊聊頁；只在記憶體）。 */
let mountedChatPages = 0;

export function markChatPageMounted(): () => void {
  mountedChatPages += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    mountedChatPages = Math.max(0, mountedChatPages - 1);
  };
}

export function isChatPageMounted(): boolean {
  return mountedChatPages > 0;
}

/** 顯示提示的當下才取目前語系文案（已卸載聊聊頁的 t 可能是舊語系）。 */
function currentCopy(key: string): string {
  return translate(effectiveAppLocale(), `uiCoverage.${key}`);
}

/** 使用者已不在原對話時的「行程已完成」提示（附「查看」）。 */
export function notifyChatGenerationDone(onView: () => void): void {
  // 通知失敗不得阻斷呼叫端後續的 Credits settle／Session 寫入。
  try {
    toast(currentCopy("chatGenerationDone"), {
      duration: 10000,
      action: {
        label: currentCopy("chatGenerationDoneView"),
        onClick: onView,
      },
    });
  } catch (error) {
    console.warn("[CHAT_GENERATION_NOTIFY_FAILED]", "done", error);
  }
}

/**
 * 使用者已不在原對話時的「行程生成失敗」提示。同一 owner 以固定 id 顯示，
 * 巢狀流程重複呼叫時 sonner 只會更新同一則提示、不會疊加。
 * `reasonKey`（選填）：具體失敗原因的完整 i18n key（例如 `chatRuntime.capacity`），
 * 同樣在顯示當下以目前語系取文案；未提供或查無翻譯時用通用失敗文案。
 */
export function notifyChatGenerationFailed(owner: string, reasonKey?: string): void {
  // 通知失敗不得阻斷呼叫端後續的 Credits settle／Session 寫入。
  try {
    const reason = reasonKey ? translate(effectiveAppLocale(), reasonKey) : "";
    const message = reason && reason !== reasonKey ? reason : currentCopy("chatGenerationFailed");
    toast.error(message, { id: `chat-generation-failed:${owner}` });
  } catch (error) {
    console.warn("[CHAT_GENERATION_NOTIFY_FAILED]", "failed", error);
  }
}
