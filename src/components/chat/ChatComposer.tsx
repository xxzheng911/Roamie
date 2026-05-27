import { useEffect } from "react";
import { Link } from "@tanstack/react-router";
import { Loader2, Send, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { logChatComposerRender } from "@/lib/chat-keyboard-layout";

export type ChatComposerProps = {
  text: string;
  onTextChange: (value: string) => void;
  onSend: () => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  onFocus: () => void;
  disabled: boolean;
  showShortcutChips: boolean;
  keyboardOpen: boolean;
  inputRef: React.RefObject<HTMLTextAreaElement | null>;
  showGenerateBtn: boolean;
  generating: boolean;
  streaming: boolean;
  showSaveTripBtn: boolean;
  hasDraftTrip: boolean;
  lastGeneratedTripId?: string;
  chatChips: string[];
  onChipSend: (text: string) => void;
  onGenerateClick: () => void;
  onSaveTrip: () => void;
  onViewDraft: () => void;
  onViewSavedTrip: (tripId: string) => void;
};

function ShortcutChips({
  keyboardOpen,
  showGenerateBtn,
  generating,
  streaming,
  showSaveTripBtn,
  hasDraftTrip,
  lastGeneratedTripId,
  chatChips,
  onChipSend,
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
  | "onGenerateClick"
  | "onSaveTrip"
  | "onViewDraft"
  | "onViewSavedTrip"
>) {
  const chipClass = cn(
    "shrink-0 rounded-full border border-border bg-card text-foreground/80 disabled:opacity-50",
    keyboardOpen ? "px-2.5 py-1 text-[11px]" : "px-3 py-1.5 text-xs",
  );

  return (
    <div
      className={cn(
        "flex gap-2 overflow-x-auto no-scrollbar",
        keyboardOpen ? "mb-1" : "mb-2",
      )}
    >
      {showGenerateBtn && (
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
      )}
      {showSaveTripBtn && (
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
      )}
      {hasDraftTrip && (
        <button type="button" onClick={onViewDraft} className={chipClass}>
          查看行程草稿
        </button>
      )}
      {lastGeneratedTripId && (
        <button
          type="button"
          onClick={() => onViewSavedTrip(lastGeneratedTripId)}
          className={chipClass}
        >
          查看已儲存行程
        </button>
      )}
      <Link
        to="/plan"
        className={cn(
          "shrink-0 rounded-full border border-dashed border-border bg-card/80 text-muted-foreground",
          keyboardOpen ? "px-2.5 py-1 text-[11px]" : "px-3 py-1.5 text-xs",
        )}
      >
        進階手動規劃
      </Link>
      {(keyboardOpen ? chatChips.slice(0, 3) : chatChips).map((s) => (
        <button
          key={s}
          type="button"
          onClick={() => onChipSend(s)}
          disabled={streaming || generating}
          className={chipClass}
        >
          {s}
        </button>
      ))}
    </div>
  );
}

function InputRow({
  text,
  onTextChange,
  onSend,
  onKeyDown,
  onFocus,
  disabled,
  streaming,
  generating,
  inputRef,
}: Pick<
  ChatComposerProps,
  | "text"
  | "onTextChange"
  | "onSend"
  | "onKeyDown"
  | "onFocus"
  | "disabled"
  | "streaming"
  | "generating"
  | "inputRef"
>) {
  return (
    <div className="flex items-end gap-2 rounded-3xl border border-border bg-card p-2">
      <textarea
        ref={inputRef}
        value={text}
        onChange={(e) => onTextChange(e.target.value)}
        onKeyDown={onKeyDown}
        onFocus={onFocus}
        rows={1}
        placeholder="告訴 Roamie 你的心情…"
        className="flex-1 resize-none bg-transparent px-3 py-2 text-[15px] placeholder:text-muted-foreground focus:outline-none"
        disabled={disabled}
      />
      <button
        type="button"
        onClick={onSend}
        disabled={disabled || !text.trim()}
        className="flex h-10 w-10 items-center justify-center rounded-full bg-primary text-primary-foreground disabled:opacity-50"
        aria-label="送出"
      >
        {streaming || generating ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Send className="h-4 w-4" />
        )}
      </button>
    </div>
  );
}

/** 快捷 chips + 輸入列，作為單一 composer 單元（勿在此層疊 keyboard margin） */
export function ChatComposer(props: ChatComposerProps) {
  const { showShortcutChips } = props;

  useEffect(() => {
    logChatComposerRender();
  }, []);

  useEffect(() => {
    console.info("[Shortcut Chips Visible]", showShortcutChips);
  }, [showShortcutChips]);

  return (
    <div className="chat-composer border-t border-border bg-background/95 px-4 pt-2 backdrop-blur">
      {showShortcutChips ? <ShortcutChips {...props} /> : null}
      <InputRow {...props} />
    </div>
  );
}
