import { Link } from "@tanstack/react-router";
import { cn } from "@/lib/utils";

type Props = {
  from?: string;
  className?: string;
};

/**
 * 收藏行程列表下方：置中「＋」新增入口（無卡片、無文字）。
 */
export function PlanCreateNewTripPlusButton({ from = "saved", className }: Props) {
  return (
    <div className={cn("flex justify-center pt-8 pb-2", className)}>
      <Link
        to="/plan"
        search={{ from }}
        data-plan-entry="v2"
        aria-label="規劃新行程"
        className="flex h-11 min-h-[44px] w-11 min-w-[44px] touch-manipulation items-center justify-center text-primary transition active:scale-95"
      >
        <span
          className="select-none font-display text-[2.25rem] font-normal leading-none"
          aria-hidden
        >
          ＋
        </span>
      </Link>
    </div>
  );
}

/** @deprecated 請用 PlanCreateNewTripPlusButton（列表下方置中 ＋） */
export function PlanCreateNewTripCard(props: Props) {
  return <PlanCreateNewTripPlusButton {...props} />;
}
