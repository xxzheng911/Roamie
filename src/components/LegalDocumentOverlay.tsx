import { useEffect, useLayoutEffect, useRef } from "react";
import { ROAMIE_CONTACT_EMAIL } from "@/constants/contact";
import {
  bindIosLegalDocumentOverlay,
  requestIosSnapshotRefresh,
} from "@/lib/ios-snapshot-bridge";

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
  title: string;
  content: string;
  onClose: () => void;
};

/**
 * In-tree legal panel. iOS Capacitor: mirror + scroll-synced snapshot (not live compositor).
 */
export function LegalDocumentOverlay({ title, content, onClose }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => bindIosLegalDocumentOverlay("legal-overlay"), []);

  useEffect(() => {
    document.documentElement.classList.add("legal-overlay-open");
    return () => {
      document.documentElement.classList.remove("legal-overlay-open");
    };
  }, []);

  useLayoutEffect(() => {
    let inner = 0;
    const outer = requestAnimationFrame(() => {
      inner = requestAnimationFrame(() => {
        requestIosSnapshotRefresh("legal-open", { force: true });
      });
    });
    return () => {
      cancelAnimationFrame(outer);
      cancelAnimationFrame(inner);
    };
  }, [content]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    let raf = 0;
    const refreshMirror = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        requestIosSnapshotRefresh("legal-scroll", { force: true });
      });
    };

    el.addEventListener("scroll", refreshMirror, { passive: true });
    el.addEventListener("touchmove", refreshMirror, { passive: true });
    el.addEventListener("touchend", refreshMirror, { passive: true });

    return () => {
      el.removeEventListener("scroll", refreshMirror);
      el.removeEventListener("touchmove", refreshMirror);
      el.removeEventListener("touchend", refreshMirror);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [content]);

  return (
    <div
      className="absolute inset-0 z-[200] flex min-h-0 flex-col"
      role="dialog"
      aria-modal="true"
      aria-labelledby="legal-overlay-title"
    >
      <button
        type="button"
        className="min-h-0 flex-1 touch-manipulation bg-black/50"
        aria-label="關閉"
        onClick={onClose}
      />
      <div className="relative flex max-h-[min(92dvh,720px)] min-h-0 w-full shrink-0 flex-col rounded-t-[2rem] bg-background px-5 pb-[max(1rem,env(safe-area-inset-bottom))] pt-6 shadow-lift">
        <div className="flex shrink-0 items-start justify-between gap-3">
          <h2 id="legal-overlay-title" className="font-display text-lg">
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 touch-manipulation rounded-full px-3 py-1.5 text-sm text-muted-foreground hover:bg-muted"
            aria-label="關閉"
          >
            ✕
          </button>
        </div>
        <div
          ref={scrollRef}
          className="legal-overlay-scroll mt-4 min-h-0 flex-1 overflow-y-scroll overflow-x-hidden overscroll-y-contain whitespace-pre-wrap pr-1 text-sm leading-relaxed text-foreground/90"
        >
          {renderLegalContent(content)}
        </div>
        <button
          type="button"
          onClick={onClose}
          className="mt-4 w-full shrink-0 touch-manipulation rounded-full bg-primary py-3.5 text-sm font-medium text-primary-foreground"
        >
          關閉
        </button>
      </div>
    </div>
  );
}
