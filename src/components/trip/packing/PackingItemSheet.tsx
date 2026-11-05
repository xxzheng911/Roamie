import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { Loader2, Minus, Plus, Trash2 } from "lucide-react";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { subscribeCapacitorKeyboard } from "@/lib/capacitor-keyboard-bridge";
import {
  isCapacitorNativeShell,
  measureVisualViewportKeyboardInset,
} from "@/lib/chat-keyboard-layout";
import type { TripPackingCopy } from "@/lib/i18n/trip-workspace-copy";
import type { PackingCategory, PackingItem, PackingItemPatch } from "@/lib/trip/trip-packing";
import { cn } from "@/lib/utils";
import { PackingIcon } from "./PackingIcon";
import {
  charLength,
  isValidPackingName,
  PACKING_ITEM_NAME_MAX,
  PACKING_ITEM_NOTE_MAX,
  PACKING_QUANTITY_MAX,
  PACKING_QUANTITY_MIN,
} from "./packing-model";

const NOTE_MAX_HEIGHT_PX = 100;

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  copy: TripPackingCopy;
  /** 每次開啟遞增：重建表單 */
  sessionKey: number;
  /** 衝突後載入最新版本時遞增：以最新資料重建表單 */
  formKey: number;
  conflictNotice: boolean;
  item: PackingItem | null;
  categories: PackingCategory[];
  labelOf: (category: PackingCategory) => string;
  saving: boolean;
  deleting: boolean;
  onSave: (item: PackingItem, patch: PackingItemPatch) => void;
  onDelete: (item: PackingItem) => void;
};

function isTextEntry(el: EventTarget | Element | null): el is HTMLElement {
  return el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement;
}

/** 只捲動表單內容區（不用 scrollIntoView，避免連帶捲動 WebView／視窗），讓欄位與其 label 都在可見範圍 */
function revealInScroller(el: HTMLElement) {
  const scroller = el.closest<HTMLElement>("[data-packing-scroll]");
  if (!scroller) return;
  const margin = 12;
  const box = scroller.getBoundingClientRect();
  if (box.height <= 0) return;
  const top = (el.closest("label") ?? el).getBoundingClientRect().top;
  const bottom = el.getBoundingClientRect().bottom;
  if (top < box.top + margin) {
    scroller.scrollTop -= box.top + margin - top;
  } else if (bottom > box.bottom - margin) {
    // 往下捲，但不讓 label 被推出上緣
    scroller.scrollTop += Math.min(bottom - (box.bottom - margin), top - (box.top + margin));
  }
}

export function PackingItemSheet(props: Props) {
  const { open, onOpenChange, copy, item } = props;
  // 與 ExpenseSheet 相同：Capacitor Keyboard 為 resize: "none"，鍵盤開啟時把 Sheet 底部移到鍵盤上緣，
  // 最大高度改為「可視高度 − 鍵盤 − 上方安全區」。WebView 若已因鍵盤縮小，只補尚未縮掉的差額。
  const [keyboardInsetPx, setKeyboardInsetPx] = useState(0);
  const [viewportH, setViewportH] = useState(0);
  const baseViewportHRef = useRef(0);
  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) {
      setKeyboardInsetPx(0);
      return;
    }
    baseViewportHRef.current = window.innerHeight;
    setViewportH(window.innerHeight);
    const onWinResize = () => {
      // 基準高度只增不減：WebView 可能比 keyboardWillShow 先縮，不可把縮後高度當基準（會重複墊高）
      baseViewportHRef.current = Math.max(baseViewportHRef.current, window.innerHeight);
      setViewportH(window.innerHeight);
    };
    window.addEventListener("resize", onWinResize);
    const isNative = isCapacitorNativeShell();
    const applyInset = (px: number) => {
      const next = Math.max(0, Math.round(px));
      if (next <= 0)
        baseViewportHRef.current = Math.max(baseViewportHRef.current, window.innerHeight);
      setViewportH(window.innerHeight);
      setKeyboardInsetPx(next);
    };
    const removeCap = isNative
      ? subscribeCapacitorKeyboard({ onShow: applyInset, onHide: () => applyInset(0) })
      : null;

    const vv = window.visualViewport;
    const onVv = () => {
      if (isNative || !vv) return;
      const inset = Math.min(
        measureVisualViewportKeyboardInset(),
        Math.round(window.innerHeight * 0.55),
      );
      applyInset(inset > 50 ? inset : 0);
    };
    vv?.addEventListener("resize", onVv);
    vv?.addEventListener("scroll", onVv);
    onVv();

    return () => {
      removeCap?.();
      window.removeEventListener("resize", onWinResize);
      vv?.removeEventListener("resize", onVv);
      vv?.removeEventListener("scroll", onVv);
    };
  }, [open]);

  // 鍵盤高度生效後，把正在輸入的欄位捲到可見範圍
  useEffect(() => {
    if (keyboardInsetPx <= 0) return;
    const el = document.activeElement;
    if (!isTextEntry(el) || !contentRef.current?.contains(el)) return;
    const raf = requestAnimationFrame(() => revealInScroller(el));
    return () => cancelAnimationFrame(raf);
  }, [keyboardInsetPx, viewportH]);

  const viewportShrinkPx = Math.max(0, baseViewportHRef.current - viewportH);
  const keyboardBottomPx = Math.max(0, keyboardInsetPx - viewportShrinkPx);
  const keyboardStyle: CSSProperties | undefined =
    keyboardInsetPx > 0
      ? {
          bottom: keyboardBottomPx,
          maxHeight: `min(92dvh, calc(${Math.max(0, viewportH - keyboardBottomPx)}px - env(safe-area-inset-top, 0px) - 0.5rem))`,
        }
      : undefined;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        ref={contentRef}
        side="bottom"
        closeLabel={copy.close}
        className="group/packing flex max-h-[92dvh] flex-col rounded-t-[1.75rem] border-0 bg-background px-0 pb-0"
        style={keyboardStyle}
        data-keyboard-open={keyboardInsetPx > 0 ? "" : undefined}
        onFocusCapture={(e) => {
          const el = e.target;
          if (!isTextEntry(el)) return;
          requestAnimationFrame(() => revealInScroller(el));
        }}
      >
        <SheetTitle className="px-5 text-base font-medium">{copy.itemSheetTitle}</SheetTitle>
        <SheetDescription className="sr-only">{item?.name ?? copy.itemSheetTitle}</SheetDescription>
        {item ? (
          <ItemForm key={`${props.sessionKey}:${props.formKey}`} {...props} item={item} />
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

function ItemForm({
  copy,
  item,
  categories,
  labelOf,
  conflictNotice,
  saving,
  deleting,
  onSave,
  onDelete,
}: Props & { item: PackingItem }) {
  const [name, setName] = useState(item.name);
  const [quantity, setQuantity] = useState(item.quantity);
  const [categoryId, setCategoryId] = useState(item.category_id);
  const [note, setNote] = useState(item.note ?? "");
  const [submitted, setSubmitted] = useState(false);
  // 備註單行起始（「選填」垂直置中），輸入多行時自動長高
  const noteRef = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const el = noteRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, NOTE_MAX_HEIGHT_PX)}px`;
  }, [note]);

  const nameValid = isValidPackingName(name, PACKING_ITEM_NAME_MAX);
  const noteValid = charLength(note.trim()) <= PACKING_ITEM_NOTE_MAX;
  const busy = saving || deleting;

  const submit = () => {
    setSubmitted(true);
    if (!nameValid || !noteValid || busy) return;
    const patch: PackingItemPatch = {};
    const trimmed = name.trim();
    if (trimmed !== item.name) patch.name = trimmed;
    if (quantity !== item.quantity) patch.quantity = quantity;
    const nextNote = note.trim() ? note.trim() : null;
    if (nextNote !== (item.note ?? null)) patch.note = nextNote;
    if (categoryId !== item.category_id) patch.category_id = categoryId;
    onSave(item, patch);
  };

  return (
    <>
      <div
        data-packing-scroll
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-4 pt-4"
      >
        {conflictNotice ? (
          <p
            role="status"
            className="mb-3 rounded-xl bg-secondary px-3 py-2 text-xs text-foreground"
          >
            {copy.conflictReloaded}
          </p>
        ) : null}

        <label className="block">
          <span className="text-xs text-muted-foreground">{copy.nameLabel}</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={PACKING_ITEM_NAME_MAX * 2}
            className="mt-1 h-10 w-full rounded-xl bg-secondary px-3 text-sm text-foreground outline-none placeholder:text-muted-foreground"
          />
        </label>
        {submitted && !nameValid ? (
          <p className="mt-1 text-xs text-destructive">{copy.validationName}</p>
        ) : null}

        <div className="mt-4">
          <span className="text-xs text-muted-foreground">{copy.quantityLabel}</span>
          <div className="mt-1 flex items-center gap-3">
            <button
              type="button"
              aria-label={copy.quantityDecrease}
              disabled={quantity <= PACKING_QUANTITY_MIN}
              onClick={() => setQuantity((q) => Math.max(PACKING_QUANTITY_MIN, q - 1))}
              className="flex h-9 w-9 items-center justify-center rounded-full bg-secondary text-foreground disabled:opacity-40"
            >
              <Minus className="h-4 w-4" />
            </button>
            <span className="min-w-8 text-center text-base font-medium tabular-nums text-foreground">
              {quantity}
            </span>
            <button
              type="button"
              aria-label={copy.quantityIncrease}
              disabled={quantity >= PACKING_QUANTITY_MAX}
              onClick={() => setQuantity((q) => Math.min(PACKING_QUANTITY_MAX, q + 1))}
              className="flex h-9 w-9 items-center justify-center rounded-full bg-secondary text-foreground disabled:opacity-40"
            >
              <Plus className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="mt-4">
          <span className="text-xs text-muted-foreground">{copy.categoryLabel}</span>
          <div
            role="radiogroup"
            aria-label={copy.categoryLabel}
            className="mt-1 flex flex-wrap gap-2"
          >
            {categories.map((c) => {
              const selected = c.id === categoryId;
              return (
                <button
                  key={c.id}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  onClick={() => setCategoryId(c.id)}
                  className={cn(
                    "flex max-w-full items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition",
                    selected
                      ? "bg-primary text-primary-foreground"
                      : "bg-secondary text-foreground",
                  )}
                >
                  <PackingIcon iconKey={c.icon_key} className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate">{labelOf(c)}</span>
                </button>
              );
            })}
          </div>
        </div>

        <label className="mt-4 block">
          <span className="text-xs text-muted-foreground">{copy.noteLabel}</span>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={copy.notePlaceholder}
            rows={1}
            ref={noteRef}
            className="mt-1 block min-h-10 w-full resize-none overflow-y-auto rounded-xl bg-secondary px-3 py-2.5 text-sm leading-5 text-foreground outline-none placeholder:text-muted-foreground"
            style={{ maxHeight: NOTE_MAX_HEIGHT_PX }}
          />
        </label>
        {!noteValid ? <p className="mt-1 text-xs text-destructive">{copy.validationNote}</p> : null}

        <button
          type="button"
          onClick={() => onDelete(item)}
          disabled={busy}
          className="mt-6 flex h-11 w-full items-center justify-center gap-2 rounded-full bg-destructive/10 text-sm font-medium text-destructive disabled:opacity-60"
        >
          {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
          {deleting ? copy.deleting : copy.delete}
        </button>
      </div>
      <div className="border-t border-border px-5 pb-[calc(env(safe-area-inset-bottom)+1rem)] pt-3 group-data-[keyboard-open]/packing:pb-3">
        <button
          type="button"
          onClick={submit}
          disabled={busy}
          className="flex h-12 w-full items-center justify-center gap-2 rounded-full bg-primary text-sm font-medium text-primary-foreground disabled:opacity-60"
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          {saving ? copy.saving : copy.save}
        </button>
      </div>
    </>
  );
}
