import { Link } from "@tanstack/react-router";
import { ChevronRight, Sparkles } from "lucide-react";
import { useI18n } from "@/hooks/use-i18n";

export type QuizCtaOrigin = "home" | "profile" | "chat";

type Props = {
  origin: QuizCtaOrigin;
  variant?: "card" | "banner" | "profile-card";
  className?: string;
};

export function PreferenceQuizCta({ origin, variant = "card", className }: Props) {
  const { t } = useI18n();
  const badge = t("quizCta.badge");
  const title = t("quizCta.title");
  const desc = t("quizCta.desc");
  const button = t("quizCta.button");

  if (variant === "banner") {
    return (
      <Link
        to="/onboarding"
        search={{ from: origin }}
        className={`block rounded-2xl border border-clay/25 bg-accent/50 px-4 py-3.5 transition active:scale-[0.99] ${className ?? ""}`}
      >
        <div className="flex items-start gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl bg-card">
            <Sparkles className="h-4 w-4 text-clay" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[15px] font-medium leading-snug">{title}</p>
            <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{desc}</p>
            <p className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-foreground">
              {button}
              <ChevronRight className="h-3.5 w-3.5" />
            </p>
          </div>
        </div>
      </Link>
    );
  }

  if (variant === "profile-card") {
    return (
      <div className={`rounded-3xl border border-border bg-card p-5 shadow-soft ${className ?? ""}`}>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Sparkles className="h-3.5 w-3.5 text-clay" />
          {badge}
        </div>
        <p className="mt-2 font-display text-[17px] leading-snug">{title}</p>
        <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{desc}</p>
        <Link
          to="/onboarding"
          search={{ from: origin }}
          className="mt-4 block rounded-full bg-primary py-3 text-center text-sm text-primary-foreground"
        >
          {button}
        </Link>
      </div>
    );
  }

  return (
    <Link
      to="/onboarding"
      search={{ from: origin }}
      className={`block rounded-3xl border border-border bg-card p-5 shadow-soft transition active:scale-[0.99] ${className ?? ""}`}
    >
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Sparkles className="h-3.5 w-3.5 text-clay" />
        {badge}
      </div>
      <p className="mt-2 font-display text-[19px] leading-snug">{title}</p>
      <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{desc}</p>
      <div className="mt-4 flex items-center justify-between rounded-2xl bg-secondary/60 px-4 py-3 text-sm font-medium">
        <span>{button}</span>
        <ChevronRight className="h-4 w-4 text-muted-foreground" />
      </div>
    </Link>
  );
}
