import { useState } from "react";
import { Loader2, Minus, Plus, Trash2 } from "lucide-react";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
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

export function PackingItemSheet(props: Props) {
  const { open, onOpenChange, copy, item } = props;
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        closeLabel={copy.close}
        className="flex max-h-[92dvh] flex-col rounded-t-[1.75rem] border-0 bg-background px-0 pb-0"
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
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-4 pt-4">
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
            rows={2}
            className="mt-1 w-full resize-none rounded-xl bg-secondary px-3 py-2 text-sm text-foreground outline-none placeholder:text-muted-foreground"
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
      <div className="border-t border-border px-5 pb-[calc(env(safe-area-inset-bottom)+1rem)] pt-3">
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
