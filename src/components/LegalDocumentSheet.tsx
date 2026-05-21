import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  content: string;
};

export function LegalDocumentSheet({ open, onOpenChange, title, content }: Props) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="flex max-h-[min(92dvh,720px)] flex-col rounded-t-[2rem] px-5 pb-[max(1rem,env(safe-area-inset-bottom))] pt-6"
      >
        <SheetHeader className="shrink-0 text-left">
          <SheetTitle className="font-display text-lg">{title}</SheetTitle>
        </SheetHeader>
        <div className="mt-4 min-h-0 flex-1 overflow-y-auto whitespace-pre-wrap pr-1 text-sm leading-relaxed text-foreground/90">
          {content}
        </div>
        <button
          type="button"
          onClick={() => onOpenChange(false)}
          className="mt-4 shrink-0 w-full rounded-full bg-primary py-3.5 text-sm font-medium text-primary-foreground"
        >
          關閉
        </button>
      </SheetContent>
    </Sheet>
  );
}
