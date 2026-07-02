import { supabase } from "@/integrations/supabase/client";
import { getAuthenticatedUserId } from "@/lib/auth-session";
import { APP_SCHEME } from "@/constants/app";
import { isMissingTableError } from "@/lib/supabase-errors";

export type TripMemberRow = {
  id: string;
  trip_id: string;
  user_id: string;
  is_owner: boolean;
  status: "pending" | "accepted";
  invited_by: string | null;
  created_at: string;
  profile?: { display_name: string | null; avatar_url: string | null } | null;
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

export async function listTripMembers(tripId: string): Promise<TripMemberRow[]> {
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

  const members = data ?? [];
  const userIds = [...new Set(members.map((m) => m.user_id))];
  if (!userIds.length) return members as TripMemberRow[];

  const { data: profiles } = await supabase
    .from("profiles")
    .select("id, display_name, avatar_url")
    .in("id", userIds);

  const profileMap = new Map((profiles ?? []).map((p) => [p.id, p]));

  return members.map((m) => ({
    ...m,
    profile: profileMap.get(m.user_id) ?? null,
  })) as TripMemberRow[];
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

  if (error) throw new Error(error.message);
  return data as TripInviteRow;
}

export async function acceptTripInvite(token: string): Promise<string> {
  const { data, error } = await supabase.rpc("accept_trip_invite", {
    invite_token: token,
  });

  if (error) {
    if (error.message.includes("invite_not_found")) throw new Error("邀請連結無效或已失效");
    if (error.message.includes("invite_expired")) throw new Error("邀請連結已過期");
    if (error.message.includes("not_authenticated")) throw new Error("請先登入");
    throw new Error(error.message);
  }

  return String(data);
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

export async function copyInviteToClipboard(token: string): Promise<void> {
  const url = buildTripInviteUrl(token);
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(url);
    return;
  }
  throw new Error("無法複製連結");
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

  await copyInviteToClipboard(token);
}
