import { useI18n } from "@/hooks/use-i18n";
import { createFileRoute, useNavigate, useRouter } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { MobileFrame } from "@/components/MobileFrame";
import { useAuth } from "@/hooks/use-auth";
import { requireAuthForAction } from "@/lib/auth-action";
import {
  acceptTripInvite,
  clearStashedTripInviteToken,
  getTripInvitePreview,
  stashTripInviteToken,
  tripInviteErrorCode,
  tripInviteStateFromErrorCode,
  type TripInvitePreview,
  type TripInviteState,
} from "@/lib/trip/trip-collab";
import { SAVED_TRIPS_CHANGED_EVENT } from "@/lib/itinerary-storage";
import {
  formatTripWorkspaceCount,
  getTripWorkspaceCopy,
  type TripWorkspaceCopy,
} from "@/lib/i18n/trip-workspace-copy";
import { resolveDisplayCoverImage } from "@/lib/saved-trip/display";
import { formatDateRangeSlash } from "@/lib/picker-utils";

export const Route = createFileRoute("/trip-invite/$token")({
  component: TripInviteAcceptPage,
});

function inviteStateMessage(state: TripInviteState, copy: TripWorkspaceCopy): string | null {
  switch (state) {
    case "revoked":
      return copy.inviteStateRevoked;
    case "expired":
      return copy.inviteStateExpired;
    case "full":
      return copy.inviteStateFull;
    case "invalid":
      return copy.inviteStateInvalid;
    default:
      return null;
  }
}

function TripInviteAcceptPage() {
  const { t: uiT, locale } = useI18n();
  const copy = getTripWorkspaceCopy(locale);

  const { token } = Route.useParams();
  const navigate = useNavigate();
  const router = useRouter();
  const { session, loading: authLoading } = useAuth();
  const [preview, setPreview] = useState<TripInvitePreview | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [joining, setJoining] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    stashTripInviteToken(token);
  }, [token]);

  useEffect(() => {
    let cancelled = false;
    setLoadFailed(false);
    setPreview(null);
    getTripInvitePreview(token)
      .then((next) => {
        if (!cancelled) setPreview(next);
      })
      .catch((e) => {
        if (cancelled) return;
        const state = tripInviteStateFromErrorCode(tripInviteErrorCode(e));
        if (state) {
          setPreview({
            state,
            tripTitle: null,
            dateStart: null,
            dateEnd: null,
            coverUrl: null,
            inviterDisplayName: null,
            memberCount: null,
          });
          return;
        }
        console.warn("[TRIP_INVITE] preview failed", e);
        setLoadFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [token, reloadKey]);

  const leave = useCallback(() => {
    clearStashedTripInviteToken();
    if (router.history.canGoBack()) {
      router.history.back();
      return;
    }
    navigate({ to: "/", replace: true });
  }, [navigate, router]);

  const handleJoin = useCallback(() => {
    if (joining) return;
    if (!session) {
      stashTripInviteToken(token);
      requireAuthForAction("collaboration");
      return;
    }
    setJoining(true);
    void acceptTripInvite(token)
      .then((tripId) => {
        clearStashedTripInviteToken();
        toast.success(uiT("productionUi.p0a85582906"));
        window.dispatchEvent(new Event(SAVED_TRIPS_CHANGED_EVENT));
        navigate({
          to: "/saved/$tripId",
          params: { tripId },
          search: { view: "overview" },
          replace: true,
        });
      })
      .catch((e) => {
        const code = tripInviteErrorCode(e);
        if (code === "not_authenticated") {
          stashTripInviteToken(token);
          requireAuthForAction("collaboration");
          return;
        }
        const state = tripInviteStateFromErrorCode(code);
        if (state) {
          setPreview((prev) =>
            prev
              ? { ...prev, state }
              : {
                  state,
                  tripTitle: null,
                  dateStart: null,
                  dateEnd: null,
                  coverUrl: null,
                  inviterDisplayName: null,
                  memberCount: null,
                },
          );
          return;
        }
        toast.error(e instanceof Error ? e.message : copy.inviteJoinFailed);
      })
      .finally(() => setJoining(false));
  }, [joining, session, token, uiT, navigate, copy.inviteJoinFailed]);

  const showTripCard = preview != null && (preview.state === "valid" || preview.state === "full");
  const stateMessage = preview ? inviteStateMessage(preview.state, copy) : null;
  const coverSrc = showTripCard
    ? resolveDisplayCoverImage({
        coverImageUrl: preview.coverUrl,
        customCoverImageUrl: null,
        aiGeneratedCoverImageUrl: null,
        isCoverCustomized: false,
      })
    : null;
  const dateLabel = showTripCard
    ? formatDateRangeSlash(preview.dateStart ?? "", preview.dateEnd ?? "")
    : "";

  return (
    <MobileFrame>
      <div className="flex min-h-[70dvh] flex-col items-center justify-center gap-5 px-6 py-10">
        {preview == null && !loadFailed ? (
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        ) : null}

        {loadFailed ? (
          <>
            <p className="text-center text-sm text-muted-foreground">{copy.inviteLoadFailed}</p>
            <div className="flex w-full max-w-sm flex-col gap-2">
              <button
                type="button"
                className="w-full rounded-full bg-primary py-3.5 text-sm font-medium text-primary-foreground"
                onClick={() => setReloadKey((k) => k + 1)}
              >
                {copy.inviteRetry}
              </button>
              <button
                type="button"
                className="w-full rounded-full bg-secondary py-3.5 text-sm font-medium text-foreground"
                onClick={leave}
              >
                {copy.inviteNotNow}
              </button>
            </div>
          </>
        ) : null}

        {showTripCard ? (
          <div className="w-full max-w-sm overflow-hidden rounded-2xl border border-border bg-card">
            {coverSrc ? (
              <img
                src={coverSrc}
                alt=""
                className="block aspect-[16/9] w-full bg-secondary object-cover"
              />
            ) : null}
            <div className="px-4 py-3">
              <h1 className="truncate text-base font-medium text-foreground">
                {preview.tripTitle?.trim() || "Roamie"}
              </h1>
              {dateLabel ? <p className="mt-1 text-xs text-muted-foreground">{dateLabel}</p> : null}
              {preview.memberCount != null ? (
                <p className="mt-1 text-xs text-muted-foreground">
                  {formatTripWorkspaceCount(
                    copy.inviteMemberCount,
                    preview.memberCount,
                    copy.inviteMemberCountOne,
                  )}
                </p>
              ) : null}
            </div>
          </div>
        ) : null}

        {stateMessage ? (
          <p className="text-center text-sm text-muted-foreground">{stateMessage}</p>
        ) : null}

        {preview?.state === "valid" ? (
          <div className="flex w-full max-w-sm flex-col gap-2">
            <button
              type="button"
              disabled={joining || authLoading}
              className="flex w-full items-center justify-center gap-2 rounded-full bg-primary py-3.5 text-sm font-medium text-primary-foreground disabled:opacity-60"
              onClick={handleJoin}
            >
              {joining ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {session || authLoading ? copy.inviteJoin : copy.inviteLoginToJoin}
            </button>
            <button
              type="button"
              disabled={joining}
              className="w-full rounded-full bg-secondary py-3.5 text-sm font-medium text-foreground disabled:opacity-60"
              onClick={leave}
            >
              {copy.inviteNotNow}
            </button>
          </div>
        ) : preview != null ? (
          <button
            type="button"
            className="w-full max-w-sm rounded-full bg-secondary py-3.5 text-sm font-medium text-foreground"
            onClick={() => {
              clearStashedTripInviteToken();
              navigate({ to: "/", replace: true });
            }}
          >
            {copy.inviteBackHome}
          </button>
        ) : null}
      </div>
    </MobileFrame>
  );
}
