import { useLayoutEffect } from "react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { ROAMIE_CONTACT_EMAIL } from "@/constants/contact";
import { requestIosSnapshotRefresh } from "@/lib/ios-snapshot-bridge";

function renderLegalContent(content: string) {
  const parts = content.split(ROAMIE_CONTACT_EMAIL);
  if (parts.length === 1) return content;
  return parts.flatMap((part, index) => {
    if (index === parts.length - 1) return [part];
    return [
      part,
      <a
        key={`email-${index}`}
        href={`mailto:${ROAMIE_CONTACT_EMAIL}`}
        className="text-foreground underline underline-offset-2"
      >
        {ROAMIE_CONTACT_EMAIL}
      </a>,
    ];
  });
}

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  content: string;
};

export function LegalDocumentSheet({ open, onOpenChange, title, content }: Props) {
  useLayoutEffect(() => {
    if (!open) return;
    let inner = 0;
    const outer = requestAnimationFrame(() => {
      inner = requestAnimationFrame(() => {
        requestIosSnapshotRefresh("legal-sheet-layout", { force: true });
      });
    });
    return () => {
      cancelAnimationFrame(outer);
      cancelAnimationFrame(inner);
    };
  }, [open, content]);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        overlayClassName="z-[110]"
        className="z-[120] flex max-h-[min(92dvh,720px)] flex-col rounded-t-[2rem] px-5 pb-[max(1rem,env(safe-area-inset-bottom))] pt-6"
      >
        <SheetHeader className="shrink-0 text-left">
          <SheetTitle className="font-display text-lg">{title}</SheetTitle>
        </SheetHeader>
        <div
          className="mt-4 min-h-0 flex-1 overflow-y-auto overscroll-contain whitespace-pre-wrap pr-1 text-sm leading-relaxed text-foreground/90"
        >
          {renderLegalContent(content)}
        </div>
        <button
          type="button"
          onClick={() => onOpenChange(false)}
          className="mt-4 w-full shrink-0 rounded-full bg-primary py-3.5 text-sm font-medium text-primary-foreground"
        >
          關閉
        </button>
      </SheetContent>
    </Sheet>
  );
}
