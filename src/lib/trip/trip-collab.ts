import { registerPlugin } from "@capacitor/core";
import { supabase } from "@/integrations/supabase/client";
import { getAuthenticatedUserId } from "@/lib/auth-session";
import { isMissingTableError, formatTripCollabError } from "@/lib/supabase-errors";
import { copyTextToClipboard, type CopyTextResult } from "@/lib/copy-to-clipboard";
import type { TripMemberProfileFields } from "@/lib/trip/collab-member-display";
import { formatTripWorkspaceTemplate, getTripWorkspaceCopy } from "@/lib/i18n/trip-workspace-copy";
import { detectPlatform } from "@/services/platform";

export type TripMemberProfile = TripMemberProfileFields;

export type TripMemberRow = {
  id: string;
  trip_id: string;
  user_id: string;
  is_owner: boolean;
  status: "pending" | "accepted";
  invited_by: string | null;
  created_at: string;
  profile?: TripMemberProfile | null;
};

type TripMemberPublicProfileRow = {
  user_id: string;
  display_name: string | null;
  avatar_url: string | null;
};

type TripMemberJoinedRow = {
  id: string;
  trip_id: string;
  user_id: string;
  is_owner: boolean;
  status: string;
  invited_by: string | null;
  created_at: string;
  profiles?: TripMemberProfileFields | TripMemberProfileFields[] | null;
};

export type TripInviteRow = {
  id: string;
  trip_id: string;
  inviter_id: string;
  token: string;
  status: string;
  /** 長期邀請連結（is_link）為 null */
  expires_at: string | null;
  created_at: string;
  is_link?: boolean;
  revoked_at?: string | null;
};

/** create_trip_invite 回傳的長期邀請連結 */
export type TripInviteLink = {
  id: string;
  token: string;
};

export type TripInviteState = "valid" | "full" | "revoked" | "expired" | "invalid";

export type TripInvitePreview = {
  state: TripInviteState;
  tripTitle: string | null;
  dateStart: string | null;
  dateEnd: string | null;
  /** 原始封面網址；顯示前須套用 resolveDisplayCoverImage */
  coverUrl: string | null;
  inviterDisplayName: string | null;
  memberCount: number | null;
};

export type TripInviteErrorCode =
  | "not_authenticated"
  | "invite_malformed"
  | "invite_not_found"
  | "invite_revoked"
  | "invite_invalid"
  | "invite_expired"
  | "trip_full"
  | "not_trip_owner"
  | "invite_rate_limited"
  /** 用戶端連線失敗（離線，或 fetch 失敗：postgrest 回 { message: "TypeError: Failed to fetch"／"Load failed" }） */
  | "network";

const TRIP_INVITE_ERROR_CODES: readonly TripInviteErrorCode[] = [
  "not_authenticated",
  "invite_malformed",
  "invite_not_found",
  "invite_revoked",
  "invite_invalid",
  "invite_expired",
  "trip_full",
  "not_trip_owner",
  "invite_rate_limited",
];

export class TripInviteError extends Error {
  readonly code: TripInviteErrorCode | null;
  constructor(code: TripInviteErrorCode | null, message: string) {
    super(message);
    this.name = "TripInviteError";
    this.code = code;
  }
}

/** 讀取錯誤訊息：Error 實例或 postgrest 回傳的一般物件 { message, code } */
function tripCollabErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "object" && error && "message" in error) {
    return String((error as { message: unknown }).message ?? "");
  }
  return String(error ?? "");
}

function isTripCollabNetworkError(msg: string): boolean {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return true;
  return /failed to fetch|load failed|network ?error|networkerror|network request failed/i.test(
    msg,
  );
}

/** 從 RPC exception message 取出邀請錯誤碼（無伺服端錯誤碼但為連線失敗時回 "network"） */
export function tripInviteErrorCode(error: unknown): TripInviteErrorCode | null {
  if (error instanceof TripInviteError) return error.code;
  const msg = tripCollabErrorMessage(error);
  const code = TRIP_INVITE_ERROR_CODES.find((c) => msg.includes(c));
  if (code) return code;
  return isTripCollabNetworkError(msg) ? "network" : null;
}

export type TripInviteCreateErrorKey =
  | "inviteNotOwner"
  | "inviteRateLimited"
  | "inviteNotAuthenticated"
  | "inviteNetworkError"
  | "inviteCreateFailed";

/** create_trip_invite 失敗 → 文案 key（依錯誤碼；TripSharePanel 與 TripInviteSheet 共用） */
export function tripInviteCreateErrorKey(error: unknown): TripInviteCreateErrorKey {
  switch (tripInviteErrorCode(error)) {
    case "not_trip_owner":
      return "inviteNotOwner";
    case "invite_rate_limited":
      return "inviteRateLimited";
    case "not_authenticated":
      return "inviteNotAuthenticated";
    case "network":
      return "inviteNetworkError";
    default:
      return "inviteCreateFailed";
  }
}

/** 錯誤碼對應的邀請狀態（無對應時為 null） */
export function tripInviteStateFromErrorCode(
  code: TripInviteErrorCode | null,
): Exclude<TripInviteState, "valid"> | null {
  switch (code) {
    case "invite_revoked":
      return "revoked";
    case "invite_expired":
      return "expired";
    case "trip_full":
      return "full";
    case "invite_malformed":
    case "invite_not_found":
    case "invite_invalid":
      return "invalid";
    default:
      return null;
  }
}

function tripInviteErrorMessage(code: TripInviteErrorCode | null, fallback: string): string {
  const copy = getTripWorkspaceCopy();
  switch (code) {
    case "not_authenticated":
      return copy.inviteNotAuthenticated;
    case "invite_revoked":
      return copy.inviteStateRevoked;
    case "invite_expired":
      return copy.inviteStateExpired;
    case "trip_full":
      return copy.inviteStateFull;
    case "invite_malformed":
    case "invite_not_found":
    case "invite_invalid":
      return copy.inviteStateInvalid;
    case "not_trip_owner":
      return copy.inviteNotOwner;
    case "invite_rate_limited":
      return copy.inviteRateLimited;
    default:
      return fallback;
  }
}

function toTripInviteError(error: unknown, fallback: string): TripInviteError {
  const code = tripInviteErrorCode(error);
  return new TripInviteError(
    code,
    code
      ? tripInviteErrorMessage(code, fallback)
      : formatTripCollabError(
          error instanceof Error || isMissingTableError(error)
            ? error
            : tripCollabErrorMessage(error),
          fallback,
        ),
  );
}

export type TripAccess = {
  tripId: string;
  isOwner: boolean;
  isMember: boolean;
};

const INVITE_STASH_KEY = "roamie:pending-trip-invite-token";

/** 邀請連結網域（Universal Link：applinks:roamie.tw） */
export const TRIP_INVITE_WEB_ORIGIN = "https://roamie.tw";

/** `openExternalBrowser=1`：LINE 官方參數，讓 LINE 改用外部瀏覽器開啟（內建 WebView 不觸發 Universal Link） */
export function buildTripInviteUrl(token: string): string {
  return `${TRIP_INVITE_WEB_ORIGIN}/trip-invite/${encodeURIComponent(token)}?openExternalBrowser=1`;
}

export function stashTripInviteToken(token: string): void {
  try {
    sessionStorage.setItem(INVITE_STASH_KEY, token);
  } catch {
    // ignore
  }
}

export function readStashedTripInviteToken(): string | null {
  try {
    return sessionStorage.getItem(INVITE_STASH_KEY);
  } catch {
    return null;
  }
}

export function clearStashedTripInviteToken(): void {
  try {
    sessionStorage.removeItem(INVITE_STASH_KEY);
  } catch {
    // ignore
  }
}

function normalizeJoinedProfile(
  raw: TripMemberProfileFields | TripMemberProfileFields[] | null | undefined,
): TripMemberProfile | null {
  if (!raw) return null;
  const row = Array.isArray(raw) ? raw[0] : raw;
  if (!row) return null;
  return {
    display_name: row.display_name,
    avatar_url: row.avatar_url,
    email: row.email,
    full_name: row.full_name,
    username: row.username,
    profile_updated_at: row.profile_updated_at ?? (row as { updated_at?: string }).updated_at,
  };
}

function profileFromRpcRow(row: TripMemberPublicProfileRow): TripMemberProfile {
  return {
    display_name: row.display_name,
    avatar_url: row.avatar_url,
  };
}

function profileFromDirectRow(p: {
  id: string;
  display_name: string | null;
  avatar_url: string | null;
  updated_at: string;
}): TripMemberProfile {
  return {
    display_name: p.display_name,
    avatar_url: p.avatar_url,
    profile_updated_at: p.updated_at,
  };
}

export async function getTripAccess(tripId: string): Promise<TripAccess> {
  const userId = await getAuthenticatedUserId();
  if (!userId) return { tripId, isOwner: false, isMember: false };

  const { data: trip } = await supabase
    .from("saved_trips")
    .select("user_id")
    .eq("id", tripId)
    .maybeSingle();

  if (trip?.user_id === userId) {
    return { tripId, isOwner: true, isMember: true };
  }

  const { data: member, error } = await supabase
    .from("trip_members")
    .select("is_owner, status")
    .eq("trip_id", tripId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error && !isMissingTableError(error)) {
    console.warn("[TRIP_COLLAB] getTripAccess", error.message);
  }

  const accepted = member?.status === "accepted";
  return {
    tripId,
    isOwner: Boolean(member?.is_owner && accepted),
    isMember: accepted,
  };
}

async function fetchTripMembersRaw(tripId: string): Promise<TripMemberRow[]> {
  const { data, error } = await supabase
    .from("trip_members")
    .select("id, trip_id, user_id, is_owner, status, invited_by, created_at")
    .eq("trip_id", tripId)
    .eq("status", "accepted")
    .order("created_at", { ascending: true });

  if (error) {
    if (isMissingTableError(error)) return [];
    throw new Error(error.message);
  }

  return (data ?? []) as TripMemberRow[];
}

async function fetchTripMembersWithJoin(tripId: string): Promise<TripMemberRow[] | null> {
  const { data, error } = await supabase
    .from("trip_members")
    .select(
      `
      id,
      trip_id,
      user_id,
      is_owner,
      status,
      invited_by,
      created_at,
      profiles:user_id (
        id,
        display_name,
        avatar_url,
        updated_at
      )
    `,
    )
    .eq("trip_id", tripId)
    .eq("status", "accepted")
    .order("created_at", { ascending: true });

  if (error) {
    console.warn("[TRIP_COLLAB] trip_members join profiles failed", error.message);
    return null;
  }

  return (data as TripMemberJoinedRow[]).map((row) => ({
    id: row.id,
    trip_id: row.trip_id,
    user_id: row.user_id,
    is_owner: row.is_owner,
    status: row.status as TripMemberRow["status"],
    invited_by: row.invited_by,
    created_at: row.created_at,
    profile: normalizeJoinedProfile(row.profiles),
  }));
}

async function fetchTripMemberProfilesViaRpc(
  tripId: string,
): Promise<Map<string, TripMemberProfile>> {
  const map = new Map<string, TripMemberProfile>();

  const { data: rpcRows, error: rpcError } = await supabase.rpc("get_trip_member_public_profiles", {
    p_trip_id: tripId,
  });

  if (rpcError) {
    console.warn("[TRIP_COLLAB] get_trip_member_public_profiles failed", rpcError.message);
    return map;
  }

  for (const row of (rpcRows ?? []) as TripMemberPublicProfileRow[]) {
    map.set(row.user_id, profileFromRpcRow(row));
  }

  return map;
}

async function fetchTripMemberProfilesDirect(
  userIds: string[],
): Promise<Map<string, TripMemberProfile>> {
  const map = new Map<string, TripMemberProfile>();
  const uniqueIds = [...new Set(userIds.filter(Boolean))];
  if (uniqueIds.length === 0) return map;

  console.info(`[TRIP_MEMBER_PROFILE_QUERY_START] userIds=${uniqueIds.join(",")}`);

  const { data: profiles, error: profileError } = await supabase
    .from("profiles")
    .select("id, display_name, avatar_url, updated_at")
    .in("id", uniqueIds);

  if (profileError) {
    console.warn("[TRIP_COLLAB] profiles query failed", profileError.message);
    return map;
  }

  if (!profiles?.length) {
    console.info("[TRIP_MEMBER_PROFILE_QUERY_EMPTY]");
    return map;
  }

  console.info(
    `[TRIP_MEMBER_PROFILE_QUERY_SUCCESS] profiles=${profiles.map((p) => p.id).join(",")}`,
  );

  for (const p of profiles) {
    map.set(p.id, profileFromDirectRow(p));
  }

  return map;
}

async function attachProfilesToMembers(
  tripId: string,
  members: TripMemberRow[],
): Promise<TripMemberRow[]> {
  if (members.length === 0) return members;

  const userIds = members.map((m) => m.user_id);
  const profileMap = await fetchTripMemberProfilesViaRpc(tripId);

  const missingAfterRpc = userIds.filter((id) => !profileMap.has(id));
  if (missingAfterRpc.length > 0) {
    const directMap = await fetchTripMemberProfilesDirect(missingAfterRpc);
    for (const [id, profile] of directMap) {
      profileMap.set(id, profile);
    }
  }

  return members.map((member) => {
    const profile = profileMap.get(member.user_id) ?? null;
    return { ...member, profile };
  });
}

export async function listTripMembers(tripId: string): Promise<TripMemberRow[]> {
  const joined = await fetchTripMembersWithJoin(tripId);
  let members = joined ?? (await fetchTripMembersRaw(tripId));

  console.info(
    `[TRIP_MEMBERS_RAW] tripId=${tripId} members=${JSON.stringify(
      members.map((m) => ({
        id: m.id,
        user_id: m.user_id,
        is_owner: m.is_owner,
        status: m.status,
        created_at: m.created_at,
      })),
    )}`,
  );

  for (const member of members) {
    if (member.user_id?.trim()) {
      console.info(`[TRIP_MEMBER_HAS_USER_ID] memberId=${member.id} userId=${member.user_id}`);
    } else {
      console.info(`[TRIP_MEMBER_MISSING_USER_ID] memberId=${member.id}`);
    }
  }

  if (members.length === 0) return [];

  const needsProfileFetch = members.some((m) => m.profile == null);
  if (needsProfileFetch) {
    members = await attachProfilesToMembers(tripId, members);
  }

  return members;
}

/**
 * 建立（或取回既有開啟中的）長期邀請連結。只有擁有者可呼叫；token 由伺服端產生。
 */
export async function createTripInvite(tripId: string): Promise<TripInviteLink> {
  const copy = getTripWorkspaceCopy();
  const userId = await getAuthenticatedUserId();
  if (!userId) throw new TripInviteError("not_authenticated", copy.inviteNotAuthenticated);

  const { data, error } = await supabase.rpc("create_trip_invite", { p_trip_id: tripId });

  if (error) throw toTripInviteError(error, copy.inviteCreateFailed);
  const row = Array.isArray(data) ? data[0] : data;
  if (!row?.invite_token) throw new TripInviteError(null, copy.inviteCreateFailed);
  return { id: row.invite_id, token: row.invite_token };
}

/**
 * 每個 tripId 的邀請連結建立狀態（模組層；TripInviteSheet 與 TripSharePanel 共用，元件卸載不遺失）：
 * 成功連結／失敗文案 key／進行中 promise。
 */
const tripInviteTokenCache = new Map<string, string>();
const tripInviteFailureCache = new Map<string, TripInviteCreateErrorKey>();
const tripInviteInflight = new Map<string, Promise<string>>();
const tripInviteListeners = new Set<() => void>();

function notifyTripInviteListeners() {
  for (const listener of tripInviteListeners) listener();
}

/**
 * 登入狀態改變（登入／登出／換帳號）時清除失敗與連結快取；網路恢復時只清除網路失敗。
 * 只清狀態並通知：開著的面板由既有 effect 依「無連結、未失敗、未建立中」自行建立一次。
 */
let tripInviteResetWatchersInstalled = false;
let tripInviteAuthUserId: string | null | undefined;
// 換帳號時遞增：舊帳號進行中的 create 完成後不得寫回快取
let tripInviteEpoch = 0;

function installTripInviteResetWatchers() {
  if (tripInviteResetWatchersInstalled) return;
  tripInviteResetWatchersInstalled = true;
  try {
    supabase.auth?.onAuthStateChange?.((_event, session) => {
      const nextUserId = session?.user?.id ?? null;
      const previous = tripInviteAuthUserId;
      tripInviteAuthUserId = nextUserId;
      if (previous === undefined || previous === nextUserId) return;
      tripInviteEpoch += 1;
      tripInviteTokenCache.clear();
      tripInviteFailureCache.clear();
      tripInviteInflight.clear();
      notifyTripInviteListeners();
    });
  } catch (error) {
    console.warn("[TRIP_COLLAB] invite auth watcher unavailable", error);
  }
  if (typeof window !== "undefined") {
    window.addEventListener("online", () => {
      let changed = false;
      for (const [tripId, key] of tripInviteFailureCache) {
        if (key === "inviteNetworkError") {
          tripInviteFailureCache.delete(tripId);
          changed = true;
        }
      }
      if (changed) notifyTripInviteListeners();
    });
  }
}

/** 訂閱邀請連結建立狀態變化（供 useSyncExternalStore） */
export function subscribeTripInviteState(listener: () => void): () => void {
  installTripInviteResetWatchers();
  tripInviteListeners.add(listener);
  return () => {
    tripInviteListeners.delete(listener);
  };
}

/**
 * 同一行程在本次執行期間只呼叫一次 create_trip_invite（伺服端本就回傳同一個開啟中的連結）；
 * 進行中的請求合併；失敗寫入模組層失敗狀態（直到 retryTripInviteToken 清除）。
 */
export async function getOrCreateTripInviteToken(tripId: string): Promise<string> {
  const cached = tripInviteTokenCache.get(tripId);
  if (cached) return cached;
  const inflight = tripInviteInflight.get(tripId);
  if (inflight) return inflight;
  const epoch = tripInviteEpoch;
  const request: Promise<string> = createTripInvite(tripId).then(
    (invite) => {
      if (epoch !== tripInviteEpoch) return invite.token;
      if (tripInviteInflight.get(tripId) === request) tripInviteInflight.delete(tripId);
      tripInviteFailureCache.delete(tripId);
      tripInviteTokenCache.set(tripId, invite.token);
      notifyTripInviteListeners();
      return invite.token;
    },
    (error: unknown) => {
      if (epoch !== tripInviteEpoch) throw error;
      if (tripInviteInflight.get(tripId) === request) tripInviteInflight.delete(tripId);
      tripInviteFailureCache.set(tripId, tripInviteCreateErrorKey(error));
      notifyTripInviteListeners();
      throw error;
    },
  );
  tripInviteInflight.set(tripId, request);
  tripInviteFailureCache.delete(tripId);
  notifyTripInviteListeners();
  return request;
}

/** 尚無連結、未失敗、未在建立中時才建立（已失敗不自動重試） */
export function ensureTripInviteToken(tripId: string): void {
  if (!tripId) return;
  if (
    tripInviteTokenCache.has(tripId) ||
    tripInviteFailureCache.has(tripId) ||
    tripInviteInflight.has(tripId)
  ) {
    return;
  }
  getOrCreateTripInviteToken(tripId).catch((e) => {
    console.warn("[TRIP_COLLAB] create_trip_invite failed", e);
  });
}

/** 使用者按「重試」：清除失敗狀態並重新建立 */
export function retryTripInviteToken(tripId: string): void {
  if (!tripId) return;
  tripInviteFailureCache.delete(tripId);
  notifyTripInviteListeners();
  ensureTripInviteToken(tripId);
}

export function peekTripInviteToken(tripId: string): string | null {
  return tripInviteTokenCache.get(tripId) ?? null;
}

export function peekTripInviteError(tripId: string): TripInviteCreateErrorKey | null {
  return tripInviteFailureCache.get(tripId) ?? null;
}

export function isTripInviteCreating(tripId: string): boolean {
  return tripInviteInflight.has(tripId);
}

/** 加入確認頁：anon 也可呼叫；只有 valid／full 會帶行程資料 */
export async function getTripInvitePreview(token: string): Promise<TripInvitePreview> {
  const { data, error } = await supabase.rpc("get_trip_invite_preview", { invite_token: token });
  if (error) throw toTripInviteError(error, getTripWorkspaceCopy().inviteLoadFailed);
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) {
    return {
      state: "invalid",
      tripTitle: null,
      dateStart: null,
      dateEnd: null,
      coverUrl: null,
      inviterDisplayName: null,
      memberCount: null,
    };
  }
  return {
    state: row.state,
    tripTitle: row.trip_title,
    dateStart: row.date_start,
    dateEnd: row.date_end,
    coverUrl: row.cover_url,
    inviterDisplayName: row.inviter_display_name,
    memberCount: row.member_count,
  };
}

export async function acceptTripInvite(token: string): Promise<string> {
  const userId = await getAuthenticatedUserId();
  console.info(
    `[TRIP_INVITE_ACCEPT_START] userPresent=${Boolean(userId)} tokenPresent=${Boolean(token)} tokenLength=${token.length}`,
  );

  const { data, error } = await supabase.rpc("accept_trip_invite", {
    invite_token: token,
  });

  if (error) {
    throw toTripInviteError(error, getTripWorkspaceCopy().inviteJoinFailed);
  }

  const tripId = String(data);
  console.info(`[TRIP_INVITE_ACCEPT_SUCCESS] tripId=${tripId} userId=${userId ?? "(none)"}`);

  if (userId) {
    const { data: memberRow } = await supabase
      .from("trip_members")
      .select("id, user_id, status")
      .eq("trip_id", tripId)
      .eq("user_id", userId)
      .maybeSingle();

    if (memberRow?.user_id) {
      console.info(
        `[TRIP_MEMBER_HAS_USER_ID] memberId=${memberRow.id} userId=${memberRow.user_id}`,
      );
    } else {
      console.info(`[TRIP_MEMBER_MISSING_USER_ID] memberId=(after_accept) tripId=${tripId}`);
    }
  }

  return tripId;
}

/**
 * 擁有者移除成員：伺服端 RPC 在同一交易刪除成員並撤銷該行程開啟中的分享連結。
 * 成功後清掉本地快取的舊 token，開著的分享面板會依既有 effect 重新取得新連結。
 */
export async function removeTripMember(tripId: string, memberUserId: string): Promise<void> {
  const { error } = await supabase.rpc("remove_trip_member", {
    p_trip_id: tripId,
    p_member_user_id: memberUserId,
  });

  if (error) throw new Error(error.message);
  if (tripInviteTokenCache.delete(tripId)) notifyTripInviteListeners();
}

export async function listOwnedTripIds(): Promise<Map<string, boolean>> {
  const userId = await getAuthenticatedUserId();
  const map = new Map<string, boolean>();
  if (!userId) return map;

  const { data, error } = await supabase
    .from("trip_members")
    .select("trip_id, is_owner")
    .eq("user_id", userId)
    .eq("status", "accepted");

  if (error) {
    if (isMissingTableError(error)) return map;
    console.warn("[TRIP_COLLAB] listOwnedTripIds", error.message);
    return map;
  }

  for (const row of data ?? []) {
    map.set(row.trip_id, Boolean(row.is_owner));
  }
  return map;
}

export async function copyInviteToClipboard(token: string): Promise<CopyTextResult> {
  const url = buildTripInviteUrl(token);
  return copyTextToClipboard(url);
}

/** 分享文案（不含連結） */
export function buildTripInviteShareText(tripTitle: string): string {
  return formatTripWorkspaceTemplate(getTripWorkspaceCopy().inviteShareText, {
    title: tripTitle.trim() || "Roamie",
  });
}

function shareMessageWithUrl(token: string, tripTitle: string): string {
  return `${buildTripInviteShareText(tripTitle)}\n${buildTripInviteUrl(token)}`;
}

/** LINE 官方 https 分享網址；由系統決定開 App 或網頁 */
export function buildLineShareUrl(token: string, tripTitle: string): string {
  return `https://line.me/R/share?text=${encodeURIComponent(shareMessageWithUrl(token, tripTitle))}`;
}

/** 訊息：iOS 用 `sms:&body=`，其他平台用 `sms:?body=` */
export function buildSmsShareUrl(token: string, tripTitle: string, isIOS: boolean): string {
  const body = encodeURIComponent(shareMessageWithUrl(token, tripTitle));
  return isIOS ? `sms:&body=${body}` : `sms:?body=${body}`;
}

export function buildMailtoShareUrl(token: string, tripTitle: string): string {
  const subject = formatTripWorkspaceTemplate(getTripWorkspaceCopy().inviteEmailSubject, {
    title: tripTitle.trim() || "Roamie",
  });
  return `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(
    shareMessageWithUrl(token, tripTitle),
  )}`;
}

type NativeSharePlugin = {
  share(options: {
    title?: string;
    text?: string;
    url?: string;
    dialogTitle?: string;
  }): Promise<unknown>;
};

/** @capacitor/share 的原生外掛（jsName "Share"）；未安裝／未 sync 時呼叫會 reject，改走後備 */
const NativeShare = registerPlugin<NativeSharePlugin>("Share");

function isShareCancel(error: unknown): boolean {
  if (error instanceof Error && error.name === "AbortError") return true;
  const msg = error instanceof Error ? error.message : String(error ?? "");
  return /cancel/i.test(msg);
}

export type ShareTripInviteResult = "shared" | "cancelled" | CopyTextResult;

/**
 * 「更多」：iOS 用 @capacitor/share 系統分享選單；Web 用 navigator.canShare/share；都不支援時改為複製。
 */
export async function shareTripInvite(
  token: string,
  tripTitle: string,
): Promise<ShareTripInviteResult> {
  const url = buildTripInviteUrl(token);
  const text = buildTripInviteShareText(tripTitle);
  const title = tripTitle.trim() || "Roamie";

  if (detectPlatform().isCapacitor) {
    try {
      await NativeShare.share({ title, text, url });
      return "shared";
    } catch (e) {
      if (isShareCancel(e)) return "cancelled";
      console.warn("[TRIP_INVITE_SHARE] native share unavailable", e);
    }
  } else if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
    const data = { title, text, url };
    const canShare = typeof navigator.canShare === "function" ? navigator.canShare(data) : true;
    if (canShare) {
      try {
        await navigator.share(data);
        return "shared";
      } catch (e) {
        if (isShareCancel(e)) return "cancelled";
      }
    }
  }

  return copyInviteToClipboard(token);
}
