import { Link } from "@tanstack/react-router";
import { Sparkles } from "lucide-react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { PlusComingSoonDialog } from "@/components/PlusComingSoonDialog";
import { useAccess } from "@/hooks/use-access";
import { usePlusUpgrade } from "@/hooks/use-plus-upgrade";
import { isDeveloperBuildEnabled } from "@/lib/access/developer";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  feature?: "quiz" | "memory" | "personalized" | "general";
  /** 成功啟用 Plus 後（開發模式或正式訂閱） */
  onUpgraded?: () => void;
};

const FEATURE_COPY: Record<NonNullable<Props["feature"]>, { title: string; body: string }> = {
  general: {
    title: "Roamie Plus",
    body: "Plus 讓 Roamie 長期記住你的旅行風格、收藏與互動，在對話與推薦中提供更深入的個人化。免費版仍可正常使用 AI 對話、天氣與附近推薦。",
  },
  quiz: {
    title: "旅行性格測驗 — Plus",
    body: "完成測驗後，Roamie 會記住你的旅行風格，並在每次推薦時融入你的偏好。",
  },
  memory: {
    title: "Roamie 長期旅行記憶",
    body: "Plus 會記住你收藏過的地點、常選的類型與互動紀錄，讓推薦越來越懂你。",
  },
  personalized: {
    title: "Plus 個人化推薦",
    body: "依照你的心情、時間、天氣與收藏偏好，Roamie 會整理更適合你的去處。",
  },
};

const PLUS_FEATURES = [
  "長期記住旅行偏好與收藏",
  "更深度的個人化推薦",
  "旅行性格測驗與記憶設定",
  "情境式對話與行程整理",
] as const;

/**
 * Plus 功能介紹 + TestFlight 測試模式切換（不接真實付款）。
 */
export function RoamiePlusIntroDialog({
  open,
  onOpenChange,
  feature = "general",
  onUpgraded,
}: Props) {
  const {
    isPlusUser,
    devPlusMode,
    canShowDeveloperTools,
    enablePlusTestMode,
    disablePlusTestMode,
  } = useAccess();
  const { upgradeToPlus, comingSoonOpen, setComingSoonOpen } = usePlusUpgrade();
  const copy = FEATURE_COPY[feature];
  const showTestControls = isDeveloperBuildEnabled() || canShowDeveloperTools;

  const handleUpgradePlus = () => {
    const result = upgradeToPlus();
    if (result === "upgraded") {
      onUpgraded?.();
      onOpenChange(false);
    }
  };

  const handleEnableTest = () => {
    enablePlusTestMode();
    toast.success("已開啟 Plus 測試模式");
    onUpgraded?.();
    onOpenChange(false);
  };

  const handleDisableTest = () => {
    disablePlusTestMode();
    toast.message("已切換回 Free（收藏與行程資料仍保留）");
    onOpenChange(false);
  };

  return (
    <>
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="max-w-[min(100%,22rem)] rounded-3xl border-border">
        <AlertDialogHeader>
          <div className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-2xl bg-accent">
            <Sparkles className="h-6 w-6 text-clay" />
          </div>
          <AlertDialogTitle className="text-center font-display text-xl leading-snug">
            {isPlusUser ? "Roamie Plus 已啟用" : copy.title}
          </AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-3 text-left text-sm leading-relaxed text-muted-foreground">
              {isPlusUser ? (
                <>
                  {devPlusMode ? (
                    <p className="rounded-2xl bg-secondary/80 px-3 py-2 text-xs text-foreground/85">
                      目前為 <span className="font-medium">Plus 測試模式</span>
                      。關閉後會立即恢復 Free 體驗（長期記憶與深層個人化關閉；收藏、偏好與行程仍保留）。
                    </p>
                  ) : (
                    <p>已啟用 Roamie Plus：旅行偏好、收藏記憶與個人化推薦。</p>
                  )}
                  <Link
                    to="/onboarding"
                    search={{ from: "home" }}
                    onClick={() => onOpenChange(false)}
                    className="block w-full rounded-full bg-primary py-3 text-center text-sm font-medium text-primary-foreground"
                  >
                    管理我的旅行偏好
                  </Link>
                </>
              ) : (
                <>
                  <p>{copy.body}</p>
                  <ul className="space-y-1.5 text-xs">
                    {PLUS_FEATURES.map((line) => (
                      <li key={line} className="flex gap-2">
                        <span className="text-clay">·</span>
                        <span>{line}</span>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="flex-col gap-2 sm:flex-col">
          {isPlusUser ? (
            <>
              {showTestControls ? (
                <AlertDialogAction
                  className="w-full rounded-full border border-border bg-card py-3 text-sm font-medium text-foreground hover:bg-secondary"
                  onClick={handleDisableTest}
                >
                  {devPlusMode ? "取消 Plus 測試模式" : "切換回 Free"}
                </AlertDialogAction>
              ) : null}
              {showTestControls && !devPlusMode ? (
                <AlertDialogCancel
                  className="mt-0 w-full rounded-full border-clay/40 bg-accent py-3 text-sm font-medium text-foreground"
                  onClick={(e) => {
                    e.preventDefault();
                    handleEnableTest();
                  }}
                >
                  開啟 Plus 測試模式
                </AlertDialogCancel>
              ) : null}
              <AlertDialogCancel className="mt-0 w-full rounded-full py-3 text-sm">
                關閉
              </AlertDialogCancel>
            </>
          ) : (
            <>
              <AlertDialogAction
                className="w-full rounded-full bg-primary py-3 text-sm font-medium"
                onClick={(e) => {
                  e.preventDefault();
                  handleUpgradePlus();
                }}
              >
                立即升級 Plus
              </AlertDialogAction>
              <AlertDialogCancel
                className="mt-0 w-full rounded-full border border-border bg-card py-3 text-sm font-medium text-foreground"
                onClick={() => onOpenChange(false)}
              >
                繼續使用免費版
              </AlertDialogCancel>
            </>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    <PlusComingSoonDialog open={comingSoonOpen} onOpenChange={setComingSoonOpen} />
    </>
  );
}
