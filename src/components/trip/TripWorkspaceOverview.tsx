import { useId, useMemo, useState } from "react";
import { MapPin, UserPlus } from "lucide-react";
import { ProfileAvatar } from "@/components/profile/ProfileAvatar";
import { TripInviteSheet } from "@/components/trip/TripInviteSheet";
import { ExpensesOverviewCard } from "@/components/trip/expenses/ExpensesOverviewCard";
import { PackingOverviewCard } from "@/components/trip/packing/PackingOverviewCard";
import type { RoamieItineraryItem, RoamiePayloadV2, TripPlanSettings } from "@/lib/ai/types";
import type { Locale } from "@/lib/i18n/types";
import {
  formatTripWorkspaceCount,
  formatTripWorkspaceTemplate,
  type TripWorkspaceCopy,
} from "@/lib/i18n/trip-workspace-copy";
import type { StoredItinerary } from "@/lib/itinerary-storage";
import { itineraryDestinationDisplay } from "@/lib/native-qa-display";
import { TRIP_UNASSIGNED_DATE } from "@/lib/saved-trip/apply-trip-date-range";
import { normalizeStoredTrip } from "@/lib/saved-trip/normalize";
import {
  collaboratorInitial,
  resolveCollaboratorAvatarUrl,
  resolveCollaboratorDisplayName,
} from "@/lib/trip/collab-member-display";
import { coalesceItineraryItems } from "@/lib/trip/itinerary-guards";
import type { TripMemberRow } from "@/lib/trip/trip-collab";
import { buildTripDayGroups } from "@/lib/trip/trip-day-groups";
import { dayColor, TRIP_DAY_COLORS } from "@/lib/trip/trip-map-markers";
import { computeTripOverviewStats, projectPointsToBox } from "@/lib/trip/trip-overview-stats";

/** 天數色票（6 色循環；定義於 trip-map-markers，與地圖分頁共用） */
export { TRIP_DAY_COLORS };

/** dayIndex：行程頁天數順序（0-based，空白天也佔色位） */
export function tripDayColor(dayIndex: number): string {
  return dayColor(dayIndex);
}

/**
 * 行程頁天數列的日期 key（依顯示順序，不含「未安排」）。
 * 直接使用行程分頁的 buildTripDayGroups：有效日期區間一律用區間天數，否則用天數列天數。
 */
function itineraryDayDateKeys(items: RoamieItineraryItem[], settings: TripPlanSettings): string[] {
  return buildTripDayGroups(items, settings)
    .filter((d) => !d.isUnassigned)
    .map((d) => d.dateKey);
}

const DESTINATION_UNSET = "尚未設定";
/** 較高的預覽區＋較大 padding：離群點拉開範圍時，其餘點仍有垂直空間、不貼邊 */
const PREVIEW_BOX = { width: 320, height: 196, padding: 24 };
/** 純裝飾的地圖感底紋（本地 SVG，不載入任何外部圖片／圖磚） */
const PREVIEW_GRID = 20;
const PREVIEW_CONTOURS = [
  "M -10 46 C 50 22, 110 70, 180 44 S 290 18, 330 40",
  "M -10 150 C 60 128, 120 176, 200 150 S 290 132, 330 158",
  "M 40 210 C 70 170, 140 190, 160 150 S 230 110, 250 70 S 290 20, 300 -10",
];
const MAX_AVATARS = 5;

type Props = {
  stored: StoredItinerary;
  locale: Locale;
  copy: TripWorkspaceCopy;
  /** null＝載入中 */
  members: TripMemberRow[] | null;
  onOpenMap: () => void;
  onInvite: () => void;
  /** true＝擁有者：顯示「邀請成員」並開啟邀請成員面板；false／null（未知）＝不顯示 */
  isOwner?: boolean | null;
  tripTitle?: string;
};

type DayTrack = { color: string; dayIndex: number; points: Array<{ x: number; y: number }> };

function itemOrder(item: RoamieItineraryItem, fallback: number): number {
  return item.sortIndex ?? item.order ?? fallback;
}

function hasCoords(
  item: RoamieItineraryItem,
): item is RoamieItineraryItem & { lat: number; lng: number } {
  return (
    typeof item.lat === "number" &&
    Number.isFinite(item.lat) &&
    typeof item.lng === "number" &&
    Number.isFinite(item.lng)
  );
}

function memberName(member: TripMemberRow): string | null {
  return resolveCollaboratorDisplayName(member.profile);
}

export function TripWorkspaceOverview({
  stored,
  locale,
  copy,
  members,
  onOpenMap,
  isOwner = false,
  tripTitle = "",
}: Props) {
  const payload = stored.payload as RoamiePayloadV2;
  const [inviteOpen, setInviteOpen] = useState(false);
  // useId 含冒號，SVG url(#id) 需轉成安全字元
  const gridId = `trip-preview-grid-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;

  const items = useMemo(() => coalesceItineraryItems(payload.itinerary), [payload.itinerary]);
  const stats = useMemo(
    () => computeTripOverviewStats(items, { unassignedDateKey: TRIP_UNASSIGNED_DATE }),
    [items],
  );

  const dayDateKeys = useMemo(
    () => itineraryDayDateKeys(items, payload.tripSettings ?? ({} as TripPlanSettings)),
    [items, payload.tripSettings],
  );
  const dayCount = dayDateKeys.length;

  const destination = useMemo(() => {
    const view = normalizeStoredTrip(stored);
    const raw =
      view.destination && view.destination !== DESTINATION_UNSET
        ? view.destination
        : payload.destinationLocation?.formattedName ||
          payload.destinationLocation?.displayLabel ||
          payload.destination ||
          "";
    if (!raw.trim() || raw === DESTINATION_UNSET) return copy.destinationUnset;
    return itineraryDestinationDisplay(raw, locale, payload.destinationLocation) || raw;
  }, [stored, payload, locale, copy.destinationUnset]);

  const tracks = useMemo<DayTrack[]>(() => {
    const byDate = new Map<string, Array<{ item: RoamieItineraryItem; i: number }>>();
    items.forEach((item, i) => {
      const key = item.date?.trim() ?? "";
      if (!key || key === TRIP_UNASSIGNED_DATE || !hasCoords(item)) return;
      const list = byDate.get(key) ?? [];
      list.push({ item, i });
      byDate.set(key, list);
    });
    // 依行程頁天數順序取色（空白天也佔色位）
    const perDay = dayDateKeys.map((date, dayIndex) => ({
      dayIndex,
      color: tripDayColor(dayIndex),
      coords: (byDate.get(date) ?? [])
        .sort((a, b) => itemOrder(a.item, a.i) - itemOrder(b.item, b.i) || a.i - b.i)
        .map(({ item }) => ({ lat: item.lat as number, lng: item.lng as number })),
    }));
    const flat = perDay.flatMap((d) => d.coords);
    const projected = projectPointsToBox(flat, PREVIEW_BOX);
    let cursor = 0;
    return perDay
      .map((d) => {
        const points = projected.slice(cursor, cursor + d.coords.length);
        cursor += d.coords.length;
        return { color: d.color, dayIndex: d.dayIndex, points };
      })
      .filter((d) => d.points.length > 0);
  }, [items, dayDateKeys]);

  const acceptedMembers = useMemo(
    () => (members ?? []).filter((m) => m.status === "accepted"),
    [members],
  );
  const shownMembers = acceptedMembers.slice(0, MAX_AVATARS);
  const extraMembers = acceptedMembers.length - shownMembers.length;

  return (
    <div className="space-y-4 px-5 py-5 pb-8">
      <dl className="grid grid-cols-3 divide-x divide-border rounded-2xl border border-border bg-card py-3">
        <div className="min-w-0 px-3">
          <dt className="text-xs text-muted-foreground">{copy.destinationLabel}</dt>
          <dd className="mt-1 truncate text-sm font-medium text-foreground">{destination}</dd>
        </div>
        <div className="min-w-0 px-3">
          <dt className="text-xs text-muted-foreground">{copy.daysLabel}</dt>
          <dd className="mt-1 truncate text-sm font-medium text-foreground">
            {formatTripWorkspaceCount(copy.daysValue, dayCount, copy.daysValueOne)}
          </dd>
        </div>
        <div className="min-w-0 px-3">
          <dt className="text-xs text-muted-foreground">{copy.scheduledPlacesLabel}</dt>
          <dd className="mt-1 truncate text-sm font-medium text-foreground">
            {formatTripWorkspaceCount(copy.scheduledPlacesValue, stats.scheduledPlaceCount)}
          </dd>
        </div>
      </dl>

      <button
        type="button"
        onClick={onOpenMap}
        aria-label={copy.mapPreviewOpen}
        className="block w-full overflow-hidden rounded-2xl border border-border bg-card text-left transition active:scale-[0.99]"
      >
        <div className="flex items-center justify-between gap-2 px-4 py-3">
          <span className="flex items-center gap-1.5 text-sm font-medium text-foreground">
            <MapPin className="h-4 w-4 text-muted-foreground" />
            {copy.mapPreviewTitle}
          </span>
          {tracks.length > 0 ? (
            <span className="shrink-0 text-xs font-medium text-muted-foreground">
              {copy.mapPreviewCta}
            </span>
          ) : null}
        </div>
        {tracks.length > 0 ? (
          <>
            <svg
              viewBox={`0 0 ${PREVIEW_BOX.width} ${PREVIEW_BOX.height}`}
              className="block h-auto w-full border-y border-border"
              aria-hidden
            >
              <defs>
                <pattern
                  id={gridId}
                  width={PREVIEW_GRID}
                  height={PREVIEW_GRID}
                  patternUnits="userSpaceOnUse"
                >
                  <path
                    d={`M ${PREVIEW_GRID} 0 L 0 0 0 ${PREVIEW_GRID}`}
                    fill="none"
                    stroke="var(--border)"
                    strokeWidth={1}
                  />
                </pattern>
              </defs>
              <rect width={PREVIEW_BOX.width} height={PREVIEW_BOX.height} fill="var(--secondary)" />
              <rect
                width={PREVIEW_BOX.width}
                height={PREVIEW_BOX.height}
                fill={`url(#${gridId})`}
              />
              <g fill="none" stroke="var(--border)" strokeWidth={1.25} opacity={0.9}>
                {PREVIEW_CONTOURS.map((d) => (
                  <path key={d} d={d} />
                ))}
              </g>
              {tracks.map((track) =>
                track.points.length > 1 ? (
                  <polyline
                    key={`line-${track.dayIndex}`}
                    points={track.points
                      .map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`)
                      .join(" ")}
                    fill="none"
                    stroke={track.color}
                    strokeWidth={2}
                    strokeDasharray="4 4"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    opacity={0.9}
                  />
                ) : null,
              )}
              {tracks.map((track) =>
                track.points.map((p, pi) => (
                  <g key={`pt-${track.dayIndex}-${pi}`}>
                    <circle cx={p.x} cy={p.y + 1} r={6.5} fill="#000" opacity={0.18} />
                    <circle
                      cx={p.x}
                      cy={p.y}
                      r={5.5}
                      fill={track.color}
                      stroke="#fff"
                      strokeWidth={2}
                    />
                  </g>
                )),
              )}
            </svg>
            <ul className="no-scrollbar flex gap-3 overflow-x-auto whitespace-nowrap px-4 py-2.5">
              {tracks.map((track) => (
                <li
                  key={`legend-${track.dayIndex}`}
                  className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground"
                >
                  <span
                    className="h-2.5 w-2.5 rounded-full ring-2 ring-card"
                    style={{ backgroundColor: track.color }}
                  />
                  {formatTripWorkspaceTemplate(copy.mapDayChip, { n: track.dayIndex + 1 })}
                </li>
              ))}
            </ul>
          </>
        ) : (
          <p className="px-4 pb-4 text-sm text-muted-foreground">{copy.mapPreviewEmpty}</p>
        )}
      </button>

      <section className="rounded-2xl border border-border bg-card px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h3 className="text-sm font-medium text-foreground">{copy.companionsTitle}</h3>
            {members == null ? (
              <p className="mt-1 text-xs text-muted-foreground">{copy.companionsLoading}</p>
            ) : acceptedMembers.length > 0 ? (
              <p className="mt-1 text-xs text-muted-foreground">
                {formatTripWorkspaceCount(
                  copy.companionsCount,
                  acceptedMembers.length,
                  copy.companionsCountOne,
                )}
              </p>
            ) : null}
          </div>
          {/* 只有確認為擁有者才顯示邀請成員（權限未查回／非擁有者不顯示，避免呼叫 create 被拒） */}
          {isOwner === true ? (
            <button
              type="button"
              onClick={() => setInviteOpen(true)}
              className="flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full bg-secondary px-3 py-2 text-xs font-medium text-foreground"
            >
              <UserPlus className="h-3.5 w-3.5" />
              {copy.inviteMembers}
            </button>
          ) : null}
        </div>
        {members != null && acceptedMembers.length === 0 ? (
          <p className="mt-2 text-xs text-muted-foreground">{copy.companionsEmpty}</p>
        ) : null}
        {shownMembers.length > 0 ? (
          <div className="mt-3 flex items-center">
            {shownMembers.map((member, i) => {
              const name = memberName(member);
              const avatarUrl = resolveCollaboratorAvatarUrl(member.profile);
              return (
                <div
                  key={member.id}
                  className={
                    i === 0
                      ? "rounded-full ring-2 ring-card"
                      : "-ml-2 rounded-full ring-2 ring-card"
                  }
                >
                  <ProfileAvatar
                    avatarUrl={avatarUrl}
                    displayName={name}
                    avatarUpdatedAt={member.profile?.profile_updated_at}
                    initial={avatarUrl ? undefined : collaboratorInitial(member.profile, name)}
                    showDefault={member.profile == null}
                    className="pointer-events-none h-8 w-8 shrink-0 rounded-full"
                    imgClassName="rounded-full"
                  />
                </div>
              );
            })}
            {extraMembers > 0 ? (
              <span className="-ml-2 flex h-8 min-w-8 items-center justify-center rounded-full bg-secondary px-1.5 text-xs font-medium text-muted-foreground ring-2 ring-card">
                {formatTripWorkspaceCount(copy.companionsMore, extraMembers)}
              </span>
            ) : null}
          </div>
        ) : null}
      </section>
      <ExpensesOverviewCard tripId={stored.id} locale={locale} />
      <PackingOverviewCard tripId={stored.id} locale={locale} />
      {isOwner === true ? (
        <TripInviteSheet
          open={inviteOpen}
          onOpenChange={setInviteOpen}
          tripId={stored.id}
          tripTitle={tripTitle}
        />
      ) : null}
    </div>
  );
}

export function TripWorkspaceMapEmpty({ copy }: { copy: TripWorkspaceCopy }) {
  return (
    <div className="flex flex-col items-center px-8 py-16 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-secondary text-muted-foreground">
        <MapPin className="h-5 w-5" />
      </div>
      <p className="mt-4 text-sm font-medium text-foreground">{copy.mapEmptyTitle}</p>
      <p className="mt-1 text-sm text-muted-foreground">{copy.mapEmptyBody}</p>
    </div>
  );
}
