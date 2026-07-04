import { supabase } from "@/integrations/supabase/client";
import { getAuthenticatedUserId } from "@/lib/auth-session";
import { APP_SCHEME } from "@/constants/app";
import { isMissingTableError, formatTripCollabError, TRIP_INVITE_CREATE_FAILED_MESSAGE } from "@/lib/supabase-errors";
import { copyTextToClipboard, type CopyTextResult, COPY_MANUAL_HINT } from "@/lib/copy-to-clipboard";
import type { TripMemberProfileFields } from "@/lib/trip/collab-member-display";

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
  email: string | null;
  full_name: string | null;
  username: string | null;
  profile_updated_at: string | null;
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
  expires_at: string;
  created_at: string;
};

export type TripAccess = {
  tripId: string;
  isOwner: boolean;
  isMember: boolean;
};

const INVITE_STASH_KEY = "roamie:pending-trip-invite-token";

export function buildTripInviteUrl(token: string): string {
  return `${APP_SCHEME}://trip-invite/${token}`;
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

function randomToken(): string {
  try {
    return crypto.randomUUID().replace(/-/g, "");
  } catch {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
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
    email: row.email,
    full_name: row.full_name,
    username: row.username,
    profile_updated_at: row.profile_updated_at,
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

  const { data: rpcRows, error: rpcError } = await supabase.rpc(
    "get_trip_member_public_profiles",
    { p_trip_id: tripId },
  );

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
  let profileMap = await fetchTripMemberProfilesViaRpc(tripId);

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

export async function createTripInvite(tripId: string): Promise<TripInviteRow> {
  const userId = await getAuthenticatedUserId();
  if (!userId) throw new Error("請先登入");

  const token = randomToken();
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

  const { data, error } = await supabase
    .from("trip_invites")
    .insert({
      trip_id: tripId,
      inviter_id: userId,
      token,
      status: "pending",
      expires_at: expiresAt,
    })
    .select("id, trip_id, inviter_id, token, status, expires_at, created_at")
    .single();

  if (error) {
    throw new Error(formatTripCollabError(error, TRIP_INVITE_CREATE_FAILED_MESSAGE));
  }
  return data as TripInviteRow;
}

export async function acceptTripInvite(token: string): Promise<string> {
  const userId = await getAuthenticatedUserId();
  console.info(`[TRIP_INVITE_ACCEPT_START] userId=${userId ?? "(none)"} token=${token.slice(0, 8)}…`);

  const { data, error } = await supabase.rpc("accept_trip_invite", {
    invite_token: token,
  });

  if (error) {
    if (error.message.includes("invite_not_found")) throw new Error("邀請連結無效或已失效");
    if (error.message.includes("invite_expired")) throw new Error("邀請連結已過期");
    if (error.message.includes("not_authenticated")) throw new Error("請先登入");
    throw new Error(formatTripCollabError(error, TRIP_INVITE_CREATE_FAILED_MESSAGE));
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

export async function removeTripMember(tripId: string, memberUserId: string): Promise<void> {
  const { error } = await supabase
    .from("trip_members")
    .delete()
    .eq("trip_id", tripId)
    .eq("user_id", memberUserId)
    .eq("is_owner", false);

  if (error) throw new Error(error.message);
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

export async function shareTripInvite(token: string, tripTitle: string): Promise<void> {
  const url = buildTripInviteUrl(token);
  const text = `邀請你一起編輯 Roamie 行程「${tripTitle}」\n${url}`;

  if (typeof navigator !== "undefined" && navigator.share) {
    try {
      await navigator.share({ title: "共同編輯行程", text, url });
      return;
    } catch (e) {
      if (e instanceof Error && e.name === "AbortError") return;
    }
  }

  const result = await copyInviteToClipboard(token);
  if (result === "manual") {
    throw new Error(COPY_MANUAL_HINT);
  }
}
