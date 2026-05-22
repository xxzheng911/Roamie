import type { ReactNode } from "react";
import { Drawer, DrawerContent } from "@/components/ui/drawer";
import { useI18n } from "@/hooks/use-i18n";
import { cn } from "@/lib/utils";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title?: string;
  children: ReactNode;
  onConfirm: () => void;
  onCancel?: () => void;
  confirmLabel?: string;
  cancelLabel?: string;
  className?: string;
  /** 地點搜尋等：點選即關閉，不顯示底部按鈕 */
  hideFooter?: boolean;
};

/** Roamie 底部選擇器外殼：奶油色、圓角、取消／確定 */
export function RoamiePickerSheet({
  open,
  onOpenChange,
  title,
  children,
  onConfirm,
  onCancel,
  confirmLabel,
  cancelLabel,
  className,
  hideFooter = false,
}: Props) {
  const { t } = useI18n();
  const confirm = confirmLabel ?? t("picker.confirm");
  const cancel = cancelLabel ?? t("picker.cancel");
  const handleCancel = () => {
    onCancel?.();
    onOpenChange(false);
  };

  const handleConfirm = () => {
    onConfirm();
    onOpenChange(false);
  };

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent
        className={cn(
          "z-[60] mx-auto max-w-lg rounded-t-[1.75rem] border-0 bg-cream shadow-[0_-8px_40px_rgba(40,30,20,0.12)] [&>div:first-child]:hidden",
          className,
        )}
      >
        <>
          <div
            className="mx-auto mt-3 h-1 w-10 shrink-0 rounded-full bg-border/80"
            aria-hidden
          />
          {title ? (
            <p className="mt-4 text-center font-display text-[17px] font-medium leading-[26px] text-foreground">
              {title}
            </p>
          ) : (
            <div className="mt-4 h-[26px] shrink-0" aria-hidden />
          )}
          <div className="px-5 pb-2 pt-3">{children}</div>
          {!hideFooter ? (
            <div className="flex gap-3 border-t border-border/60 bg-card/50 px-5 py-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
              <button
                type="button"
                onClick={handleCancel}
                className="flex-1 rounded-full border border-border bg-card py-3 text-[15px] font-medium text-foreground transition active:scale-[0.98]"
              >
                {cancel}
              </button>
              <button
                type="button"
                onClick={handleConfirm}
                className="flex-1 rounded-full bg-primary py-3 text-[15px] font-medium text-primary-foreground shadow-soft transition active:scale-[0.98]"
              >
                {confirm}
              </button>
            </div>
          ) : (
            <div className="pb-[max(1rem,env(safe-area-inset-bottom))]" aria-hidden />
          )}
        </>
      </DrawerContent>
    </Drawer>
  );
}
