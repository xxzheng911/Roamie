import { useI18n } from "@/hooks/use-i18n";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Loader2, UserPlus, Users } from "lucide-react";
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
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { supabase } from "@/integrations/supabase/client";
import { getAuthenticatedUserId } from "@/lib/auth-session";
import { ProfileAvatar } from "@/components/profile/ProfileAvatar";
import {
  COLLABORATOR_MISSING_PROFILE_NAME,
  collaboratorInitial,
  resolveCollaboratorAvatarUrl,
  resolveCollaboratorDisplayName,
} from "@/lib/trip/collab-member-display";
import {
  ensureTripInviteToken,
  getTripAccess,
  isTripInviteCreating,
  listTripMembers,
  peekTripInviteError,
  peekTripInviteToken,
  removeTripMember,
  retryTripInviteToken,
  subscribeTripInviteState,
  type TripMemberRow,
} from "@/lib/trip/trip-collab";
import { getTripWorkspaceCopy } from "@/lib/i18n/trip-workspace-copy";
import { TripInviteSheet } from "@/components/trip/TripInviteSheet";
import { cn } from "@/lib/utils";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tripId: string;
  tripTitle: string;
  /** null＝權限尚未查回（視同非擁有者，不建立邀請連結） */
  isOwner: boolean | null;
};

function memberDisplayName(member: TripMemberRow): string {
  const fromProfile = resolveCollaboratorDisplayName(member.profile);
  if (fromProfile) return fromProfile;
  if (member.profile) return "未設定名稱";
  return COLLABORATOR_MISSING_PROFILE_NAME;
}

function MemberAvatar({ member, displayName }: { member: TripMemberRow; displayName: string }) {
  const avatarUrl = resolveCollaboratorAvatarUrl(member.profile);
  const hasProfile = member.profile != null;
  const initial = avatarUrl ? undefined : collaboratorInitial(member.profile, displayName);

  if (hasProfile && avatarUrl) {
    console.info(
      `[TRIP_MEMBER_RENDER_PROFILE] userId=${member.user_id} name=${displayName} avatarUrl=${avatarUrl}`,
    );
  } else if (hasProfile) {
    console.info(
      `[TRIP_MEMBER_RENDER_PROFILE] userId=${member.user_id} name=${displayName} avatarUrl=(none)`,
    );
  } else {
    console.info(`[TRIP_MEMBER_RENDER_FALLBACK] reason=missing_profile userId=${member.user_id}`);
  }

  return (
    <ProfileAvatar
      avatarUrl={avatarUrl}
      displayName={displayName}
      avatarUpdatedAt={member.profile?.profile_updated_at}
      initial={initial}
      showDefault={!hasProfile}
      className="pointer-events-none h-9 w-9 shrink-0 rounded-full"
      imgClassName="rounded-full"
    />
  );
}

export function TripSharePanel({
  open,
  onOpenChange,
  tripId,
  tripTitle,
  isOwner: isOwnerProp,
}: Props) {
  const { t: uiT, locale } = useI18n();
  const workspaceCopy = getTripWorkspaceCopy(locale);

  // 連結／失敗／建立中皆讀模組層狀態（與 TripInviteSheet 共用）
  const inviteToken = useSyncExternalStore(
    subscribeTripInviteState,
    () => peekTripInviteToken(tripId),
    () => peekTripInviteToken(tripId),
  );
  const [inviteSheetOpen, setInviteSheetOpen] = useState(false);
  /** 建立邀請連結失敗（文案 key）；null＝無錯誤。按重試清除後重新建立 */
  const inviteError = useSyncExternalStore(
    subscribeTripInviteState,
    () => peekTripInviteError(tripId),
    () => peekTripInviteError(tripId),
  );
  const inviteCreating = useSyncExternalStore(
    subscribeTripInviteState,
    () => isTripInviteCreating(tripId),
    () => isTripInviteCreating(tripId),
  );
  const [loadingMembers, setLoadingMembers] = useState(false);
  const [collaborators, setCollaborators] = useState<TripMemberRow[]>([]);
  const [removeTarget, setRemoveTarget] = useState<TripMemberRow | null>(null);
  const [removing, setRemoving] = useState(false);
  const [resolvedIsOwner, setResolvedIsOwner] = useState(isOwnerProp);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const lastMemberTapAtRef = useRef(0);

  const refreshMembers = useCallback(async () => {
    setLoadingMembers(true);
    try {
      const rows = await listTripMembers(tripId);
      setCollaborators(rows.filter((m) => !m.is_owner));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : uiT("productionUi.p5381107860"));
      setCollaborators([]);
    } finally {
      setLoadingMembers(false);
    }
  }, [uiT, tripId]);

  useEffect(() => {
    setResolvedIsOwner(isOwnerProp);
  }, [isOwnerProp]);

  useEffect(() => {
    if (!open) return;
    void refreshMembers();
    void getAuthenticatedUserId().then((uid) => setCurrentUserId(uid));
    void getTripAccess(tripId).then((access) => {
      console.info(
        `[TRIP_SHARE_PANEL] tripId=${tripId} resolvedIsOwner=${access.isOwner} propIsOwner=${isOwnerProp}`,
      );
      setResolvedIsOwner(access.isOwner);
    });
  }, [open, refreshMembers, tripId, isOwnerProp]);

  useEffect(() => {
    if (!open) return;

    const channel = supabase
      .channel(`trip-members:${tripId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "trip_members",
          filter: `trip_id=eq.${tripId}`,
        },
        () => {
          void refreshMembers();
        },
      )
      .subscribe();

    const onVisible = () => {
      if (document.visibilityState === "visible") {
        void refreshMembers();
      }
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      void supabase.removeChannel(channel);
    };
  }, [open, tripId, refreshMembers]);

  // 擁有者開啟面板時取得長期邀請連結（伺服端產生；同一行程只呼叫一次）供「邀請成員」使用；已失敗不自動重試
  useEffect(() => {
    if (!open || !resolvedIsOwner || inviteToken || !tripId || inviteError || inviteCreating)
      return;
    ensureTripInviteToken(tripId);
  }, [open, resolvedIsOwner, inviteToken, tripId, inviteError, inviteCreating]);

  const handleMemberPress = useCallback(
    (member: TripMemberRow) => {
      const now = Date.now();
      if (now - lastMemberTapAtRef.current < 350) return;
      lastMemberTapAtRef.current = now;

      const name = memberDisplayName(member);
      console.info(
        `[TRIP_MEMBER_TAP] memberId=${member.user_id} memberName=${name} isOwner=${resolvedIsOwner}`,
      );

      if (member.is_owner || member.user_id === currentUserId) {
        console.info("[TRIP_MEMBER_REMOVE_BLOCKED] reason=is_owner_self");
        return;
      }

      if (!resolvedIsOwner) {
        console.info("[TRIP_MEMBER_REMOVE_BLOCKED] reason=not_owner");
        return;
      }

      setRemoveTarget(member);
    },
    [currentUserId, resolvedIsOwner],
  );

  const handleConfirmRemove = async () => {
    if (!removeTarget) return;
    const memberId = removeTarget.user_id;
    console.info(`[TRIP_MEMBER_REMOVE_START] tripId=${tripId} memberId=${memberId}`);
    setRemoving(true);
    try {
      await removeTripMember(tripId, memberId);
      setCollaborators((prev) => prev.filter((m) => m.user_id !== memberId));
      toast.success(uiT("productionUi.p5136a44492", { v0: memberDisplayName(removeTarget) }));
      console.info(`[TRIP_MEMBER_REMOVE_SUCCESS] tripId=${tripId} memberId=${memberId}`);
      setRemoveTarget(null);
      void refreshMembers();
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      console.error(`[TRIP_MEMBER_REMOVE_ERROR] error=${message}`);
      toast.error(e instanceof Error ? e.message : uiT("productionUi.p6600502ecf"));
    } finally {
      setRemoving(false);
    }
  };

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent
          side="bottom"
          className="rounded-t-[1.75rem] border-0 bg-background px-0 pb-8"
        >
          <SheetTitle className="flex items-center gap-2 px-5 text-base font-medium">
            <Users className="h-4 w-4 shrink-0" />
            {uiT("productionUi.peb328f809b")}
          </SheetTitle>

          <div className="pointer-events-auto relative z-10 mx-5 mt-4 overflow-hidden rounded-2xl border border-border bg-card">
            {loadingMembers ? (
              <div className="flex justify-center py-8">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : collaborators.length === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-muted-foreground">
                {uiT("productionUi.pb50c4dae63")}
              </p>
            ) : (
              <ul className="divide-y divide-border">
                {collaborators.map((member) => {
                  const name = memberDisplayName(member);
                  return (
                    <li key={member.id} className="relative">
                      <button
                        type="button"
                        aria-label={uiT("productionUi.manageMember", { name })}
                        onClick={() => handleMemberPress(member)}
                        onTouchEnd={(e) => {
                          e.stopPropagation();
                          handleMemberPress(member);
                        }}
                        className={cn(
                          "relative z-10 flex w-full min-h-[48px] touch-manipulation items-center gap-3 px-4 py-3 text-left",
                          "transition hover:bg-secondary/50 active:bg-secondary/70",
                          resolvedIsOwner ? "cursor-pointer" : "cursor-default",
                        )}
                      >
                        <MemberAvatar member={member} displayName={name} />
                        <span className="pointer-events-none min-w-0 flex-1 truncate text-sm font-medium">
                          {name}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          {resolvedIsOwner ? (
            <div className="mx-5 mt-4">
              {!inviteToken && inviteError ? (
                <div
                  role="alert"
                  className="mb-3 flex items-center justify-between gap-2 rounded-xl bg-destructive/10 px-3 py-2"
                >
                  <span className="min-w-0 text-xs text-destructive">
                    {workspaceCopy[inviteError]}
                  </span>
                  <button
                    type="button"
                    onClick={() => retryTripInviteToken(tripId)}
                    className="shrink-0 rounded-full bg-background px-3 py-1 text-xs font-medium text-foreground"
                  >
                    {workspaceCopy.inviteRetry}
                  </button>
                </div>
              ) : null}
              <button
                type="button"
                onClick={() => setInviteSheetOpen(true)}
                disabled={!inviteToken}
                className="flex w-full touch-manipulation items-center justify-center gap-2 rounded-full bg-primary py-3.5 text-sm font-medium text-primary-foreground transition active:scale-[0.99] disabled:opacity-50"
              >
                {!inviteToken && !inviteError ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    {workspaceCopy.inviteLinkLoading}
                  </>
                ) : (
                  <>
                    <UserPlus className="h-4 w-4" />
                    {workspaceCopy.inviteMembers}
                  </>
                )}
              </button>
            </div>
          ) : null}
          {resolvedIsOwner ? (
            <TripInviteSheet
              open={inviteSheetOpen}
              onOpenChange={setInviteSheetOpen}
              tripId={tripId}
              tripTitle={tripTitle}
            />
          ) : null}
        </SheetContent>
      </Sheet>

      <AlertDialog
        open={removeTarget != null}
        onOpenChange={(next) => {
          if (!next && !removing) setRemoveTarget(null);
        }}
      >
        <AlertDialogContent
          overlayClassName="z-[100]"
          className="z-[100] max-w-[min(100%,22rem)] rounded-3xl"
        >
          <AlertDialogHeader>
            <AlertDialogTitle className="font-display text-lg">
              {uiT("productionUi.pc52331f090")}
            </AlertDialogTitle>
            <AlertDialogDescription className="text-left text-sm leading-relaxed">
              {uiT("productionUi.pf973fc5980", {
                v0: removeTarget ? memberDisplayName(removeTarget) : "",
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex-col gap-2 sm:flex-col">
            <AlertDialogAction
              className={cn("w-full rounded-full", removing && "pointer-events-none opacity-60")}
              onClick={(e) => {
                e.preventDefault();
                void handleConfirmRemove();
              }}
            >
              {removing ? uiT("productionUi.p19c4ca651c") : uiT("productionUi.p6135d4159e")}
            </AlertDialogAction>
            <AlertDialogCancel className="mt-0 w-full rounded-full" disabled={removing}>
              {uiT("productionUi.p2cd0f3be87")}
            </AlertDialogCancel>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
