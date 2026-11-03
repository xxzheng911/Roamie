import { useI18n } from "@/hooks/use-i18n";
import { useCallback, useEffect, useSyncExternalStore, type ReactNode } from "react";
import { Link2, Loader2, Mail, MessageCircle, MoreHorizontal } from "lucide-react";
import { toast } from "sonner";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { getTripWorkspaceCopy } from "@/lib/i18n/trip-workspace-copy";
import { openExternalUrl } from "@/lib/open-external-url";
import {
  buildLineShareUrl,
  buildMailtoShareUrl,
  buildSmsShareUrl,
  copyInviteToClipboard,
  ensureTripInviteToken,
  isTripInviteCreating,
  peekTripInviteError,
  peekTripInviteToken,
  retryTripInviteToken,
  shareTripInvite,
  subscribeTripInviteState,
} from "@/lib/trip/trip-collab";
import { detectPlatform } from "@/services/platform";
import { cn } from "@/lib/utils";
// LINE 對話泡泡圖示（Simple Icons，CC0；品牌綠 #06C755、白色泡泡）
import lineShareIcon from "@/assets/line/line-share-icon.svg";

/** sms:／mailto:：WebView 頂層導覽交由系統開啟（Capacitor 對非 App 網址呼叫 UIApplication.open） */
function openSchemeUrl(url: string) {
  if (typeof window !== "undefined") window.location.href = url;
}

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tripId: string;
  tripTitle: string;
};

type OptionProps = {
  label: string;
  icon: ReactNode;
  disabled: boolean;
  onPress: () => void;
  className?: string;
};

function InviteOption({ label, icon, disabled, onPress, className }: OptionProps) {
  return (
    <button
      type="button"
      onClick={onPress}
      disabled={disabled}
      className="flex w-[72px] max-w-[20%] min-w-0 touch-manipulation flex-col items-center gap-1.5 disabled:opacity-50"
    >
      <span
        className={cn(
          "flex h-12 w-12 items-center justify-center overflow-hidden rounded-2xl bg-secondary text-foreground transition active:scale-95",
          className,
        )}
      >
        {icon}
      </span>
      <span className="line-clamp-2 w-full text-center text-[11px] leading-tight text-foreground">
        {label}
      </span>
    </button>
  );
}

/** 「邀請成員」底部面板：複製連結／LINE／訊息／Email／更多 */
export function TripInviteSheet({ open, onOpenChange, tripId, tripTitle }: Props) {
  const { locale } = useI18n();
  const copy = getTripWorkspaceCopy(locale);
  // 連結／失敗／建立中皆讀模組層狀態（與分享面板共用；面板或總覽卸載不遺失，已失敗不自動重試）
  const token = useSyncExternalStore(
    subscribeTripInviteState,
    () => peekTripInviteToken(tripId),
    () => peekTripInviteToken(tripId),
  );
  /** 建立邀請連結失敗（文案 key）；null＝無錯誤。保留到使用者按「重試」 */
  const inviteError = useSyncExternalStore(
    subscribeTripInviteState,
    () => peekTripInviteError(tripId),
    () => peekTripInviteError(tripId),
  );
  const loading = useSyncExternalStore(
    subscribeTripInviteState,
    () => isTripInviteCreating(tripId),
    () => isTripInviteCreating(tripId),
  );

  useEffect(() => {
    if (!open || token || !tripId || inviteError || loading) return;
    ensureTripInviteToken(tripId);
  }, [open, token, tripId, inviteError, loading]);

  const handleCopy = useCallback(async () => {
    if (!token) return;
    const result = await copyInviteToClipboard(token);
    if (result === "copied") toast.success(copy.inviteCopied);
    else toast.error(copy.inviteCopyManual);
  }, [token, copy.inviteCopied, copy.inviteCopyManual]);

  const handleLine = useCallback(() => {
    if (!token) return;
    void openExternalUrl(buildLineShareUrl(token, tripTitle));
  }, [token, tripTitle]);

  const handleMessages = useCallback(() => {
    if (!token) return;
    openSchemeUrl(buildSmsShareUrl(token, tripTitle, detectPlatform().isIOS));
  }, [token, tripTitle]);

  const handleEmail = useCallback(() => {
    if (!token) return;
    openSchemeUrl(buildMailtoShareUrl(token, tripTitle));
  }, [token, tripTitle]);

  const handleMore = useCallback(async () => {
    if (!token) return;
    const result = await shareTripInvite(token, tripTitle);
    if (result === "copied") toast.success(copy.inviteCopied);
    else if (result === "manual") toast.error(copy.inviteCopyManual);
  }, [token, tripTitle, copy.inviteCopied, copy.inviteCopyManual]);

  const disabled = !token;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="rounded-t-[1.75rem] border-0 bg-background px-0 pb-8">
        <SheetTitle className="flex items-center gap-2 px-5 text-base font-medium">
          {copy.inviteMembers}
          {loading ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /> : null}
        </SheetTitle>
        {!token && inviteError ? (
          <div
            role="alert"
            className="mx-5 mt-4 flex items-center justify-between gap-2 rounded-xl bg-destructive/10 px-3 py-2"
          >
            <span className="min-w-0 text-xs text-destructive">{copy[inviteError]}</span>
            <button
              type="button"
              onClick={() => retryTripInviteToken(tripId)}
              className="shrink-0 rounded-full bg-background px-3 py-1 text-xs font-medium text-foreground"
            >
              {copy.inviteRetry}
            </button>
          </div>
        ) : null}
        <div className="mt-5 flex items-start justify-between gap-1 px-4">
          <InviteOption
            label={copy.inviteOptionCopy}
            icon={<Link2 className="h-5 w-5" />}
            disabled={disabled}
            onPress={() => void handleCopy()}
          />
          <InviteOption
            label={copy.inviteOptionLine}
            icon={<img src={lineShareIcon} alt="" className="h-full w-full object-cover" />}
            disabled={disabled}
            onPress={handleLine}
            className="bg-transparent"
          />
          <InviteOption
            label={copy.inviteOptionMessages}
            icon={<MessageCircle className="h-5 w-5" />}
            disabled={disabled}
            onPress={handleMessages}
          />
          <InviteOption
            label={copy.inviteOptionEmail}
            icon={<Mail className="h-5 w-5" />}
            disabled={disabled}
            onPress={handleEmail}
          />
          <InviteOption
            label={copy.inviteOptionMore}
            icon={<MoreHorizontal className="h-5 w-5" />}
            disabled={disabled}
            onPress={() => void handleMore()}
          />
        </div>
      </SheetContent>
    </Sheet>
  );
}
