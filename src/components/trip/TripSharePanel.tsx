import { useCallback, useEffect, useRef, useState } from "react";
import { Copy, Loader2, Users } from "lucide-react";
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
  copyInviteToClipboard,
  createTripInvite,
  getTripAccess,
  listTripMembers,
  removeTripMember,
  type TripMemberRow,
} from "@/lib/trip/trip-collab";
import { COPY_MANUAL_HINT } from "@/lib/copy-to-clipboard";
import { TRIP_INVITE_CREATE_FAILED_MESSAGE } from "@/lib/supabase-errors";
import { cn } from "@/lib/utils";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tripId: string;
  tripTitle: string;
  isOwner: boolean;
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
    console.info(
      `[TRIP_MEMBER_RENDER_FALLBACK] reason=missing_profile userId=${member.user_id}`,
    );
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

export function TripSharePanel({ open, onOpenChange, tripId, isOwner: isOwnerProp }: Props) {
  const [inviteToken, setInviteToken] = useState<string | null>(null);
  const [copying, setCopying] = useState(false);
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
      toast.error(e instanceof Error ? e.message : "無法載入成員");
      setCollaborators([]);
    } finally {
      setLoadingMembers(false);
    }
  }, [tripId]);

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

  const ensureInviteToken = useCallback(async (): Promise<string> => {
    if (inviteToken) return inviteToken;
    const invite = await createTripInvite(tripId);
    setInviteToken(invite.token);
    return invite.token;
  }, [inviteToken, tripId]);

  const handleCopyLink = async () => {
    setCopying(true);
    try {
      const token = await ensureInviteToken();
      const result = await copyInviteToClipboard(token);
      if (result === "copied") {
        toast.success("邀請連結已複製");
      } else {
        toast.error(COPY_MANUAL_HINT);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : TRIP_INVITE_CREATE_FAILED_MESSAGE);
    } finally {
      setCopying(false);
    }
  };

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
      toast.success(`已將「${memberDisplayName(removeTarget)}」移出此行程`);
      console.info(`[TRIP_MEMBER_REMOVE_SUCCESS] tripId=${tripId} memberId=${memberId}`);
      setRemoveTarget(null);
      void refreshMembers();
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      console.error(`[TRIP_MEMBER_REMOVE_ERROR] error=${message}`);
      toast.error(e instanceof Error ? e.message : "移除旅伴失敗");
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
            邀請共編
          </SheetTitle>

          <div className="pointer-events-auto relative z-10 mx-5 mt-4 overflow-hidden rounded-2xl border border-border bg-card">
            {loadingMembers ? (
              <div className="flex justify-center py-8">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : collaborators.length === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-muted-foreground">尚未有人加入</p>
            ) : (
              <ul className="divide-y divide-border">
                {collaborators.map((member) => {
                  const name = memberDisplayName(member);
                  return (
                    <li key={member.id} className="relative">
                      <button
                        type="button"
                        aria-label={`${name}，點按以管理成員`}
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
            <div className="mt-4 px-5">
              <button
                type="button"
                onClick={() => void handleCopyLink()}
                disabled={copying}
                className="flex w-full touch-manipulation items-center justify-center gap-2 rounded-full bg-primary py-3.5 text-sm font-medium text-primary-foreground transition active:scale-[0.99] disabled:opacity-60"
              >
                {copying ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Copy className="h-4 w-4" />
                )}
                複製邀請連結
              </button>
            </div>
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
            <AlertDialogTitle className="font-display text-lg">移除旅伴？</AlertDialogTitle>
            <AlertDialogDescription className="text-left text-sm leading-relaxed">
              確定要將「{removeTarget ? memberDisplayName(removeTarget) : ""}」從此行程移除嗎？
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
              {removing ? "移除中…" : "移除"}
            </AlertDialogAction>
            <AlertDialogCancel className="mt-0 w-full rounded-full" disabled={removing}>
              取消
            </AlertDialogCancel>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
