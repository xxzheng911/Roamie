import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

/** Plus 訂閱尚未上線 — 自訂樣式，未來可改接 RevenueCat */
export function PlusComingSoonDialog({ open, onOpenChange }: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[min(100%,20rem)] rounded-3xl border-border/60 bg-[#f7f4ef] px-6 py-7 text-center shadow-[0_18px_48px_rgba(62,47,38,0.12)]">
        <DialogHeader className="space-y-3 text-center sm:text-center">
          <DialogTitle className="font-display text-xl leading-snug text-[#3e2f26]">
            Roamie Plus 即將推出
          </DialogTitle>
          <DialogDescription className="text-sm leading-relaxed text-[#5c4a3f]/85">
            我們正在整理更完整的個人化旅程體驗，
            <br />
            很快就能陪你走得更剛好。
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="mt-2 sm:justify-center">
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="w-full rounded-full bg-[#3e2f26] px-6 py-3.5 text-sm font-medium text-[#f7f4ef] shadow-[0_8px_24px_rgba(62,47,38,0.2)] transition active:scale-[0.99]"
          >
            我知道了
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
