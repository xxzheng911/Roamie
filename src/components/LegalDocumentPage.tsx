import { useEffect, useLayoutEffect, useState } from "react";
import { ChevronLeft } from "lucide-react";
import { MobileFrame } from "@/components/MobileFrame";
import { ROAMIE_CONTACT_EMAIL } from "@/constants/contact";
import { bindIosInteractiveRoute } from "@/lib/ios-snapshot-bridge";

export type LegalDocumentKind = "terms" | "privacy";

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
  doc: LegalDocumentKind;
  onBack: () => void;
};

/**
 * Full-page legal viewer (iOS Capacitor). Uses document scroll — avoids overlay mirror touch misalignment.
 */
export function LegalDocumentPage({ doc, onBack }: Props) {
  const [content, setContent] = useState<string | null>(null);
  const title = doc === "terms" ? "Roamie 服務條款" : "Roamie 隱私權政策";

  useLayoutEffect(() => bindIosInteractiveRoute("legal-page"), []);

  useEffect(() => {
    document.documentElement.classList.add("legal-page-scroll");
    return () => {
      document.documentElement.classList.remove("legal-page-scroll");
    };
  }, []);

  useEffect(() => {
    void import("@/content/legal").then((m) => {
      setContent(doc === "terms" ? m.TERMS_OF_SERVICE : m.PRIVACY_POLICY);
    });
  }, [doc]);

  return (
    <MobileFrame>
      <div className="legal-page-root px-5 pb-[max(2.5rem,var(--safe-area-bottom))] pt-[max(0.75rem,var(--safe-area-top))]">
        <header className="sticky top-0 z-10 flex items-center gap-2 border-b border-border/60 bg-background/95 py-3 backdrop-blur-sm">
          <button
            type="button"
            onClick={onBack}
            className="inline-flex touch-manipulation items-center gap-1 rounded-full px-2 py-1.5 text-sm text-foreground"
            aria-label="返回登入"
          >
            <ChevronLeft className="h-4 w-4" aria-hidden />
            返回
          </button>
          <h1 className="min-w-0 flex-1 truncate font-display text-base">{title}</h1>
        </header>

        {content ? (
          <article className="legal-page-body whitespace-pre-wrap pt-5 text-sm leading-relaxed text-foreground/90">
            {renderLegalContent(content)}
          </article>
        ) : (
          <p className="py-10 text-center text-sm text-muted-foreground">載入中…</p>
        )}
      </div>
    </MobileFrame>
  );
}
