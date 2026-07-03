import { useCallback, useEffect, useState } from "react";
import { Copy, Loader2, Users } from "lucide-react";
import { toast } from "sonner";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import {
  copyInviteToClipboard,
  createTripInvite,
  listTripMembers,
  type TripMemberRow,
} from "@/lib/trip/trip-collab";
import { COPY_MANUAL_HINT } from "@/lib/copy-to-clipboard";
import { TRIP_INVITE_CREATE_FAILED_MESSAGE } from "@/lib/supabase-errors";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tripId: string;
  tripTitle: string;
  isOwner: boolean;
};

function memberDisplayName(member: TripMemberRow): string {
  return member.profile?.display_name?.trim() || "旅伴";
}

function MemberAvatar({ member }: { member: TripMemberRow }) {
  const name = memberDisplayName(member);
  const avatarUrl = member.profile?.avatar_url?.trim();

  if (avatarUrl) {
    return (
      <img
        src={avatarUrl}
        alt=""
        className="h-9 w-9 shrink-0 rounded-full object-cover bg-secondary"
      />
    );
  }

  return (
    <div
      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-secondary text-sm font-medium text-muted-foreground"
      aria-hidden
    >
      {name.slice(0, 1).toUpperCase()}
    </div>
  );
}

export function TripSharePanel({ open, onOpenChange, tripId, isOwner }: Props) {
  const [inviteToken, setInviteToken] = useState<string | null>(null);
  const [copying, setCopying] = useState(false);
  const [loadingMembers, setLoadingMembers] = useState(false);
  const [collaborators, setCollaborators] = useState<TripMemberRow[]>([]);

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
    if (!open) return;
    void refreshMembers();
  }, [open, refreshMembers]);

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

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="rounded-t-[1.75rem] border-0 bg-background px-0 pb-8"
      >
        <SheetTitle className="flex items-center gap-2 px-5 text-base font-medium">
          <Users className="h-4 w-4 shrink-0" />
          邀請共編
        </SheetTitle>

        <div className="mx-5 mt-4 overflow-hidden rounded-2xl border border-border bg-card">
          {loadingMembers ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : collaborators.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-muted-foreground">尚未有人加入</p>
          ) : (
            <ul className="divide-y divide-border">
              {collaborators.map((member) => (
                <li key={member.id} className="flex items-center gap-3 px-4 py-3">
                  <MemberAvatar member={member} />
                  <span className="min-w-0 truncate text-sm font-medium">
                    {memberDisplayName(member)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        {isOwner ? (
          <div className="mt-4 px-5">
            <button
              type="button"
              onClick={() => void handleCopyLink()}
              disabled={copying}
              className="flex w-full items-center justify-center gap-2 rounded-full bg-primary py-3.5 text-sm font-medium text-primary-foreground transition active:scale-[0.99] disabled:opacity-60"
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
  );
}
