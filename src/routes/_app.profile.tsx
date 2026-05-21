import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ChevronRight, Settings, Bell, Sparkles, BookMarked, HeartHandshake, LogOut, Pencil } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/use-auth";
import { useAvatar } from "@/hooks/use-avatar";
import { AvatarPickerSheet } from "@/components/AvatarPickerSheet";
import { listItineraries } from "@/lib/itinerary-storage";
import { listPlaces } from "@/lib/places-storage";
import {
  BUDGET_MODE_LABELS,
  resolveBudgetMode,
} from "@/lib/preferences-storage";
import { getUserProfile, saveUserProfile } from "@/lib/profile-storage";

type ProfileSearch = { quiz?: string };

export const Route = createFileRoute("/_app/profile")({
  validateSearch: (s: Record<string, unknown>): ProfileSearch => ({
    quiz: typeof s.quiz === "string" ? s.quiz : undefined,
  }),
  component: Profile,
});

const paceLabel: Record<string, string> = { slow: "慢", medium: "中等", active: "想多看" };
const vibeLabel: Record<string, string> = { quiet: "安靜", either: "都可以", lively: "熱鬧" };
const avoidLabel: Record<string, string> = {
  crowds: "人潮太多",
  packed: "行程太滿",
  overload: "資訊過多",
};

function Profile() {
  const search = Route.useSearch();
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const { avatarSrc, setPreview, refresh: refreshAvatar } = useAvatar();
  const [avatarPickerOpen, setAvatarPickerOpen] = useState(false);

  const [tripCount, setTripCount] = useState(0);
  const [placeCount, setPlaceCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showQuizResult, setShowQuizResult] = useState(false);

  const [displayName, setDisplayName] = useState("旅人");
  const [bio, setBio] = useState("");
  const [travelStyle, setTravelStyle] = useState("");
  const [personalityType, setPersonalityType] = useState("");
  const [personalitySummary, setPersonalitySummary] = useState("");
  const [personalityImpression, setPersonalityImpression] = useState("");
  const [onboarded, setOnboarded] = useState(false);
  const [pace, setPace] = useState("");
  const [vibe, setVibe] = useState("");
  const [budgetLabel, setBudgetLabel] = useState("—");
  const [avoidKey, setAvoidKey] = useState<string | null>(null);

  const refresh = async () => {
    setLoading(true);
    try {
      const [t, p, profile] = await Promise.all([listItineraries(), listPlaces(), getUserProfile()]);
      setTripCount(t.length);
      setPlaceCount(p.length);
      setDisplayName(profile.displayName);
      setBio(profile.bio);
      await refreshAvatar();
      setTravelStyle(profile.travelStyle);
      setPersonalityType(profile.personalityType);
      setPersonalitySummary(profile.personalitySummary);
      setPersonalityImpression(profile.personalityImpression);
      setOnboarded(!!profile.prefs.onboarded);
      setPace(profile.prefs.pace ? paceLabel[profile.prefs.pace] : "—");
      setVibe(profile.prefs.vibe ? vibeLabel[profile.prefs.vibe] : "—");
      setBudgetLabel(
        profile.prefs.onboarded ? BUDGET_MODE_LABELS[resolveBudgetMode(profile.prefs)] : "—",
      );
      setAvoidKey(profile.prefs.avoid?.[0] ?? null);
      setShowQuizResult(!!profile.prefs.onboarded);
    } catch {
      toast.error("讀取個人資料失敗");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refresh();
  }, []);

  useEffect(() => {
    if (search.quiz === "done") {
      setShowQuizResult(true);
      toast.success("旅行個性測驗已完成");
    }
  }, [search.quiz]);

  const handleSaveProfile = async () => {
    setSaving(true);
    try {
      await saveUserProfile({ displayName, bio, travelStyle });
      setEditing(false);
      toast.success("已儲存");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "儲存失敗");
    } finally {
      setSaving(false);
    }
  };

  const handleSignOut = async () => {
    try {
      await signOut();
      toast.success("已登出");
      navigate({ to: "/login" });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "登出失敗");
    }
  };

  const items = [
    { icon: BookMarked, label: "已收藏的行程", value: `${tripCount} 個`, to: "/saved" as const },
    {
      icon: HeartHandshake,
      label: "已收藏的地點",
      value: `${placeCount} 個`,
      to: "/saved" as const,
      search: { tab: "places" },
    },
    { icon: Bell, label: "提醒方式", value: "輕聲一點", action: () => toast("通知設定即將推出") },
    { icon: Settings, label: "其他設定", value: "", action: () => toast("設定頁即將推出") },
  ];

  return (
    <div className="px-5 pb-8 pt-3">
      <div className="flex items-center justify-end">
        <button onClick={handleSignOut} className="flex items-center gap-1 text-sm text-muted-foreground">
          <LogOut className="h-3.5 w-3.5" /> 登出
        </button>
      </div>

      <div className="mt-3 overflow-hidden rounded-[2rem] border border-border bg-card shadow-soft">
        <div className="relative h-24 bg-gradient-to-br from-accent to-secondary">
          <button
            type="button"
            onClick={() => setAvatarPickerOpen(true)}
            className="absolute -bottom-8 left-5 h-20 w-20 overflow-hidden rounded-3xl border-4 border-card bg-secondary"
            aria-label="更換頭像"
          >
            <img src={avatarSrc} alt="" className="h-full w-full object-cover" />
          </button>
          <AvatarPickerSheet
            open={avatarPickerOpen}
            onOpenChange={setAvatarPickerOpen}
            currentSrc={avatarSrc}
            onPreview={setPreview}
          />
        </div>
        <div className="px-5 pb-5 pt-12">
          {editing ? (
            <div className="space-y-3">
              <label className="block">
                <span className="text-[11px] text-muted-foreground">名稱</span>
                <input
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-border bg-secondary px-3 py-2 text-sm"
                />
              </label>
              <label className="block">
                <span className="text-[11px] text-muted-foreground">個人簡介</span>
                <textarea
                  value={bio}
                  onChange={(e) => setBio(e.target.value)}
                  rows={2}
                  className="mt-1 w-full rounded-xl border border-border bg-secondary px-3 py-2 text-sm"
                  placeholder="一句話介紹自己"
                />
              </label>
              <label className="block">
                <span className="text-[11px] text-muted-foreground">旅行風格描述</span>
                <textarea
                  value={travelStyle}
                  onChange={(e) => setTravelStyle(e.target.value)}
                  rows={2}
                  className="mt-1 w-full rounded-xl border border-border bg-secondary px-3 py-2 text-sm"
                  placeholder="例如：喜歡巷弄、不趕路、愛找小店"
                />
              </label>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setEditing(false)}
                  className="flex-1 rounded-full border border-border py-2.5 text-sm"
                >
                  取消
                </button>
                <button
                  type="button"
                  onClick={handleSaveProfile}
                  disabled={saving}
                  className="flex-1 rounded-full bg-primary py-2.5 text-sm text-primary-foreground disabled:opacity-50"
                >
                  {saving ? "儲存中…" : "儲存"}
                </button>
              </div>
            </div>
          ) : (
            <>
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="font-display text-xl leading-tight">{displayName}</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {bio || "慢慢的旅人"}
                    {user?.email ? ` · ${user.email}` : " · 訪客模式"}
                  </p>
                  {travelStyle ? (
                    <p className="mt-2 text-sm leading-relaxed text-foreground/80">{travelStyle}</p>
                  ) : null}
                </div>
                <button
                  type="button"
                  onClick={() => setEditing(true)}
                  className="rounded-full bg-secondary p-2 text-muted-foreground"
                  aria-label="編輯個人資料"
                >
                  <Pencil className="h-4 w-4" />
                </button>
              </div>
              {onboarded && (
                <div className="mt-4 flex gap-2">
                  {[
                    { k: "步調", v: pace },
                    { k: "氣氛", v: vibe },
                    { k: "預算", v: budgetLabel },
                  ].map((p) => (
                    <div key={p.k} className="flex-1 rounded-2xl bg-secondary px-3 py-2.5 text-center">
                      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{p.k}</p>
                      <p className="mt-0.5 text-sm font-medium">{p.v}</p>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {showQuizResult && onboarded && !loading ? (
        <div className="mt-5 rounded-3xl border border-border bg-card p-5 shadow-soft">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Sparkles className="h-3.5 w-3.5 text-clay" />
            旅行個性測驗結果
          </div>
          <p className="mt-2 font-display text-xl">{personalityType}</p>
          <p className="mt-2 text-sm text-muted-foreground">{personalitySummary}</p>
          {avoidKey && (
            <p className="mt-2 text-xs text-muted-foreground">
              想避開：{avoidLabel[avoidKey] ?? avoidKey}
            </p>
          )}
          <div className="mt-4 rounded-2xl bg-secondary p-4">
            <p className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground">Roamie 對你的印象</p>
            <p className="mt-2 font-display text-[17px] leading-snug">{personalityImpression}</p>
          </div>
          <div className="mt-4 flex gap-2">
            <Link
              to="/onboarding"
              search={{ from: "profile" }}
              className="flex-1 rounded-full border border-border py-3 text-center text-sm"
            >
              重新測驗
            </Link>
            <button
              type="button"
              onClick={() => setShowQuizResult(false)}
              className="flex-1 rounded-full bg-primary py-3 text-center text-sm text-primary-foreground"
            >
              返回
            </button>
          </div>
        </div>
      ) : (
        <div className="mt-5 rounded-3xl bg-secondary p-5">
          <p className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground">Roamie 對你的印象</p>
          <p className="mt-2 font-display text-[17px] leading-snug">
            {onboarded ? personalityImpression : "「我們還不太認識你，做個小測驗幫我了解你的旅行步調吧。」"}
          </p>
          {!onboarded && (
            <Link
              to="/onboarding"
              search={{ from: "profile" }}
              className="mt-4 block rounded-full bg-primary py-3 text-center text-sm text-primary-foreground"
            >
              開始旅行個性測驗
            </Link>
          )}
        </div>
      )}

      <ul className="mt-6 overflow-hidden rounded-3xl border border-border bg-card">
        {onboarded && (
          <li className="border-b border-border">
            <button
              type="button"
              onClick={() => setShowQuizResult(true)}
              className="flex w-full items-center gap-3 px-4 py-3.5 text-left"
            >
              <div className="flex h-9 w-9 items-center justify-center rounded-2xl bg-secondary">
                <Sparkles className="h-4 w-4" />
              </div>
              <p className="flex-1 text-[15px]">旅行個性</p>
              <p className="text-sm text-muted-foreground">查看結果</p>
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
            </button>
          </li>
        )}
        {items.map((it, i) => {
          const Icon = it.icon;
          const inner = (
            <>
              <div className="flex h-9 w-9 items-center justify-center rounded-2xl bg-secondary">
                <Icon className="h-4 w-4" />
              </div>
              <p className="flex-1 text-[15px]">{it.label}</p>
              {it.value && <p className="text-sm text-muted-foreground">{it.value}</p>}
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
            </>
          );
          const cls = `flex w-full items-center gap-3 px-4 py-3.5 text-left ${i !== items.length - 1 ? "border-b border-border" : ""}`;
          if ("to" in it && it.to) {
            const itemSearch = "search" in it ? it.search : undefined;
            return (
              <li key={it.label}>
                <Link to={it.to} search={itemSearch} className={cls}>
                  {inner}
                </Link>
              </li>
            );
          }
          return (
            <li key={it.label}>
              <button onClick={"action" in it ? it.action : undefined} className={cls}>
                {inner}
              </button>
            </li>
          );
        })}
      </ul>

      {onboarded && !showQuizResult && (
        <Link
          to="/onboarding"
          search={{ from: "profile" }}
          className="mt-6 block rounded-full border border-border bg-card py-3.5 text-center text-sm"
        >
          重新做一次旅行個性測驗
        </Link>
      )}

      <p className="mt-8 text-center text-[11px] leading-relaxed text-muted-foreground">
        Roamie · 不催促、不塞滿，只是陪你把下一趟走得舒服一點。
      </p>
    </div>
  );
}
