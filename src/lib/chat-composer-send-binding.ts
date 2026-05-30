/** iOS WKWebView：React 合成事件常失效，用原生 touchend + 座標 hit-test 綁定聊聊送出 */
export function bindChatComposerSendHandlers(params: {
  shell: HTMLElement;
  getDraft: () => string;
  onSend: (text: string, source: string) => void;
}): () => void {
  const { shell, getDraft, onSend } = params;

  const findSendButton = (): HTMLElement | null =>
    shell.querySelector("[data-chat-send-btn]");

  const fireSend = (source: string) => {
    console.info("[CHAT_TOUCH] trySend", source);
    const trimmed = getDraft().trim();
    console.info("[CHAT_SEND]", { source, text: trimmed.slice(0, 80) });
    if (!trimmed) {
      console.info("[CHAT_SEND] blocked=empty", source);
      return;
    }
    console.info("[CHAT_SUBMIT_START]", source);
    onSend(trimmed, source);
  };

  const isPointInSendButton = (x: number, y: number): boolean => {
    const btn = findSendButton();
    if (!btn) return false;
    const r = btn.getBoundingClientRect();
    const pad = 8;
    return x >= r.left - pad && x <= r.right + pad && y >= r.top - pad && y <= r.bottom + pad;
  };

  const onTouchEnd = (e: TouchEvent) => {
    const t = e.changedTouches[0];
    if (!t) return;
    if (!isPointInSendButton(t.clientX, t.clientY)) return;
    e.preventDefault();
    e.stopPropagation();
    fireSend("touch-rect");
  };

  const onClick = (e: MouseEvent) => {
    const target = e.target;
    if (!(target instanceof Element)) return;
    if (!target.closest("[data-chat-send-btn]")) return;
    e.preventDefault();
    e.stopPropagation();
    fireSend("native-click");
  };

  const onKeyDown = (e: KeyboardEvent) => {
    const target = e.target;
    if (!(target instanceof HTMLTextAreaElement)) return;
    if (!target.closest(".chat-composer")) return;
    if (e.key !== "Enter" || e.shiftKey) return;
    e.preventDefault();
    fireSend("native-enter");
  };

  shell.addEventListener("touchend", onTouchEnd, { capture: true, passive: false });
  shell.addEventListener("click", onClick, { capture: true });
  shell.addEventListener("keydown", onKeyDown, { capture: true });

  return () => {
    shell.removeEventListener("touchend", onTouchEnd, { capture: true });
    shell.removeEventListener("click", onClick, { capture: true });
    shell.removeEventListener("keydown", onKeyDown, { capture: true });
  };
}
