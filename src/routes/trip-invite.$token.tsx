import { useI18n } from "@/hooks/use-i18n";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { MobileFrame } from "@/components/MobileFrame";
import { useAuth } from "@/hooks/use-auth";
import {
  acceptTripInvite,
  clearStashedTripInviteToken,
  stashTripInviteToken,
} from "@/lib/trip/trip-collab";
import { SAVED_TRIPS_CHANGED_EVENT } from "@/lib/itinerary-storage";

export const Route = createFileRoute("/trip-invite/$token")({
  component: TripInviteAcceptPage,
});

function TripInviteAcceptPage() {
  const { t: uiT } = useI18n();

  const { token } = Route.useParams();
  const navigate = useNavigate();
  const { session, loading: authLoading } = useAuth();
  const [status, setStatus] = useState<"pending" | "accepting" | "done" | "error">("pending");
  const [message, setMessage] = useState("正在處理邀請…");
  const startedRef = useRef(false);

  useEffect(() => {
    stashTripInviteToken(token);
  }, [token]);

  useEffect(() => {
    if (authLoading || startedRef.current) return;

    if (!session) {
      setMessage("請先登入以接受邀請");
      startedRef.current = true;
      navigate({ to: "/login", replace: true });
      return;
    }

    startedRef.current = true;
    setStatus("accepting");
    void acceptTripInvite(token)
      .then((tripId) => {
        clearStashedTripInviteToken();
        setStatus("done");
        setMessage("已加入共同編輯");
        toast.success(uiT("productionUi.p0a85582906"));
        window.dispatchEvent(new Event(SAVED_TRIPS_CHANGED_EVENT));
        navigate({ to: "/saved/$tripId", params: { tripId }, replace: true });
      })
      .catch((e) => {
        setStatus("error");
        setMessage(e instanceof Error ? e.message : "無法接受邀請");
      });
  }, [uiT, authLoading, session, token, navigate]);

  return (
    <MobileFrame>
      <div className="flex min-h-[60dvh] flex-col items-center justify-center gap-4 px-8 text-center">
        {status === "accepting" || status === "pending" ? (
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        ) : null}
        <p className="text-sm text-muted-foreground">{message}</p>
        {status === "error" ? (
          <button
            type="button"
            className="rounded-full bg-primary px-6 py-2 text-sm text-primary-foreground"
            onClick={() => navigate({ to: "/saved", search: { tab: "trips" }, replace: true })}
          >
            {uiT("productionUi.pa4f10ec72f")}
          </button>
        ) : null}
      </div>
    </MobileFrame>
  );
}
