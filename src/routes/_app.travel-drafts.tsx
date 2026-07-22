import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ChevronLeft, Trash2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
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
import { PlusUpgradeDialog } from "@/components/PlusUpgradeDialog";
import { useAccess } from "@/hooks/use-access";
import { useAuth } from "@/hooks/use-auth";
import { useI18n } from "@/hooks/use-i18n";
import {
  deleteConversationWorkspace,
  hydrateConversationWorkspaces,
  listConversationWorkspaces,
  mergeRemoteConversationWorkspaces,
  pushConversationWorkspacesRemote,
  type ConversationWorkspaceListItem,
} from "@/lib/conversation-workspace";

export const Route = createFileRoute("/_app/travel-drafts")({
  component: TravelDraftsPage,
});

const PAGE_SIZE = 20;

function TravelDraftsPage() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { hasPlusAccess, subscriptionHydrated } = useAccess();
  const userId = user?.id ?? null;
  const scrollRef = useRef<HTMLElement | null>(null);
  const scrollTopRef = useRef(0);

  const [drafts, setDrafts] = useState<ConversationWorkspaceListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [upgradeOpen, setUpgradeOpen] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const applyList = useCallback(
    (items: ConversationWorkspaceListItem[], meta?: { cursor?: string | null }) => {
      const sorted = [...items].sort((a, b) =>
        (a.updatedAt ?? "") < (b.updatedAt ?? "") ? 1 : -1,
      );
      console.info("[WORKSPACE_LIST_RENDER]", {
        workspaceCount: sorted.length,
        userId: userId ?? "(guest)",
        cursor: meta?.cursor ?? null,
        pageSize: PAGE_SIZE,
      });
      setDrafts(sorted);
    },
    [userId],
  );

  const reload = useCallback(() => {
    if (!hasPlusAccess) {
      // Visibility only — never wipe durable storage for Free
      setDrafts([]);
      return;
    }
    applyList(listConversationWorkspaces(userId));
  }, [applyList, hasPlusAccess, userId]);

  useEffect(() => {
    if (!subscriptionHydrated) return;
    if (!hasPlusAccess) {
      setLoading(false);
      setUpgradeOpen(true);
      return;
    }
    let cancelled = false;
    setLoading(true);
    void (async () => {
      console.info("[WORKSPACE_LIST_FETCH_START]", {
        userId: userId ?? "(guest)",
        cursor: null,
        pageSize: PAGE_SIZE,
      });
      await hydrateConversationWorkspaces(userId);
      let remoteMerged = 0;
      if (userId) {
        remoteMerged = await mergeRemoteConversationWorkspaces(userId).catch(() => 0);
      }
      if (cancelled) return;
      const list = listConversationWorkspaces(userId);
      console.info("[WORKSPACE_LIST_FETCH_RESULT]", {
        receivedCount: list.length,
        totalLoadedCount: list.length,
        hasMore: false,
        nextCursor: null,
        remoteMerged,
      });
      applyList(list, { cursor: null });
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [hasPlusAccess, subscriptionHydrated, applyList, userId]);

  const confirmDelete = () => {
    if (!deleteId) return;
    const workspaceId = deleteId;
    const savedScroll = scrollRef.current?.scrollTop ?? scrollTopRef.current;
    deleteConversationWorkspace(workspaceId, userId);
    if (userId) {
      void pushConversationWorkspacesRemote(userId);
    }
    const remaining = listConversationWorkspaces(userId);
    console.info("[WORKSPACE_DELETE_RESULT]", {
      workspaceId,
      success: true,
      remainingCount: remaining.length,
    });
    setDeleteId(null);
    applyList(remaining);
    // Keep scroll position after row removal
    requestAnimationFrame(() => {
      if (scrollRef.current) {
        scrollRef.current.scrollTop = savedScroll;
      }
    });
  };

  const openWorkspace = (workspaceId: string) => {
    // Push (not replace) so iOS swipe-back keeps travel-drafts in the stack.
    // Chat back uses entrySource=travel_draft → /travel-drafts (not home).
    void navigate({
      to: "/chat",
      search: { workspaceId, from: "travel-draft" },
    });
  };

  const onScrollEndCheck = () => {
    const el = scrollRef.current;
    if (!el) return;
    scrollTopRef.current = el.scrollTop;
    const nearBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 48;
    if (nearBottom) {
      console.info("[WORKSPACE_LIST_SCROLL_END]", {
        hasMore: false,
        loadingMore: false,
        workspaceCount: drafts.length,
      });
    }
  };

  if (!subscriptionHydrated || loading) {
    return (
      <div className="flex flex-1 items-center justify-center px-5 text-sm text-muted-foreground">
        {t("trip.travelDraftLoading")}
      </div>
    );
  }

  if (!hasPlusAccess) {
    return (
      <div className="travel-drafts-page flex min-h-0 w-full min-w-0 flex-1 flex-col overflow-hidden px-5 pt-3">
        <header className="travel-drafts-header mb-4 flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={() => void navigate({ to: "/profile" })}
            className="flex h-9 w-9 items-center justify-center rounded-full bg-secondary"
            aria-label={t("profile.back")}
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
          <h1 className="font-display text-lg">{t("trip.travelDraft")}</h1>
        </header>
        <p className="text-sm text-muted-foreground">{t("trip.travelDraftPlusOnly")}</p>
        <PlusUpgradeDialog
          open={upgradeOpen}
          onOpenChange={(open) => {
            setUpgradeOpen(open);
            if (!open) void navigate({ to: "/profile" });
          }}
          feature="general"
        />
      </div>
    );
  }

  return (
    <div className="travel-drafts-page flex min-h-0 w-full min-w-0 flex-1 flex-col overflow-hidden px-5 pt-3">
      <header className="travel-drafts-header mb-4 flex shrink-0 items-center gap-2">
        <button
          type="button"
          onClick={() => void navigate({ to: "/profile" })}
          className="flex h-9 w-9 items-center justify-center rounded-full bg-secondary"
          aria-label={t("profile.back")}
        >
          <ChevronLeft className="h-5 w-5" />
        </button>
        <h1 className="font-display text-lg">{t("trip.travelDraft")}</h1>
      </header>

      <main
        ref={scrollRef}
        className="travel-drafts-scroll min-h-0 flex-1 overflow-y-auto overscroll-y-contain pb-4"
        onScroll={onScrollEndCheck}
      >
        {drafts.length === 0 ? (
          <section className="mt-8 rounded-3xl border border-border bg-card px-5 py-8 text-center shadow-soft">
            <p className="font-display text-base">{t("trip.travelDraftEmptyTitle")}</p>
            <p className="mt-2 text-sm text-muted-foreground">
              {t("trip.travelDraftEmptyHint")}
            </p>
            <Link
              to="/chat"
              className="mt-6 inline-flex items-center justify-center rounded-2xl bg-foreground px-4 py-2.5 text-sm text-background"
            >
              {t("trip.travelDraftStartNew")}
            </Link>
          </section>
        ) : (
          <ul className="travel-drafts-list shrink-0 rounded-3xl border border-border bg-card shadow-soft">
            {drafts.map((draft, i) => {
              const title =
                draft.title || draft.destination || t("trip.travelDraft");
              return (
                <li
                  key={draft.workspaceId}
                  className={
                    i !== drafts.length - 1 ? "border-b border-border" : undefined
                  }
                >
                  <div
                    className="travel-draft-row flex min-h-[74px] cursor-pointer items-center gap-3 px-4 py-3.5 pl-[22px] pr-4"
                    role="button"
                    tabIndex={0}
                    onClick={() => openWorkspace(draft.workspaceId)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        openWorkspace(draft.workspaceId);
                      }
                    }}
                  >
                    <span className="travel-draft-title min-w-0 flex-1 truncate text-lg font-semibold leading-[1.4]">
                      {title}
                    </span>
                    <button
                      type="button"
                      className="travel-draft-delete-button inline-flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-full border border-border bg-card text-muted-foreground active:scale-95 active:opacity-80"
                      aria-label={`${t("trip.travelDraftDelete")} ${title}`}
                      onClick={(event) => {
                        event.stopPropagation();
                        setDeleteId(draft.workspaceId);
                      }}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </main>

      <AlertDialog open={Boolean(deleteId)} onOpenChange={(open) => !open && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("trip.travelDraftDeleteTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("trip.travelDraftDeleteHint")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("profile.cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete}>
              {t("trip.travelDraftDelete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
