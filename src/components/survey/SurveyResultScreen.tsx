import { useEffect } from "react";
import { Loader2, Sparkles } from "lucide-react";
import type { SurveyResultProfile } from "@/lib/travel-preference-survey-types";

type Props = {
  result: SurveyResultProfile;
  pendingSave?: boolean;
  saving?: boolean;
  onFinish: () => void;
};

export function SurveyResultScreen({ result, pendingSave, saving, onFinish }: Props) {
  useEffect(() => {
    console.info("[SURVEY_RESULT] scrollEnabled=true");
  }, []);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pt-3"
        style={{
          paddingBottom: "calc(5.75rem + var(--safe-area-bottom, 0px))",
          WebkitOverflowScrolling: "touch",
        }}
      >
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Sparkles className="h-3.5 w-3.5 text-clay" />
          {pendingSave ? "確認你的旅行偏好" : "測驗完成"}
        </div>

        <section className="mt-4 rounded-3xl border border-border bg-card p-5 shadow-soft">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            測驗結果摘要
          </p>
          <p className="mt-2 text-sm leading-relaxed text-foreground/90">{result.personalitySummary}</p>
        </section>

        <section className="mt-4">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">旅行風格</p>
          <h1 className="mt-1 font-display text-2xl leading-tight">{result.travelStyle}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{result.personalityType}</p>
        </section>

        {result.travelTags.length > 0 ? (
          <section className="mt-4">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">偏好標籤</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {result.travelTags.map((tag) => (
                <span key={tag} className="rounded-full bg-secondary px-3 py-1 text-xs">
                  {tag}
                </span>
              ))}
            </div>
          </section>
        ) : null}

        <section className="mt-4 rounded-3xl border border-clay/20 bg-accent/40 p-5">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Roamie 對你的旅行印象
          </p>
          <p className="mt-2 text-sm leading-relaxed">{result.personalityImpression}</p>
        </section>

        <section className="mt-4 rounded-3xl border border-border bg-card p-5 shadow-soft">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">偏好類型</p>
          <ul className="mt-2 space-y-1.5 text-sm">
            {result.preferenceTypes.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </section>

        <section className="mt-4 rounded-3xl bg-secondary p-5">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">推薦旅行風格</p>
          <p className="mt-2 text-sm leading-relaxed">{result.recommendedStyle}</p>
        </section>

        <section className="mt-4 rounded-3xl border border-border bg-card p-5">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Roamie 推薦摘要</p>
          <p className="mt-2 text-sm leading-relaxed text-foreground/85">{result.aiRecommendationSummary}</p>
        </section>
      </div>

      <div
        className="shrink-0 border-t border-border bg-background px-5 pt-3 shadow-[0_-4px_24px_rgba(0,0,0,0.06)]"
        style={{ paddingBottom: "calc(0.75rem + var(--safe-area-bottom, 0px))" }}
      >
        <button
          type="button"
          disabled={saving}
          onClick={onFinish}
          className="w-full rounded-full bg-primary py-3.5 text-sm font-medium text-primary-foreground disabled:opacity-50"
        >
          {saving ? (
            <span className="inline-flex items-center justify-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" />
              儲存中…
            </span>
          ) : (
            "完成設定"
          )}
        </button>
      </div>
    </div>
  );
}
