import { useCallback, useEffect, useState } from "react";
import { Copy, Loader2, Share2, UserMinus, Users } from "lucide-react";
import { toast } from "sonner";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import {
  copyInviteToClipboard,
  createTripInvite,
  listTripMembers,
  removeTripMember,
  shareTripInvite,
  type TripMemberRow,
} from "@/lib/trip/trip-collab";
import { getAuthenticatedUserId } from "@/lib/auth-session";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tripId: string;
  tripTitle: string;
  isOwner: boolean;
};

export function TripSharePanel({ open, onOpenChange, tripId, tripTitle, isOwner }: Props) {
  const [loading, setLoading] = useState(false);
  const [members, setMembers] = useState<TripMemberRow[]>([]);
  const [inviteToken, setInviteToken] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);

  const refreshMembers = useCallback(async () => {
    setLoading(true);
    try {
      const rows = await listTripMembers(tripId);
      setMembers(rows);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "無法載入成員");
    } finally {
      setLoading(false);
    }
  }, [tripId]);

  useEffect(() => {
    if (!open) return;
    void getAuthenticatedUserId().then(setCurrentUserId);
    void refreshMembers();
  }, [open, refreshMembers]);

  const ensureInviteToken = useCallback(async (): Promise<string> => {
    if (inviteToken) return inviteToken;
    const invite = await createTripInvite(tripId);
    setInviteToken(invite.token);
    return invite.token;
  }, [inviteToken, tripId]);

  const handleCopyLink = async () => {
    setBusyAction("copy");
    try {
      const token = await ensureInviteToken();
      await copyInviteToClipboard(token);
      toast.success("已複製邀請連結");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "複製失敗");
    } finally {
      setBusyAction(null);
    }
  };

  const handleSystemShare = async () => {
    setBusyAction("share");
    try {
      const token = await ensureInviteToken();
      await shareTripInvite(token, tripTitle);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "分享失敗");
    } finally {
      setBusyAction(null);
    }
  };

  const handleRemoveMember = async (member: TripMemberRow) => {
    if (!isOwner || member.is_owner) return;
    setBusyAction(`remove:${member.user_id}`);
    try {
      await removeTripMember(tripId, member.user_id);
      toast.success("已移除成員");
      await refreshMembers();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "移除失敗");
    } finally {
      setBusyAction(null);
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="max-h-[80dvh] rounded-t-[1.75rem] border-0 bg-background px-0 pb-8"
      >
        <SheetTitle className="flex items-center gap-2 px-5 text-base font-medium">
          <Users className="h-4 w-4" />
          共同編輯行程
        </SheetTitle>

        <div className="mt-4 space-y-4 px-5">
          <div>
            <p className="text-xs font-medium text-muted-foreground">共同編輯成員</p>
            <div className="mt-2 max-h-40 overflow-y-auto rounded-2xl border border-border bg-card">
              {loading ? (
                <div className="flex justify-center py-6">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
              ) : members.length === 0 ? (
                <p className="px-4 py-6 text-center text-sm text-muted-foreground">尚無成員</p>
              ) : (
                <ul className="divide-y divide-border">
                  {members.map((member) => {
                    const name =
                      member.profile?.display_name?.trim() ||
                      (member.is_owner ? "建立者" : "旅伴");
                    const canRemove =
                      isOwner && !member.is_owner && member.user_id !== currentUserId;
                    return (
                      <li
                        key={member.id}
                        className="flex items-center justify-between gap-3 px-4 py-3"
                      >
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium">{name}</p>
                          <p className="text-xs text-muted-foreground">
                            {member.is_owner ? "建立者" : "共同編輯"}
                          </p>
                        </div>
                        {canRemove ? (
                          <button
                            type="button"
                            onClick={() => void handleRemoveMember(member)}
                            disabled={busyAction === `remove:${member.user_id}`}
                            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-secondary"
                            aria-label={`移除 ${name}`}
                          >
                            {busyAction === `remove:${member.user_id}` ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <UserMinus className="h-4 w-4" />
                            )}
                          </button>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>

          <div className="flex flex-col gap-2">
            {isOwner ? (
              <>
                <button
                  type="button"
                  onClick={() => void handleCopyLink()}
                  disabled={busyAction === "copy"}
                  className="flex w-full items-center justify-center gap-2 rounded-full border border-border bg-card py-3 text-sm font-medium transition active:scale-[0.99] disabled:opacity-60"
                >
                  {busyAction === "copy" ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Copy className="h-4 w-4" />
                  )}
                  複製邀請連結
                </button>
                <button
                  type="button"
                  onClick={() => void handleSystemShare()}
                  disabled={busyAction === "share"}
                  className="flex w-full items-center justify-center gap-2 rounded-full bg-primary py-3 text-sm font-medium text-primary-foreground transition active:scale-[0.99] disabled:opacity-60"
                >
                  {busyAction === "share" ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Share2 className="h-4 w-4" />
                  )}
                  系統分享
                </button>
              </>
            ) : (
              <p className="rounded-2xl bg-secondary/60 px-4 py-3 text-center text-xs text-muted-foreground">
                僅建立者可產生邀請連結與管理成員。
              </p>
            )}
          </div>

          <p className="text-center text-xs text-muted-foreground">
            加入後即可共同編輯行程內容，無需權限分級。
          </p>
        </div>
      </SheetContent>
    </Sheet>
  );
}
