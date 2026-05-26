import { ROAMIE_ASSISTANT_AVATAR_SRC } from "@/lib/roamie-assistant-avatar";
import { cn } from "@/lib/utils";

type RoamieAssistantAvatarProps = {
  className?: string;
  showOnlineIndicator?: boolean;
};

/** Roamie 助理固定大頭貼（預設人物圖，不讀取使用者 profile avatar） */
export function RoamieAssistantAvatar({
  className,
  showOnlineIndicator = false,
}: RoamieAssistantAvatarProps) {
  return (
    <div
      className={cn("relative shrink-0 overflow-hidden rounded-full bg-accent", className)}
      aria-hidden
    >
      <img
        src={ROAMIE_ASSISTANT_AVATAR_SRC}
        alt=""
        className="h-full w-full object-cover"
        draggable={false}
      />
      {showOnlineIndicator ? (
        <span className="pointer-events-none absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-background bg-sage" />
      ) : null}
    </div>
  );
}
