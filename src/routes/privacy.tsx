import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo } from "react";
import { PRIVACY_POLICY } from "@/content/legal";
import { ROAMIE_CONTACT_EMAIL } from "@/constants/contact";

export const Route = createFileRoute("/privacy")({
  head: () => ({
    meta: [
      { title: "Roamie 隱私權政策" },
      {
        name: "description",
        content: "Roamie 隱私權政策與資料使用說明。",
      },
    ],
  }),
  component: PrivacyPage,
});

function renderPrivacyContent(content: string) {
  const parts = content.split(ROAMIE_CONTACT_EMAIL);
  if (parts.length === 1) return content;
  return parts.flatMap((part, index) => {
    if (index === parts.length - 1) return [part];
    return [
      part,
      <a
        key={`privacy-email-${index}`}
        href={`mailto:${ROAMIE_CONTACT_EMAIL}`}
        className="font-medium text-primary underline decoration-primary/30 underline-offset-4 transition-colors hover:decoration-primary"
      >
        {ROAMIE_CONTACT_EMAIL}
      </a>,
    ];
  });
}

function PrivacyPage() {
  const content = useMemo(() => renderPrivacyContent(PRIVACY_POLICY), []);

  return (
    <main className="min-h-screen bg-background px-5 py-10 text-foreground sm:px-8 sm:py-16">
      <div className="mx-auto w-full max-w-3xl">
        <header className="mb-8 border-b border-border/70 pb-6 sm:mb-10 sm:pb-8">
          <p className="mb-3 text-sm font-semibold uppercase tracking-[0.24em] text-primary">
            Roamie Travel
          </p>
          <h1 className="font-display text-4xl font-semibold tracking-tight sm:text-5xl">
            隱私權政策
          </h1>
          <p className="mt-4 text-base leading-8 text-muted-foreground sm:text-lg">
            Roamie 隱私權政策與資料使用說明。
          </p>
          <div className="mt-6">
            <Link
              to="/support"
              className="inline-flex items-center rounded-full border border-border/70 px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted/60"
            >
              返回支援頁
            </Link>
          </div>
        </header>

        <article className="whitespace-pre-wrap text-sm leading-relaxed text-foreground/90 sm:text-[15px]">
          {content}
        </article>
      </div>
    </main>
  );
}
