import { useState } from "react";
import { Loader2 } from "lucide-react";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  formatTripWorkspaceCount,
  formatTripWorkspaceTemplate,
  type TripPackingCopy,
} from "@/lib/i18n/trip-workspace-copy";
import type { PackingCategory } from "@/lib/trip/trip-packing";
import { cn } from "@/lib/utils";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  copy: TripPackingCopy;
  category: PackingCategory | null;
  label: string;
  itemCount: number;
  /** 可作為移動目標的其餘分類（已排序） */
  targets: PackingCategory[];
  defaultTargetId: string | null;
  labelOf: (category: PackingCategory) => string;
  busy: boolean;
  onDeleteEmpty: () => void;
  onDeleteMove: (targetId: string) => void;
  onDeleteAll: () => void;
};

export function DeletePackingCategoryDialog(props: Props) {
  const { open, onOpenChange, category } = props;
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="max-w-[min(32rem,calc(100vw-2rem))] overflow-x-hidden rounded-2xl">
        {category ? <DialogBody key={category.id} {...props} /> : null}
      </AlertDialogContent>
    </AlertDialog>
  );
}

function DialogBody({
  copy,
  label,
  itemCount,
  targets,
  defaultTargetId,
  labelOf,
  busy,
  onDeleteEmpty,
  onDeleteMove,
  onDeleteAll,
}: Props) {
  const canMove = targets.length > 0;
  const [mode, setMode] = useState<"move" | "all">(canMove ? "move" : "all");
  const [targetId, setTargetId] = useState<string | null>(
    defaultTargetId ?? targets[0]?.id ?? null,
  );
  const [stage, setStage] = useState<"choose" | "confirmAll">("choose");

  const title = formatTripWorkspaceTemplate(copy.deleteCategoryTitle, { name: label });

  if (itemCount === 0) {
    return (
      <>
        <AlertDialogHeader className="min-w-0">
          <AlertDialogTitle className="break-words whitespace-normal">{title}</AlertDialogTitle>
          <AlertDialogDescription className="break-words whitespace-normal">
            {copy.deleteCategoryEmptyBody}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <Footer copy={copy} busy={busy} danger onConfirm={onDeleteEmpty} />
      </>
    );
  }

  if (stage === "confirmAll") {
    return (
      <>
        <AlertDialogHeader className="min-w-0">
          <AlertDialogTitle className="break-words whitespace-normal">
            {formatTripWorkspaceCount(
              copy.deleteWithItemsConfirmTitle,
              itemCount,
              copy.deleteWithItemsConfirmTitleOne,
            )}
          </AlertDialogTitle>
          <AlertDialogDescription className="break-words whitespace-normal">
            {copy.deleteWithItemsConfirmBody}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <Footer copy={copy} busy={busy} danger onConfirm={onDeleteAll} />
      </>
    );
  }

  return (
    <>
      <AlertDialogHeader className="min-w-0">
        <AlertDialogTitle className="break-words whitespace-normal">{title}</AlertDialogTitle>
        <AlertDialogDescription className="break-words whitespace-normal">
          {formatTripWorkspaceCount(
            copy.deleteCategoryItemsBody,
            itemCount,
            copy.deleteCategoryItemsBodyOne,
          )}
        </AlertDialogDescription>
      </AlertDialogHeader>
      <div role="radiogroup" className="min-w-0 space-y-2">
        {canMove ? (
          <label
            className={cn(
              "block rounded-xl border px-3 py-2.5",
              mode === "move" ? "border-primary bg-primary/5" : "border-border",
            )}
          >
            <span className="flex items-center gap-2">
              <input
                type="radio"
                name="packing-delete-mode"
                checked={mode === "move"}
                onChange={() => setMode("move")}
                className="h-4 w-4 accent-primary"
              />
              <span className="text-sm font-medium text-foreground">{copy.deleteMoveOption}</span>
            </span>
            {mode === "move" ? (
              <span className="mt-2 flex items-center gap-2 pl-6">
                <span className="shrink-0 text-xs text-muted-foreground">
                  {copy.deleteMoveTarget}
                </span>
                <select
                  value={targetId ?? ""}
                  onChange={(e) => setTargetId(e.target.value)}
                  aria-label={copy.deleteMoveTarget}
                  className="h-9 min-w-0 flex-1 rounded-lg bg-secondary px-2 text-sm text-foreground outline-none"
                >
                  {targets.map((t) => (
                    <option key={t.id} value={t.id}>
                      {labelOf(t)}
                    </option>
                  ))}
                </select>
              </span>
            ) : null}
          </label>
        ) : null}
        <label
          className={cn(
            "flex items-center gap-2 rounded-xl border px-3 py-2.5",
            mode === "all" ? "border-destructive bg-destructive/5" : "border-border",
          )}
        >
          <input
            type="radio"
            name="packing-delete-mode"
            checked={mode === "all"}
            onChange={() => setMode("all")}
            className="h-4 w-4 accent-destructive"
          />
          <span className="text-sm font-medium text-destructive">{copy.deleteWithItemsOption}</span>
        </label>
      </div>
      <Footer
        copy={copy}
        busy={busy}
        danger={mode === "all"}
        onConfirm={() => {
          if (mode === "all") setStage("confirmAll");
          else if (targetId) onDeleteMove(targetId);
        }}
      />
    </>
  );
}

function Footer({
  copy,
  busy,
  danger,
  onConfirm,
}: {
  copy: TripPackingCopy;
  busy: boolean;
  danger: boolean;
  onConfirm: () => void;
}) {
  return (
    <AlertDialogFooter className="min-w-0 gap-2">
      <AlertDialogCancel disabled={busy} className="whitespace-normal break-words">
        {copy.cancel}
      </AlertDialogCancel>
      <button
        type="button"
        disabled={busy}
        onClick={onConfirm}
        className={cn(
          "inline-flex h-10 items-center justify-center gap-2 rounded-md px-4 text-sm font-medium disabled:opacity-60",
          danger
            ? "bg-destructive text-destructive-foreground hover:bg-destructive/90"
            : "bg-primary text-primary-foreground",
        )}
      >
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
        {copy.confirmDelete}
      </button>
    </AlertDialogFooter>
  );
}
