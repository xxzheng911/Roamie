import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";
import { MobileFrame } from "@/components/MobileFrame";
import traveler from "@/assets/roamie-traveler.jpg";

export const Route = createFileRoute("/splash")({
  component: Splash,
});

function Splash() {
  return (
    <MobileFrame>
      <div className="flex min-h-[calc(100vh-2rem)] md:min-h-[860px] flex-col items-center justify-between px-8 pb-10 pt-20">
        <div className="flex flex-1 flex-col items-center justify-center text-center">
          <div className="relative">
            <div className="absolute inset-0 -m-6 rounded-full bg-accent/40 blur-xl animate-breathe" />
            <div className="relative h-44 w-44 overflow-hidden rounded-[2.5rem] bg-secondary animate-float">
              <img src={traveler} alt="" className="h-full w-full object-cover" />
            </div>
          </div>
          <p className="mt-10 text-xs uppercase tracking-[0.4em] text-muted-foreground">Roamie</p>
          <h1 className="mt-3 font-display text-3xl leading-snug">
            你的<em className="not-italic text-clay">慢旅行</em>夥伴
          </h1>
          <p className="mt-4 max-w-xs text-[15px] leading-relaxed text-muted-foreground">
            不再為了「今天要做什麼」煩惱。<br />Roamie 給你剛剛好的安排。
          </p>
        </div>

        <div className="w-full space-y-3">
          <Link
            to="/onboarding"
            className="flex w-full items-center justify-center gap-2 rounded-full bg-primary py-4 text-[15px] font-medium text-primary-foreground shadow-lift"
          >
            開始認識 Roamie <ArrowRight className="h-4 w-4" />
          </Link>
          <Link to="/" className="block py-2 text-center text-sm text-muted-foreground">
            我之前用過 · 直接進入
          </Link>
        </div>
      </div>
    </MobileFrame>
  );
}
