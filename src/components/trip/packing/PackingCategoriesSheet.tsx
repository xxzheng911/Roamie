import { useState, type KeyboardEvent } from "react";
import { ChevronDown, ChevronUp, Loader2, Plus, Trash2 } from "lucide-react";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { formatTripWorkspaceTemplate, type TripPackingCopy } from "@/lib/i18n/trip-workspace-copy";
import type { PackingCategory } from "@/lib/trip/trip-packing";
import { cn } from "@/lib/utils";
import { PackingIcon } from "./PackingIcon";
import {
  isValidPackingName,
  PACKING_CATEGORY_NAME_MAX,
  PACKING_DEFAULT_ICON,
  PACKING_ICON_KEYS,
  type PackingIconKey,
} from "./packing-model";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  copy: TripPackingCopy;
  categories: PackingCategory[];
  labelOf: (category: PackingCategory) => string;
  /** 排序／新增進行中：停用對應按鈕 */
  reordering: boolean;
  adding: boolean;
  onRename: (category: PackingCategory, name: string) => void;
  onChangeIcon: (category: PackingCategory, iconKey: PackingIconKey) => void;
  onMove: (index: number, direction: -1 | 1) => void;
  onDelete: (category: PackingCategory) => void;
  onAdd: (name: string, iconKey: PackingIconKey) => Promise<boolean>;
};

function isEnter(e: KeyboardEvent<HTMLInputElement>): boolean {
  // 輸入法組字中的 Enter 不送出
  return e.key === "Enter" && !e.nativeEvent.isComposing && e.keyCode !== 229;
}

export function PackingCategoriesSheet(props: Props) {
  const { open, onOpenChange, copy } = props;
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        closeLabel={copy.close}
        className="flex max-h-[92dvh] flex-col rounded-t-[1.75rem] border-0 bg-background px-0 pb-0"
      >
        <SheetTitle className="px-5 text-base font-medium">{copy.categoriesSheetTitle}</SheetTitle>
        <SheetDescription className="px-5 text-xs text-muted-foreground">
          {copy.categoriesSheetHint}
        </SheetDescription>
        <CategoriesEditor {...props} />
      </SheetContent>
    </Sheet>
  );
}

function CategoriesEditor({
  copy,
  categories,
  labelOf,
  reordering,
  adding,
  onRename,
  onChangeIcon,
  onMove,
  onDelete,
  onAdd,
  onOpenChange,
}: Props) {
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);
  const [invalidId, setInvalidId] = useState<string | null>(null);
  const [iconPickerId, setIconPickerId] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [newIcon, setNewIcon] = useState<PackingIconKey>(PACKING_DEFAULT_ICON);
  const [newIconOpen, setNewIconOpen] = useState(false);
  const [newInvalid, setNewInvalid] = useState(false);

  const commitRename = (category: PackingCategory) => {
    if (!editing || editing.id !== category.id) return;
    const text = editing.text;
    setEditing(null);
    if (text.trim() === labelOf(category).trim()) {
      setInvalidId(null);
      return;
    }
    if (!isValidPackingName(text, PACKING_CATEGORY_NAME_MAX)) {
      setInvalidId(category.id);
      return;
    }
    setInvalidId(null);
    onRename(category, text.trim());
  };

  const submitNew = async () => {
    if (adding) return;
    if (!isValidPackingName(newName, PACKING_CATEGORY_NAME_MAX)) {
      setNewInvalid(true);
      return;
    }
    setNewInvalid(false);
    const ok = await onAdd(newName.trim(), newIcon);
    if (ok) {
      setNewName("");
      setNewIcon(PACKING_DEFAULT_ICON);
      setNewIconOpen(false);
    }
  };

  return (
    <>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-4 pt-3">
        <ul className="overflow-hidden rounded-2xl border border-border bg-card">
          {categories.map((c, index) => {
            const label = labelOf(c);
            const value = editing?.id === c.id ? editing.text : label;
            return (
              <li key={c.id} className="border-b border-border px-3 py-2 last:border-0">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    aria-label={copy.iconLabel}
                    aria-expanded={iconPickerId === c.id}
                    onClick={() => setIconPickerId((id) => (id === c.id ? null : c.id))}
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-secondary text-foreground"
                  >
                    <PackingIcon iconKey={c.icon_key} className="h-4 w-4" />
                  </button>
                  <input
                    value={value}
                    aria-label={copy.categoryNameLabel}
                    onFocus={() => setEditing({ id: c.id, text: label })}
                    onChange={(e) => setEditing({ id: c.id, text: e.target.value })}
                    onBlur={() => commitRename(c)}
                    onKeyDown={(e) => {
                      if (isEnter(e)) {
                        e.preventDefault();
                        e.currentTarget.blur();
                      } else if (e.key === "Escape") {
                        setEditing(null);
                      }
                    }}
                    enterKeyHint="done"
                    className="h-9 min-w-0 flex-1 rounded-lg bg-transparent px-1 text-sm text-foreground outline-none focus:bg-secondary"
                  />
                  <button
                    type="button"
                    aria-label={copy.moveUp}
                    disabled={index === 0 || reordering}
                    onClick={() => onMove(index, -1)}
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted-foreground disabled:opacity-30"
                  >
                    <ChevronUp className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    aria-label={copy.moveDown}
                    disabled={index === categories.length - 1 || reordering}
                    onClick={() => onMove(index, 1)}
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted-foreground disabled:opacity-30"
                  >
                    <ChevronDown className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    aria-label={copy.deleteCategory}
                    onClick={() => onDelete(c)}
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-destructive"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
                {invalidId === c.id ? (
                  <p className="mt-1 pl-11 text-xs text-destructive">
                    {copy.validationCategoryName}
                  </p>
                ) : null}
                {iconPickerId === c.id ? (
                  <IconGrid
                    copy={copy}
                    value={c.icon_key}
                    onPick={(key) => {
                      setIconPickerId(null);
                      if (key !== c.icon_key) onChangeIcon(c, key);
                    }}
                  />
                ) : null}
              </li>
            );
          })}
        </ul>

        <section className="mt-4 rounded-2xl border border-dashed border-border px-3 py-2">
          <div className="flex items-center gap-2">
            <button
              type="button"
              aria-label={copy.iconLabel}
              aria-expanded={newIconOpen}
              onClick={() => setNewIconOpen((v) => !v)}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-secondary text-foreground"
            >
              <PackingIcon iconKey={newIcon} className="h-4 w-4" />
            </button>
            <input
              value={newName}
              onChange={(e) => {
                setNewName(e.target.value);
                if (newInvalid) setNewInvalid(false);
              }}
              onKeyDown={(e) => {
                if (isEnter(e)) {
                  e.preventDefault();
                  void submitNew();
                }
              }}
              placeholder={copy.newCategoryPlaceholder}
              aria-label={copy.addCategory}
              enterKeyHint="done"
              className="h-9 min-w-0 flex-1 rounded-lg bg-transparent px-1 text-sm text-foreground outline-none placeholder:text-muted-foreground"
            />
            <button
              type="button"
              onClick={() => void submitNew()}
              disabled={adding}
              className="flex h-8 shrink-0 items-center gap-1 rounded-full bg-secondary px-3 text-xs font-medium text-foreground disabled:opacity-60"
            >
              {adding ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Plus className="h-3.5 w-3.5" />
              )}
              {copy.addCategory}
            </button>
          </div>
          {newInvalid ? (
            <p className="mt-1 pl-11 text-xs text-destructive">{copy.validationCategoryName}</p>
          ) : null}
          {newIconOpen ? (
            <IconGrid
              copy={copy}
              value={newIcon}
              onPick={(key) => {
                setNewIcon(key);
                setNewIconOpen(false);
              }}
            />
          ) : null}
        </section>
      </div>
      <div className="border-t border-border px-5 pb-[calc(env(safe-area-inset-bottom)+1rem)] pt-3">
        <button
          type="button"
          onClick={() => onOpenChange(false)}
          className="flex h-12 w-full items-center justify-center rounded-full bg-primary text-sm font-medium text-primary-foreground"
        >
          {copy.done}
        </button>
      </div>
    </>
  );
}

function IconGrid({
  copy,
  value,
  onPick,
}: {
  copy: TripPackingCopy;
  value: string;
  onPick: (key: PackingIconKey) => void;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={copy.iconLabel}
      className="mt-2 grid grid-cols-8 gap-1.5 pb-1"
    >
      {PACKING_ICON_KEYS.map((key, i) => {
        const selected = key === value;
        return (
          <button
            key={key}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={formatTripWorkspaceTemplate(copy.iconOption, { n: i + 1 })}
            onClick={() => onPick(key)}
            className={cn(
              "flex aspect-square items-center justify-center rounded-full transition",
              selected ? "bg-primary text-primary-foreground" : "bg-secondary text-foreground",
            )}
          >
            <PackingIcon iconKey={key} className="h-4 w-4" />
          </button>
        );
      })}
    </div>
  );
}
