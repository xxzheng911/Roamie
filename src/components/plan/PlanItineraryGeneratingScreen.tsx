import { useEffect, useState } from "react";
import { Loader2, Sparkles } from "lucide-react";
import { RoamieAssistantAvatar } from "@/components/RoamieAssistantAvatar";

const DEFAULT_STEPS_ZH = [
  "分析天氣中…",
  "規劃最佳路線中…",
  "尋找特色體驗中…",
  "整理你的旅程中…",
];

type Props = {
  title: string;
  steps?: string[];
};

export function PlanItineraryGeneratingScreen({ title, steps = DEFAULT_STEPS_ZH }: Props) {
  const [stepIndex, setStepIndex] = useState(0);

  useEffect(() => {
    const id = window.setInterval(() => {
      setStepIndex((i) => (i + 1) % steps.length);
    }, 2200);
    return () => window.clearInterval(id);
  }, [steps]);

  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-background/95 px-8 backdrop-blur-sm">
      <div className="mb-6">
        <RoamieAssistantAvatar className="h-16 w-16" showOnlineIndicator />
      </div>
      <div className="flex items-center gap-2 text-primary">
        <Sparkles className="h-4 w-4 animate-pulse" aria-hidden />
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
      </div>
      <h2 className="mt-4 text-center font-display text-lg">{title}</h2>
      <p className="mt-3 min-h-[1.25rem] text-center text-sm text-muted-foreground transition-opacity">
        {steps[stepIndex]}
      </p>
    </div>
  );
}
