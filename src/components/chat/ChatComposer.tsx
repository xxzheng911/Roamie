import { memo, useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Send, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

export type ChatComposerProps = {
  /** 僅在點擊送出時呼叫；不在 onChange 觸發 */
  onSend: (text: string) => void;
  onFocus?: () => void;
  /** 僅 AI streaming / generating 時為 true，與鍵盤無關 */
  disabled: boolean;
  inputRef: React.RefObject<HTMLTextAreaElement | null>;
  showShortcutChips: boolean;
  keyboardOpen: boolean;
  showGenerateBtn: boolean;
  generating: boolean;
  streaming: boolean;
  showSaveTripBtn: boolean;
  hasDraftTrip: boolean;
  lastGeneratedTripId?: string;
  chatChips: string[];
  onChipSend: (chipId: string) => void;
  onAdvancedPlanning: () => void;
  onGenerateClick: () => void;
  onSaveTrip: () => void;
  onViewDraft: () => void;
  onViewSavedTrip: (tripId: string) => void;
};

const CHIP_DEBOUNCE_MS = 120;

const ShortcutChips = memo(function ShortcutChips({
  keyboardOpen,
  showGenerateBtn,
  generating,
  streaming,
  showSaveTripBtn,
  hasDraftTrip,
  lastGeneratedTripId,
  chatChips,
  onChipSend,
  onAdvancedPlanning,
  onGenerateClick,
  onSaveTrip,
  onViewDraft,
  onViewSavedTrip,
}: Pick<
  ChatComposerProps,
  | "keyboardOpen"
  | "showGenerateBtn"
  | "generating"
  | "streaming"
  | "showSaveTripBtn"
  | "hasDraftTrip"
  | "lastGeneratedTripId"
  | "chatChips"
  | "onChipSend"
  | "onAdvancedPlanning"
  | "onGenerateClick"
  | "onSaveTrip"
  | "onViewDraft"
  | "onViewSavedTrip"
>) {
  const [activeChip, setActiveChip] = useState<string | null>(null);
  const lastChipFireRef = useRef(0);

  useEffect(() => {
    if (!streaming && !generating && activeChip) {
      const t = window.setTimeout(() => setActiveChip(null), 280);
      return () => window.clearTimeout(t);
    }
  }, [streaming, generating, activeChip]);

  const chipClass = (chipId: string) => {
    const isActive = activeChip === chipId;
    const isLoading = isActive && (streaming || generating);
    return cn(
      "shrink-0 touch-manipulation rounded-full border border-border bg-card text-foreground/80 transition-all",
      "hover:border-foreground/20 hover:bg-secondary/70 active:scale-95 disabled:pointer-events-none disabled:opacity-50",
      keyboardOpen ? "px-2.5 py-1 text-[11px]" : "px-3 py-1.5 text-xs",
      isActive && "scale-[0.97] border-primary/50 bg-primary/12 text-foreground shadow-sm",
      isLoading && "opacity-90",
    );
  };

  const visibleChips = keyboardOpen ? chatChips.slice(0, 3) : chatChips;

  const fireChip = useCallback(
    (chipId: string) => {
      const now = Date.now();
      if (now - lastChipFireRef.current < CHIP_DEBOUNCE_MS) return;
      lastChipFireRef.current = now;
      console.log("[CHAT_CHIP_CLICK]", chipId);
      setActiveChip(chipId);
      onChipSend(chipId);
    },
    [onChipSend],
  );

  const fireAdvancedPlanning = useCallback(() => {
    const chipId = "進階手動規劃";
    const now = Date.now();
    if (now - lastChipFireRef.current < CHIP_DEBOUNCE_MS) return;
    lastChipFireRef.current = now;
    console.log("[CHAT_CHIP_CLICK]", chipId);
    setActiveChip(chipId);
    onAdvancedPlanning();
  }, [onAdvancedPlanning]);

  return (
    <div
      className={cn(
        "relative z-20 flex gap-2 overflow-x-auto no-scrollbar",
        keyboardOpen ? "mb-1" : "mb-2",
      )}
      style={{ touchAction: "manipulation" }}
    >
      {showGenerateBtn ? (
        <button
          type="button"
          onClick={onGenerateClick}
          disabled={generating || streaming}
          className={cn(
            "shrink-0 rounded-full bg-primary font-medium text-primary-foreground disabled:opacity-50",
            keyboardOpen ? "px-2.5 py-1 text-[11px]" : "px-3 py-1.5 text-xs",
          )}
        >
          {generating ? (
            <Loader2 className="mr-1 inline h-3 w-3 animate-spin" />
          ) : (
            <Sparkles className="mr-1 inline h-3 w-3" />
          )}
          開始安排行程
        </button>
      ) : null}
      {showSaveTripBtn ? (
        <button
          type="button"
          onClick={onSaveTrip}
          className={cn(
            "shrink-0 rounded-full bg-primary font-medium text-primary-foreground",
            keyboardOpen ? "px-2.5 py-1 text-[11px]" : "px-3 py-1.5 text-xs",
          )}
        >
          儲存這趟行程
        </button>
      ) : null}
      {hasDraftTrip ? (
        <button type="button" onClick={onViewDraft} className={chipClass("draft")}>
          查看行程草稿
        </button>
      ) : null}
      {lastGeneratedTripId ? (
        <button
          type="button"
          onClick={() => onViewSavedTrip(lastGeneratedTripId)}
          className={chipClass("saved-trip")}
        >
          查看已儲存行程
        </button>
      ) : null}
      <button
        type="button"
        onClick={fireAdvancedPlanning}
        disabled={streaming || generating}
        className={cn(
          chipClass("進階手動規劃"),
          "border-dashed bg-card/80 text-muted-foreground",
        )}
      >
        進階手動規劃
      </button>
      {visibleChips.map((s) => {
        const isActive = activeChip === s;
        const isLoading = isActive && (streaming || generating);
        return (
          <button
            key={s}
            type="button"
            onClick={() => fireChip(s)}
            disabled={(streaming || generating) && !isActive}
            aria-busy={isLoading}
            className={chipClass(s)}
          >
            {isLoading ? (
              <Loader2 className="mr-1 inline h-3 w-3 animate-spin" />
            ) : null}
            {s}
          </button>
        );
      })}
    </div>
  );
});

const ComposerInputRow = memo(function ComposerInputRow({
  onSend,
  onFocus,
  disabled,
  streaming,
  generating,
  inputRef,
}: Pick<ChatComposerProps, "onSend" | "onFocus" | "disabled" | "streaming" | "generating" | "inputRef">) {
  const [hasText, setHasText] = useState(false);
  const composingRef = useRef(false);
  const lastSendRef = useRef(0);

  const readTrimmed = useCallback(() => inputRef.current?.value.trim() ?? "", [inputRef]);

  const syncHasText = useCallback((value: string) => {
    setHasText(value.trim().length > 0);
  }, []);

  const handleInput = useCallback(
    (e: React.FormEvent<HTMLTextAreaElement>) => {
      const value = e.currentTarget.value;
      syncHasText(value);
    },
    [syncHasText],
  );

  const submit = useCallback(() => {
    if (composingRef.current) return;
    const trimmed = readTrimmed();
    const sendDisabled = disabled || !trimmed;
    console.log("[CHAT_SEND]", trimmed);
    if (sendDisabled) return;

    const now = Date.now();
    if (now - lastSendRef.current < CHIP_DEBOUNCE_MS) return;
    lastSendRef.current = now;

    console.log("[CHAT_SUBMIT_START]");
    onSend(trimmed);

    if (inputRef.current) {
      inputRef.current.value = "";
    }
    setHasText(false);
  }, [disabled, inputRef, onSend, readTrimmed]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Escape") {
        e.currentTarget.blur();
        return;
      }
      if (e.key === "Enter" && !e.shiftKey && !composingRef.current) {
        e.preventDefault();
        submit();
      }
    },
    [submit],
  );

  const sendDisabled = disabled || !hasText;

  return (
    <form
      className="flex items-end gap-2 rounded-3xl border border-border bg-card p-2"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <textarea
        ref={inputRef}
        defaultValue=""
        onInput={handleInput}
        onChange={handleInput}
        onCompositionStart={() => {
          composingRef.current = true;
        }}
        onCompositionEnd={(e) => {
          composingRef.current = false;
          syncHasText(e.currentTarget.value);
        }}
        onKeyDown={handleKeyDown}
        onFocus={onFocus}
        rows={1}
        placeholder="告訴 Roamie 你的心情…"
        autoComplete="off"
        autoCorrect="on"
        spellCheck={false}
        enterKeyHint="send"
        className="flex-1 resize-none bg-transparent px-3 py-2 text-[15px] placeholder:text-muted-foreground focus:outline-none disabled:opacity-60"
        disabled={disabled}
        aria-label="輸入訊息"
      />
      <button
        type="submit"
        onPointerUp={(e) => {
          if (e.button !== 0 || sendDisabled) return;
          e.preventDefault();
          submit();
        }}
        disabled={sendDisabled}
        className="flex h-10 w-10 shrink-0 touch-manipulation items-center justify-center rounded-full bg-primary text-primary-foreground disabled:opacity-50"
        aria-label="送出"
      >
        {streaming || generating ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Send className="h-4 w-4" />
        )}
      </button>
    </form>
  );
});

/** 快捷 chips + 輸入列；輸入狀態保留於此層，避免父層 Chat 每次按鍵 re-render */
export const ChatComposer = memo(function ChatComposer(props: ChatComposerProps) {
  const { showShortcutChips } = props;

  useEffect(() => {
    console.info("[CHAT_COMPOSER] mounted");
    return () => {
      console.info("[CHAT_COMPOSER] unmounted");
    };
  }, []);

  return (
    <div
      className="chat-composer relative z-50 border-t border-border bg-background/95 px-4 pt-2 backdrop-blur"
      style={{ touchAction: "manipulation" }}
    >
      {showShortcutChips ? <ShortcutChips {...props} /> : null}
      <ComposerInputRow
        onSend={props.onSend}
        onFocus={props.onFocus}
        disabled={props.disabled}
        streaming={props.streaming}
        generating={props.generating}
        inputRef={props.inputRef}
      />
    </div>
  );
});
