import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from "react";
import { subscribeChatKeyboardLayout } from "@/lib/chat-keyboard-listeners";
import {
  logChatComposerBottomUpdated,
  resolveChatComposerFixedBottomPx,
  resolveChatMessagesPaddingBottomPx,
} from "@/lib/chat-keyboard-layout";

export function logKeyboardHeightChanged(
  open: boolean,
  height: number,
  prev: { visible: boolean; height: number },
): void {
  console.info("[KEYBOARD_HEIGHT_CHANGED]", { open, height, prev });
}

export function logChatInputFocused(): void {
  console.info("[CHAT_INPUT_FOCUSED]");
}

type Options = {
  /** 保留供父層綁定 ref；不再用 ResizeObserver 量測 */
  bottomComposerRef: RefObject<HTMLDivElement | null>;
};

/**
 * 聊天頁鍵盤：透過 subscribeChatKeyboardLayout 單例 listener，避免重複 addListener。
 */
export function useChatKeyboardLayout(_options: Options) {
  const [keyboardVisible, setKeyboardVisible] = useState(false);
  const [keyboardHeightPx, setKeyboardHeightPx] = useState(0);

  const layoutRef = useRef({ visible: false, height: 0 });

  const composerFixedBottomPx = useMemo(
    () => resolveChatComposerFixedBottomPx(keyboardVisible, keyboardHeightPx),
    [keyboardVisible, keyboardHeightPx],
  );

  const messagesPaddingBottomPx = useMemo(
    () =>
      resolveChatMessagesPaddingBottomPx({
        keyboardVisible,
        keyboardHeightPx,
      }),
    [keyboardVisible, keyboardHeightPx],
  );

  const layoutLogRef = useRef("");
  useEffect(() => {
    const key = `${keyboardVisible}|${keyboardHeightPx}|${composerFixedBottomPx}|${messagesPaddingBottomPx}`;
    if (layoutLogRef.current === key) return;
    layoutLogRef.current = key;
    logChatComposerBottomUpdated({
      keyboardVisible,
      keyboardHeightPx,
      composerFixedBottomPx,
      messagesPaddingBottomPx,
    });
  }, [
    keyboardVisible,
    keyboardHeightPx,
    composerFixedBottomPx,
    messagesPaddingBottomPx,
  ]);

  const applyKeyboard = useCallback((reportedHeight: number, open: boolean) => {
    const roundedHeight = Math.max(0, Math.round(reportedHeight));
    const prev = layoutRef.current;
    if (prev.visible === open && prev.height === roundedHeight) return;

    layoutRef.current = { visible: open, height: roundedHeight };
    logKeyboardHeightChanged(open, roundedHeight, prev);

    setKeyboardVisible((v) => (v === open ? v : open));
    setKeyboardHeightPx((h) => (h === roundedHeight ? h : roundedHeight));
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle("chat-keyboard-open", keyboardVisible);
    return () => {
      document.documentElement.classList.remove("chat-keyboard-open");
    };
  }, [keyboardVisible]);

  useEffect(() => {
    return subscribeChatKeyboardLayout(({ height, open }) => {
      applyKeyboard(height, open);
    });
  }, [applyKeyboard]);

  const notifyInputFocused = useCallback(() => {
    logChatInputFocused();
  }, []);

  return {
    keyboardVisible,
    keyboardHeightPx,
    composerFixedBottomPx,
    messagesPaddingBottomPx,
    notifyInputFocused,
  };
}
