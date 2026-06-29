import { useEffect } from "react";
import { Link } from "@tanstack/react-router";
import { Loader2, Send } from "lucide-react";
import { cn } from "@/lib/utils";
import { logChatComposerRender } from "@/lib/chat-keyboard-layout";
import { isChatKeyboardDebugEnabled, logChatKeyboardDebug } from "@/lib/chat-keyboard-debug";
import {
  CHAT_SHORTCUT_PLAN_LABEL,
  CHAT_SHORTCUT_SEND_CHIPS,
} from "@/lib/chat-shortcut-chips";

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
  streaming: boolean;
  generating: boolean;
  onChipSend: (text: string) => void;
};

function ShortcutChips({
  keyboardOpen,
  generating,
  streaming,
  onChipSend,
}: Pick<
  ChatComposerProps,
  "keyboardOpen" | "generating" | "streaming" | "onChipSend"
>) {
  const chipClass = cn(
    "shrink-0 rounded-full border border-border bg-card text-foreground/80 disabled:opacity-50",
    keyboardOpen ? "px-2.5 py-1 text-[11px]" : "px-3 py-1.5 text-xs",
  );

  return (
    <div className={cn("mb-2 flex gap-2 overflow-x-auto no-scrollbar")}>
      <Link
        to="/plan"
        className={cn(
          "shrink-0 rounded-full border border-dashed border-border bg-card/80 text-muted-foreground",
          keyboardOpen ? "px-2.5 py-1 text-[11px]" : "px-3 py-1.5 text-xs",
        )}
      >
        {CHAT_SHORTCUT_PLAN_LABEL}
      </Link>
      {CHAT_SHORTCUT_SEND_CHIPS.map((label) => (
        <button
          key={label}
          type="button"
          onClick={() => onChipSend(label)}
          disabled={streaming || generating}
          className={chipClass}
        >
          {label}
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
    <div className="chat-input-row flex items-end gap-2 rounded-3xl border border-border bg-card p-2">
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
  const { showShortcutChips, keyboardOpen } = props;

  useEffect(() => {
    if (!isChatKeyboardDebugEnabled()) return;
    logChatComposerRender();
  }, []);

  useEffect(() => {
    if (!isChatKeyboardDebugEnabled()) return;
    logChatKeyboardDebug("[Shortcut Chips Visible]", showShortcutChips);
  }, [showShortcutChips]);

  return (
    <div
      className={cn(
        "chat-composer border-t border-border bg-background/95 px-4 pt-2 backdrop-blur",
        keyboardOpen && "pb-0",
      )}
    >
      {showShortcutChips ? <ShortcutChips {...props} /> : null}
      <InputRow {...props} />
    </div>
  );
}
