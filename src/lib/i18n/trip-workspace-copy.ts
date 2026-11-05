import { effectiveAppLocale } from "@/lib/i18n/effective-app-locale";
import type { Locale } from "@/lib/i18n/types";

type TripWorkspaceCopyKey =
  | "tabTrip"
  | "tabOverview"
  | "tabMap"
  | "tablistLabel"
  | "inviteMembers"
  | "destinationLabel"
  | "daysLabel"
  | "daysValue"
  | "daysValueOne"
  | "scheduledPlacesLabel"
  | "scheduledPlacesValue"
  | "destinationUnset"
  | "mapPreviewTitle"
  | "mapPreviewOpen"
  | "mapPreviewEmpty"
  | "mapPreviewCta"
  | "companionsTitle"
  | "companionsCount"
  | "companionsCountOne"
  | "companionsMore"
  | "companionsEmpty"
  | "companionsLoading"
  | "mapEmptyTitle"
  | "mapEmptyBody"
  | "mapModeListLabel"
  | "mapModeAll"
  | "mapDayChip"
  | "mapStopLabel"
  | "mapPrevStop"
  | "mapNextStop"
  | "mapViewDetails"
  | "mapCloseCard"
  | "mapUnlocated"
  | "mapUnlocatedOne"
  | "mapUnlocatedHint"
  | "mapDayEmpty"
  | "inviteLinkTitle"
  | "inviteLinkLoading"
  | "inviteOptionCopy"
  | "inviteOptionLine"
  | "inviteOptionMessages"
  | "inviteOptionEmail"
  | "inviteOptionMore"
  | "inviteCopied"
  | "inviteCopyManual"
  | "inviteShareText"
  | "inviteEmailSubject"
  | "inviteJoin"
  | "inviteNotNow"
  | "inviteLoginToJoin"
  | "inviteBackHome"
  | "inviteOpenInApp"
  | "inviteOpenInAppHint"
  | "inviteDownloadApp"
  | "inviteRetry"
  | "inviteMemberCount"
  | "inviteMemberCountOne"
  | "inviteStateRevoked"
  | "inviteStateExpired"
  | "inviteStateFull"
  | "inviteStateInvalid"
  | "inviteLoadFailed"
  | "inviteJoinFailed"
  | "inviteCreateFailed"
  | "inviteRateLimited"
  | "inviteNotOwner"
  | "inviteNotAuthenticated"
  | "inviteNetworkError"
  | "removedFromTrip";

const COPY = {
  "zh-TW": {
    tabTrip: "行程",
    tabOverview: "總覽",
    tabMap: "地圖",
    tablistLabel: "行程分頁",
    inviteMembers: "邀請成員",
    destinationLabel: "目的地",
    daysLabel: "天數",
    daysValue: "{count} 天",
    daysValueOne: "{count} 天",
    scheduledPlacesLabel: "已排景點",
    scheduledPlacesValue: "{count} 個",
    destinationUnset: "尚未設定",
    mapPreviewTitle: "地圖預覽",
    mapPreviewOpen: "開啟地圖分頁",
    mapPreviewEmpty: "加入有位置的景點後，這裡會顯示路線預覽。",
    mapPreviewCta: "查看地圖 →",
    companionsTitle: "旅伴",
    companionsCount: "{count} 人",
    companionsCountOne: "{count} 人",
    companionsMore: "+{count}",
    companionsEmpty: "還沒有旅伴，邀請朋友一起規劃吧。",
    companionsLoading: "載入旅伴中…",
    mapEmptyTitle: "還沒有可以顯示在地圖上的地點",
    mapEmptyBody: "行程中的景點有位置後，就會依天數顯示在地圖上。",
    mapModeListLabel: "地圖顯示範圍",
    mapModeAll: "全部",
    mapDayChip: "第 {n} 天",
    mapStopLabel: "第 {n} 天 · 第 {m} 站",
    mapPrevStop: "上一站",
    mapNextStop: "下一站",
    mapViewDetails: "查看詳情",
    mapCloseCard: "關閉地點卡",
    mapUnlocated: "{count} 個地點尚未定位",
    mapUnlocatedOne: "{count} 個地點尚未定位",
    mapUnlocatedHint: "點選地點可回到行程分頁的那一天。",
    mapDayEmpty: "這一天還沒有可以顯示在地圖上的地點。",
    inviteLinkTitle: "邀請連結",
    inviteLinkLoading: "建立邀請連結中…",
    inviteOptionCopy: "複製連結",
    inviteOptionLine: "LINE",
    inviteOptionMessages: "訊息",
    inviteOptionEmail: "Email",
    inviteOptionMore: "更多",
    inviteCopied: "已複製邀請連結",
    inviteCopyManual: "無法自動複製，請長按連結手動複製",
    inviteShareText: "邀請你一起規劃 Roamie 行程「{title}」，點連結加入：",
    inviteEmailSubject: "邀請你加入 Roamie 行程「{title}」",
    inviteJoin: "加入行程",
    inviteNotNow: "暫時不要",
    inviteLoginToJoin: "登入後加入",
    inviteBackHome: "回到首頁",
    inviteOpenInApp: "在 Roamie App 開啟",
    inviteOpenInAppHint: "已安裝 App 才能開啟",
    inviteDownloadApp: "還沒安裝？下載 Roamie App",
    inviteRetry: "重試",
    inviteMemberCount: "{count} 位成員",
    inviteMemberCountOne: "{count} 位成員",
    inviteStateRevoked: "這個邀請連結已停用",
    inviteStateExpired: "這個邀請連結已過期",
    inviteStateFull: "這個行程的成員已滿",
    inviteStateInvalid: "這個邀請連結無效",
    inviteLoadFailed: "無法載入邀請，請稍後再試",
    inviteJoinFailed: "無法加入行程，請稍後再試",
    inviteCreateFailed: "邀請連結建立失敗，請稍後再試",
    inviteRateLimited: "建立邀請連結太頻繁，請稍後再試",
    inviteNotOwner: "只有行程擁有者可以邀請成員",
    inviteNotAuthenticated: "請先登入",
    inviteNetworkError: "網路連線有問題，無法建立邀請連結",
    removedFromTrip: "你已不在此行程中",
  },
  en: {
    tabTrip: "Itinerary",
    tabOverview: "Overview",
    tabMap: "Map",
    tablistLabel: "Trip sections",
    inviteMembers: "Invite members",
    destinationLabel: "Destination",
    daysLabel: "Days",
    daysValue: "{count} days",
    daysValueOne: "{count} day",
    scheduledPlacesLabel: "Planned stops",
    scheduledPlacesValue: "{count}",
    destinationUnset: "Not set",
    mapPreviewTitle: "Map preview",
    mapPreviewOpen: "Open the Map tab",
    mapPreviewEmpty: "Add places with a location to see a route preview here.",
    mapPreviewCta: "View map →",
    companionsTitle: "Travel companions",
    companionsCount: "{count} people",
    companionsCountOne: "{count} person",
    companionsMore: "+{count}",
    companionsEmpty: "No companions yet. Invite friends to plan together.",
    companionsLoading: "Loading companions…",
    mapEmptyTitle: "No places to show on the map yet",
    mapEmptyBody: "Once your stops have locations, they’ll appear here by day.",
    mapModeListLabel: "Map view range",
    mapModeAll: "All",
    mapDayChip: "Day {n}",
    mapStopLabel: "Day {n} · Stop {m}",
    mapPrevStop: "Previous",
    mapNextStop: "Next",
    mapViewDetails: "View details",
    mapCloseCard: "Close place card",
    mapUnlocated: "{count} places not located yet",
    mapUnlocatedOne: "{count} place not located yet",
    mapUnlocatedHint: "Tap a place to go back to that day in the itinerary.",
    mapDayEmpty: "No places on this day can be shown on the map yet.",
    inviteLinkTitle: "Invite link",
    inviteLinkLoading: "Creating invite link…",
    inviteOptionCopy: "Copy link",
    inviteOptionLine: "LINE",
    inviteOptionMessages: "Messages",
    inviteOptionEmail: "Email",
    inviteOptionMore: "More",
    inviteCopied: "Invite link copied",
    inviteCopyManual: "Couldn’t copy automatically. Press and hold the link to copy it.",
    inviteShareText: "Join me in planning “{title}” on Roamie. Tap the link to join:",
    inviteEmailSubject: "Join my Roamie trip “{title}”",
    inviteJoin: "Join trip",
    inviteNotNow: "Not now",
    inviteLoginToJoin: "Log in to join",
    inviteBackHome: "Back to home",
    inviteOpenInApp: "Open in Roamie app",
    inviteOpenInAppHint: "Requires the Roamie app",
    inviteDownloadApp: "Don't have it yet? Get Roamie on the App Store",
    inviteRetry: "Retry",
    inviteMemberCount: "{count} members",
    inviteMemberCountOne: "{count} member",
    inviteStateRevoked: "This invite link has been turned off",
    inviteStateExpired: "This invite link has expired",
    inviteStateFull: "This trip is full",
    inviteStateInvalid: "This invite link isn’t valid",
    inviteLoadFailed: "Couldn’t load the invite. Please try again later.",
    inviteJoinFailed: "Couldn’t join the trip. Please try again later.",
    inviteCreateFailed: "Couldn’t create the invite link. Please try again later.",
    inviteRateLimited: "Too many invite links created. Please try again later.",
    inviteNotOwner: "Only the trip owner can invite members",
    inviteNotAuthenticated: "Please log in first",
    inviteNetworkError: "Network problem. Couldn't create the invite link.",
    removedFromTrip: "You’re no longer in this trip",
  },
  ja: {
    tabTrip: "旅程",
    tabOverview: "概要",
    tabMap: "地図",
    tablistLabel: "旅程のセクション",
    inviteMembers: "メンバーを招待",
    destinationLabel: "目的地",
    daysLabel: "日数",
    daysValue: "{count}日間",
    daysValueOne: "{count}日間",
    scheduledPlacesLabel: "予定済みスポット",
    scheduledPlacesValue: "{count}件",
    destinationUnset: "未設定",
    mapPreviewTitle: "地図プレビュー",
    mapPreviewOpen: "地図タブを開く",
    mapPreviewEmpty: "位置情報のあるスポットを追加すると、ここにルートのプレビューが表示されます。",
    mapPreviewCta: "地図を見る →",
    companionsTitle: "旅の仲間",
    companionsCount: "{count}人",
    companionsCountOne: "{count}人",
    companionsMore: "+{count}",
    companionsEmpty: "まだ仲間がいません。友だちを招待して一緒に計画しましょう。",
    companionsLoading: "仲間を読み込み中…",
    mapEmptyTitle: "地図に表示できるスポットはまだありません",
    mapEmptyBody: "スポットに位置情報が入ると、日ごとに地図に表示されます。",
    mapModeListLabel: "地図の表示範囲",
    mapModeAll: "すべて",
    mapDayChip: "{n}日目",
    mapStopLabel: "{n}日目 · {m}番目",
    mapPrevStop: "前へ",
    mapNextStop: "次へ",
    mapViewDetails: "詳細を見る",
    mapCloseCard: "スポットカードを閉じる",
    mapUnlocated: "位置未設定のスポット {count}件",
    mapUnlocatedOne: "位置未設定のスポット {count}件",
    mapUnlocatedHint: "スポットをタップすると、旅程タブのその日に戻ります。",
    mapDayEmpty: "この日は地図に表示できるスポットがまだありません。",
    inviteLinkTitle: "招待リンク",
    inviteLinkLoading: "招待リンクを作成中…",
    inviteOptionCopy: "リンクをコピー",
    inviteOptionLine: "LINE",
    inviteOptionMessages: "メッセージ",
    inviteOptionEmail: "メール",
    inviteOptionMore: "その他",
    inviteCopied: "招待リンクをコピーしました",
    inviteCopyManual: "自動でコピーできませんでした。リンクを長押ししてコピーしてください",
    inviteShareText: "Roamie の旅程「{title}」を一緒に計画しませんか？リンクから参加できます：",
    inviteEmailSubject: "Roamie の旅程「{title}」への招待",
    inviteJoin: "旅程に参加",
    inviteNotNow: "今はしない",
    inviteLoginToJoin: "ログインして参加",
    inviteBackHome: "ホームに戻る",
    inviteOpenInApp: "Roamie アプリで開く",
    inviteOpenInAppHint: "アプリがインストールされている場合のみ開けます",
    inviteDownloadApp: "まだの方は App Store で Roamie を入手",
    inviteRetry: "再試行",
    inviteMemberCount: "メンバー {count}人",
    inviteMemberCountOne: "メンバー {count}人",
    inviteStateRevoked: "この招待リンクは無効になりました",
    inviteStateExpired: "この招待リンクは期限切れです",
    inviteStateFull: "この旅程のメンバーは定員に達しています",
    inviteStateInvalid: "この招待リンクは無効です",
    inviteLoadFailed: "招待を読み込めませんでした。しばらくしてからお試しください",
    inviteJoinFailed: "旅程に参加できませんでした。しばらくしてからお試しください",
    inviteCreateFailed: "招待リンクを作成できませんでした。しばらくしてからお試しください",
    inviteRateLimited: "招待リンクの作成回数が多すぎます。しばらくしてからお試しください",
    inviteNotOwner: "メンバーを招待できるのは旅程のオーナーだけです",
    inviteNotAuthenticated: "先にログインしてください",
    inviteNetworkError: "ネットワークに問題があり、招待リンクを作成できません",
    removedFromTrip: "この旅程のメンバーではなくなりました",
  },
  ko: {
    tabTrip: "일정",
    tabOverview: "개요",
    tabMap: "지도",
    tablistLabel: "여행 섹션",
    inviteMembers: "멤버 초대",
    destinationLabel: "목적지",
    daysLabel: "일수",
    daysValue: "{count}일",
    daysValueOne: "{count}일",
    scheduledPlacesLabel: "예정된 장소",
    scheduledPlacesValue: "{count}곳",
    destinationUnset: "미설정",
    mapPreviewTitle: "지도 미리보기",
    mapPreviewOpen: "지도 탭 열기",
    mapPreviewEmpty: "위치가 있는 장소를 추가하면 여기에서 경로 미리보기를 볼 수 있어요.",
    mapPreviewCta: "지도 보기 →",
    companionsTitle: "동행",
    companionsCount: "{count}명",
    companionsCountOne: "{count}명",
    companionsMore: "+{count}",
    companionsEmpty: "아직 동행이 없어요. 친구를 초대해 함께 계획해 보세요.",
    companionsLoading: "동행을 불러오는 중…",
    mapEmptyTitle: "아직 지도에 표시할 장소가 없어요",
    mapEmptyBody: "장소에 위치 정보가 생기면 날짜별로 지도에 표시돼요.",
    mapModeListLabel: "지도 표시 범위",
    mapModeAll: "전체",
    mapDayChip: "{n}일차",
    mapStopLabel: "{n}일차 · {m}번째",
    mapPrevStop: "이전",
    mapNextStop: "다음",
    mapViewDetails: "자세히 보기",
    mapCloseCard: "장소 카드 닫기",
    mapUnlocated: "위치가 없는 장소 {count}곳",
    mapUnlocatedOne: "위치가 없는 장소 {count}곳",
    mapUnlocatedHint: "장소를 누르면 일정 탭의 해당 날짜로 돌아가요.",
    mapDayEmpty: "이날은 아직 지도에 표시할 장소가 없어요.",
    inviteLinkTitle: "초대 링크",
    inviteLinkLoading: "초대 링크를 만드는 중…",
    inviteOptionCopy: "링크 복사",
    inviteOptionLine: "LINE",
    inviteOptionMessages: "메시지",
    inviteOptionEmail: "이메일",
    inviteOptionMore: "더보기",
    inviteCopied: "초대 링크를 복사했어요",
    inviteCopyManual: "자동으로 복사하지 못했어요. 링크를 길게 눌러 복사해 주세요",
    inviteShareText: "Roamie 일정 “{title}”을(를) 함께 계획해요. 링크를 눌러 참여하세요:",
    inviteEmailSubject: "Roamie 일정 “{title}”에 초대합니다",
    inviteJoin: "일정 참여",
    inviteNotNow: "나중에",
    inviteLoginToJoin: "로그인 후 참여",
    inviteBackHome: "홈으로",
    inviteOpenInApp: "Roamie 앱에서 열기",
    inviteOpenInAppHint: "앱이 설치되어 있어야 열 수 있어요",
    inviteDownloadApp: "아직 없으신가요? App Store에서 Roamie 받기",
    inviteRetry: "다시 시도",
    inviteMemberCount: "멤버 {count}명",
    inviteMemberCountOne: "멤버 {count}명",
    inviteStateRevoked: "이 초대 링크는 사용이 중지되었어요",
    inviteStateExpired: "이 초대 링크는 만료되었어요",
    inviteStateFull: "이 일정의 멤버가 가득 찼어요",
    inviteStateInvalid: "유효하지 않은 초대 링크예요",
    inviteLoadFailed: "초대를 불러오지 못했어요. 잠시 후 다시 시도해 주세요",
    inviteJoinFailed: "일정에 참여하지 못했어요. 잠시 후 다시 시도해 주세요",
    inviteCreateFailed: "초대 링크를 만들지 못했어요. 잠시 후 다시 시도해 주세요",
    inviteRateLimited: "초대 링크를 너무 자주 만들었어요. 잠시 후 다시 시도해 주세요",
    inviteNotOwner: "일정 소유자만 멤버를 초대할 수 있어요",
    inviteNotAuthenticated: "먼저 로그인해 주세요",
    inviteNetworkError: "네트워크 문제로 초대 링크를 만들 수 없어요",
    removedFromTrip: "이 일정에서 더 이상 멤버가 아니에요",
  },
} satisfies Record<Locale, Record<TripWorkspaceCopyKey, string>>;

export type TripWorkspaceCopy = Record<TripWorkspaceCopyKey, string>;

export function getTripWorkspaceCopy(locale: Locale = effectiveAppLocale()): TripWorkspaceCopy {
  return COPY[locale];
}

/** singularTemplate：count 為 1 時改用（例如英文 "1 day"）；未提供時一律用 template。 */
export function formatTripWorkspaceCount(
  template: string,
  count: number,
  singularTemplate?: string,
): string {
  const chosen = count === 1 && singularTemplate ? singularTemplate : template;
  return chosen.replaceAll("{count}", String(count));
}

/** 以 {key} 佔位符代入值（例如 "第 {n} 天 · 第 {m} 站"）。 */
export function formatTripWorkspaceTemplate(
  template: string,
  values: Record<string, string | number>,
): string {
  let out = template;
  for (const [key, value] of Object.entries(values)) {
    out = out.replaceAll(`{${key}}`, String(value));
  }
  return out;
}

// ── 共同記帳（Trip Workspace V1 第 4 階段） ─────────────────────────────

type TripExpensesCopyKey =
  | "title"
  | "back"
  | "overviewEmpty"
  | "overviewMore"
  | "overviewCount"
  | "overviewCountOne"
  | "overviewLoading"
  | "overviewLoadFailed"
  | "overviewCta"
  | "tabsLabel"
  | "tabExpenses"
  | "tabSettle"
  | "totalLabel"
  | "myNetLabel"
  | "netOwed"
  | "netOwe"
  | "netSettled"
  | "emptyTitle"
  | "emptyBody"
  | "add"
  | "loading"
  | "loadFailed"
  | "retry"
  | "refreshing"
  | "pullToRefresh"
  | "releaseToRefresh"
  | "paidBy"
  | "settlementRow"
  | "settlementTag"
  | "you"
  | "deletedUser"
  | "deleted"
  | "undo"
  | "restored"
  | "sheetAddTitle"
  | "sheetEditTitle"
  | "settlementSheetTitle"
  | "amountLabel"
  | "currencyLabel"
  | "currencyChange"
  | "currencySearch"
  | "currencyUsed"
  | "currencyCommon"
  | "currencyAll"
  | "currencyNone"
  | "titleLabel"
  | "titlePlaceholder"
  | "dateLabel"
  | "payerLabel"
  | "splitLabel"
  | "splitEqual"
  | "splitExact"
  | "splitPercent"
  | "participantsLabel"
  | "exactRemaining"
  | "exactOver"
  | "exactMatched"
  | "percentRemaining"
  | "percentOver"
  | "percentMatched"
  | "noteLabel"
  | "notePlaceholder"
  | "save"
  | "saving"
  | "delete"
  | "deleting"
  | "close"
  | "conflictReloaded"
  | "validationAmount"
  | "validationAmountDecimals"
  | "validationAmountTooLarge"
  | "validationTitle"
  | "validationDate"
  | "validationPayer"
  | "validationParticipants"
  | "validationExact"
  | "validationPercent"
  | "validationShareInvalid"
  | "membersLoading"
  | "membersLoadFailed"
  | "memberPlaceholder"
  | "settleIntro"
  | "settleEmpty"
  | "settleMember"
  | "settlePaid"
  | "settleOwed"
  | "settleNet"
  | "settleNetNote"
  | "settleTransfers"
  | "settleAllSettled"
  | "settleMarkPaid"
  | "settleMarking"
  | "settleMarked"
  | "settlementTitle"
  | "settlePrecision"
  | "settleFormerMember"
  | "errorNotAuthenticated"
  | "errorNotMember"
  | "errorMalformed"
  | "errorTitle"
  | "errorAmount"
  | "errorCurrency"
  | "errorDate"
  | "errorNote"
  | "errorSplit"
  | "errorDuplicate"
  | "errorParticipantNotMember"
  | "errorSettlement"
  | "errorNotFound"
  | "errorDeleted"
  | "errorConflict"
  | "errorLimit"
  | "errorNetwork"
  | "errorUnknown";

const EXPENSES_COPY = {
  "zh-TW": {
    title: "共同記帳",
    back: "返回",
    overviewEmpty: "還沒有花費，點這裡開始一起記帳。",
    overviewMore: "另 {n} 種幣別 · {m} 筆",
    overviewCount: "{count} 筆",
    overviewCountOne: "{count} 筆",
    overviewLoading: "載入中…",
    overviewLoadFailed: "無法載入記帳",
    overviewCta: "查看 →",
    tabsLabel: "記帳分頁",
    tabExpenses: "花費",
    tabSettle: "結算",
    totalLabel: "總花費",
    myNetLabel: "我的淨額",
    netOwed: "別人欠你 {amount}",
    netOwe: "你欠別人 {amount}",
    netSettled: "已結清",
    emptyTitle: "還沒有花費",
    emptyBody: "記下一起出遊的花費，Roamie 會幫你算好誰該還誰。",
    add: "新增花費",
    loading: "載入花費中…",
    loadFailed: "無法載入花費，請稍後再試",
    retry: "重試",
    refreshing: "更新中…",
    pullToRefresh: "下拉更新",
    releaseToRefresh: "放開以更新",
    paidBy: "{name} 先付",
    settlementRow: "{from} 還給 {to}",
    settlementTag: "還款",
    you: "你",
    deletedUser: "已不在行程中的成員",
    deleted: "已刪除「{title}」",
    undo: "復原",
    restored: "已復原",
    sheetAddTitle: "新增花費",
    sheetEditTitle: "編輯花費",
    settlementSheetTitle: "還款紀錄",
    amountLabel: "金額",
    currencyLabel: "幣別",
    currencyChange: "選擇幣別",
    currencySearch: "搜尋幣別名稱或代碼",
    currencyUsed: "此行程用過",
    currencyCommon: "常用",
    currencyAll: "全部 A–Z",
    currencyNone: "找不到符合的幣別",
    titleLabel: "名稱",
    titlePlaceholder: "例如：晚餐、車票",
    dateLabel: "日期",
    payerLabel: "誰先付款",
    splitLabel: "分攤方式",
    splitEqual: "平均",
    splitExact: "自訂金額",
    splitPercent: "百分比",
    participantsLabel: "參與成員",
    exactRemaining: "還差 {amount}",
    exactOver: "超出 {amount}",
    exactMatched: "金額相符",
    percentRemaining: "還差 {value}%",
    percentOver: "超出 {value}%",
    percentMatched: "合計 100%",
    noteLabel: "備註",
    notePlaceholder: "選填",
    save: "儲存",
    saving: "儲存中…",
    delete: "刪除",
    deleting: "刪除中…",
    close: "關閉",
    conflictReloaded: "這筆花費剛被其他人修改，已載入最新版本，請確認後再儲存。",
    validationAmount: "請輸入大於 0 的金額",
    validationAmountDecimals: "這個幣別最多 {n} 位小數",
    validationAmountTooLarge: "金額過大",
    validationTitle: "請輸入名稱（最多 80 字）",
    validationDate: "請選擇日期",
    validationPayer: "請選擇誰先付款",
    validationParticipants: "請至少選擇一位參與成員",
    validationExact: "每人金額加總須等於總額",
    validationPercent: "百分比加總須為 100%",
    validationShareInvalid: "金額格式不正確",
    membersLoading: "載入成員中…",
    membersLoadFailed: "無法載入成員名單",
    memberPlaceholder: "成員",
    settleIntro: "不同幣別分開結算，不會換匯。",
    settleEmpty: "還沒有可以結算的花費。",
    settleMember: "成員",
    settlePaid: "已付",
    settleOwed: "應付",
    settleNet: "淨額",
    settleNetNote: "淨額已計入已標記的還款。",
    settleTransfers: "建議轉帳",
    settleAllSettled: "這個幣別已結清",
    settleMarkPaid: "標記已還",
    settleMarking: "處理中…",
    settleMarked: "已標記為已還",
    settlementTitle: "{from} 還給 {to}",
    settlePrecision: "金額過大，結算數字可能不準確。",
    settleFormerMember: "此成員已不在行程中，無法標記",
    errorNotAuthenticated: "請先登入",
    errorNotMember: "你已不在此行程中，無法記帳",
    errorMalformed: "資料格式有誤，請檢查後再試",
    errorTitle: "名稱需為 1–80 字",
    errorAmount: "金額不正確",
    errorCurrency: "不支援這個幣別",
    errorDate: "日期不正確",
    errorNote: "備註最多 500 字",
    errorSplit: "分攤金額與總額不符，請重新確認",
    errorDuplicate: "參與成員重複",
    errorParticipantNotMember: "有成員已不在此行程，請重新選擇",
    errorSettlement: "還款紀錄格式不正確",
    errorNotFound: "找不到這筆花費，可能已被刪除",
    errorDeleted: "這筆花費已被刪除",
    errorConflict: "這筆花費剛被其他人修改，已載入最新版本",
    errorLimit: "此行程的記帳筆數已達上限",
    errorNetwork: "網路連線有問題，請重試",
    errorUnknown: "操作失敗，請重試",
  },
  en: {
    title: "Shared expenses",
    back: "Back",
    overviewEmpty: "No expenses yet. Tap to start tracking together.",
    overviewMore: "+{n} more currencies · {m} expenses",
    overviewCount: "{count} expenses",
    overviewCountOne: "{count} expense",
    overviewLoading: "Loading…",
    overviewLoadFailed: "Couldn't load expenses",
    overviewCta: "View →",
    tabsLabel: "Expense sections",
    tabExpenses: "Expenses",
    tabSettle: "Settle up",
    totalLabel: "Total spent",
    myNetLabel: "My balance",
    netOwed: "You’re owed {amount}",
    netOwe: "You owe {amount}",
    netSettled: "All settled",
    emptyTitle: "No expenses yet",
    emptyBody: "Log what you spend together and Roamie works out who owes whom.",
    add: "Add expense",
    loading: "Loading expenses…",
    loadFailed: "Couldn’t load expenses. Please try again later.",
    retry: "Retry",
    refreshing: "Refreshing…",
    pullToRefresh: "Pull to refresh",
    releaseToRefresh: "Release to refresh",
    paidBy: "Paid by {name}",
    settlementRow: "{from} paid {to}",
    settlementTag: "Repayment",
    you: "You",
    deletedUser: "Former member",
    deleted: "Deleted “{title}”",
    undo: "Undo",
    restored: "Restored",
    sheetAddTitle: "Add expense",
    sheetEditTitle: "Edit expense",
    settlementSheetTitle: "Repayment",
    amountLabel: "Amount",
    currencyLabel: "Currency",
    currencyChange: "Choose currency",
    currencySearch: "Search currency name or code",
    currencyUsed: "Used in this trip",
    currencyCommon: "Common",
    currencyAll: "All A–Z",
    currencyNone: "No matching currency",
    titleLabel: "Title",
    titlePlaceholder: "e.g. Dinner, train tickets",
    dateLabel: "Date",
    payerLabel: "Paid by",
    splitLabel: "Split",
    splitEqual: "Equal",
    splitExact: "Exact",
    splitPercent: "Percent",
    participantsLabel: "Split between",
    exactRemaining: "{amount} left",
    exactOver: "{amount} over",
    exactMatched: "Amounts match",
    percentRemaining: "{value}% left",
    percentOver: "{value}% over",
    percentMatched: "Total 100%",
    noteLabel: "Note",
    notePlaceholder: "Optional",
    save: "Save",
    saving: "Saving…",
    delete: "Delete",
    deleting: "Deleting…",
    close: "Close",
    conflictReloaded:
      "Someone just changed this expense. The latest version is loaded—please review before saving.",
    validationAmount: "Enter an amount greater than 0",
    validationAmountDecimals: "This currency allows up to {n} decimal places",
    validationAmountTooLarge: "Amount is too large",
    validationTitle: "Enter a title (up to 80 characters)",
    validationDate: "Choose a date",
    validationPayer: "Choose who paid",
    validationParticipants: "Choose at least one person",
    validationExact: "Amounts must add up to the total",
    validationPercent: "Percentages must add up to 100%",
    validationShareInvalid: "Invalid amount",
    membersLoading: "Loading members…",
    membersLoadFailed: "Couldn't load trip members",
    memberPlaceholder: "Member",
    settleIntro: "Each currency is settled separately. No currency conversion.",
    settleEmpty: "Nothing to settle yet.",
    settleMember: "Member",
    settlePaid: "Paid",
    settleOwed: "Share",
    settleNet: "Balance",
    settleNetNote: "Balances include repayments marked as paid.",
    settleTransfers: "Suggested payments",
    settleAllSettled: "All settled in this currency",
    settleMarkPaid: "Mark as paid",
    settleMarking: "Saving…",
    settleMarked: "Marked as paid",
    settlementTitle: "{from} paid {to}",
    settlePrecision: "Amounts are too large; balances may be inaccurate.",
    settleFormerMember: "This member has left the trip, so it can't be marked",
    errorNotAuthenticated: "Please log in first",
    errorNotMember: "You’re no longer in this trip",
    errorMalformed: "Something’s wrong with the data. Please check and try again.",
    errorTitle: "Title must be 1–80 characters",
    errorAmount: "Invalid amount",
    errorCurrency: "This currency isn’t supported",
    errorDate: "Invalid date",
    errorNote: "Notes can be up to 500 characters",
    errorSplit: "The split doesn’t match the total. Please check.",
    errorDuplicate: "A person is listed more than once",
    errorParticipantNotMember: "Someone is no longer in this trip. Please choose again.",
    errorSettlement: "Invalid repayment record",
    errorNotFound: "This expense couldn’t be found. It may have been deleted.",
    errorDeleted: "This expense has been deleted",
    errorConflict: "Someone just changed this expense. The latest version is loaded.",
    errorLimit: "This trip has reached its expense limit",
    errorNetwork: "Network problem. Please try again.",
    errorUnknown: "Something went wrong. Please try again.",
  },
  ja: {
    title: "割り勘メモ",
    back: "戻る",
    overviewEmpty: "まだ支出はありません。タップして一緒に記録しましょう。",
    overviewMore: "ほか {n} 通貨 · {m}件",
    overviewCount: "{count}件",
    overviewCountOne: "{count}件",
    overviewLoading: "読み込み中…",
    overviewLoadFailed: "支出を読み込めませんでした",
    overviewCta: "見る →",
    tabsLabel: "割り勘のセクション",
    tabExpenses: "支出",
    tabSettle: "精算",
    totalLabel: "支出合計",
    myNetLabel: "自分の収支",
    netOwed: "受け取り {amount}",
    netOwe: "支払い {amount}",
    netSettled: "精算済み",
    emptyTitle: "まだ支出はありません",
    emptyBody: "旅の支出を記録すると、誰が誰にいくら返すかを Roamie が計算します。",
    add: "支出を追加",
    loading: "支出を読み込み中…",
    loadFailed: "支出を読み込めませんでした。しばらくしてからお試しください",
    retry: "再試行",
    refreshing: "更新中…",
    pullToRefresh: "引っ張って更新",
    releaseToRefresh: "離して更新",
    paidBy: "{name} が支払い",
    settlementRow: "{from} → {to} に返済",
    settlementTag: "返済",
    you: "自分",
    deletedUser: "退出したメンバー",
    deleted: "「{title}」を削除しました",
    undo: "元に戻す",
    restored: "元に戻しました",
    sheetAddTitle: "支出を追加",
    sheetEditTitle: "支出を編集",
    settlementSheetTitle: "返済の記録",
    amountLabel: "金額",
    currencyLabel: "通貨",
    currencyChange: "通貨を選択",
    currencySearch: "通貨名またはコードで検索",
    currencyUsed: "この旅程で使用",
    currencyCommon: "よく使う通貨",
    currencyAll: "すべて A–Z",
    currencyNone: "該当する通貨がありません",
    titleLabel: "項目名",
    titlePlaceholder: "例：夕食、乗車券",
    dateLabel: "日付",
    payerLabel: "支払った人",
    splitLabel: "分け方",
    splitEqual: "均等",
    splitExact: "金額指定",
    splitPercent: "割合",
    participantsLabel: "対象メンバー",
    exactRemaining: "残り {amount}",
    exactOver: "{amount} 超過",
    exactMatched: "金額が一致しています",
    percentRemaining: "残り {value}%",
    percentOver: "{value}% 超過",
    percentMatched: "合計 100%",
    noteLabel: "メモ",
    notePlaceholder: "任意",
    save: "保存",
    saving: "保存中…",
    delete: "削除",
    deleting: "削除中…",
    close: "閉じる",
    conflictReloaded:
      "この支出は他のメンバーが変更しました。最新の内容を読み込みましたので、確認してから保存してください。",
    validationAmount: "0 より大きい金額を入力してください",
    validationAmountDecimals: "この通貨は小数点以下 {n} 桁までです",
    validationAmountTooLarge: "金額が大きすぎます",
    validationTitle: "項目名を入力してください（80 文字まで）",
    validationDate: "日付を選択してください",
    validationPayer: "支払った人を選択してください",
    validationParticipants: "対象メンバーを 1 人以上選択してください",
    validationExact: "各自の金額の合計を総額に合わせてください",
    validationPercent: "割合の合計を 100% にしてください",
    validationShareInvalid: "金額の形式が正しくありません",
    membersLoading: "メンバーを読み込み中…",
    membersLoadFailed: "メンバーを読み込めませんでした",
    memberPlaceholder: "メンバー",
    settleIntro: "通貨ごとに別々に精算します。両替はしません。",
    settleEmpty: "精算できる支出はまだありません。",
    settleMember: "メンバー",
    settlePaid: "支払額",
    settleOwed: "負担額",
    settleNet: "差額",
    settleNetNote: "差額には返済済みとして記録した分が含まれます。",
    settleTransfers: "おすすめの送金",
    settleAllSettled: "この通貨は精算済みです",
    settleMarkPaid: "返済済みにする",
    settleMarking: "処理中…",
    settleMarked: "返済済みにしました",
    settlementTitle: "{from} → {to} に返済",
    settlePrecision: "金額が大きすぎるため、精算額が正確でない可能性があります。",
    settleFormerMember: "このメンバーは退出しているため、記録できません",
    errorNotAuthenticated: "先にログインしてください",
    errorNotMember: "この旅程のメンバーではなくなりました",
    errorMalformed: "データの形式に問題があります。確認して再度お試しください",
    errorTitle: "項目名は 1〜80 文字で入力してください",
    errorAmount: "金額が正しくありません",
    errorCurrency: "この通貨には対応していません",
    errorDate: "日付が正しくありません",
    errorNote: "メモは 500 文字までです",
    errorSplit: "分け方の金額が総額と一致しません。確認してください",
    errorDuplicate: "同じメンバーが重複しています",
    errorParticipantNotMember: "旅程を抜けたメンバーがいます。選び直してください",
    errorSettlement: "返済の記録が正しくありません",
    errorNotFound: "この支出が見つかりません。削除された可能性があります",
    errorDeleted: "この支出は削除されています",
    errorConflict: "この支出は他のメンバーが変更しました。最新の内容を読み込みました",
    errorLimit: "この旅程の記録件数が上限に達しました",
    errorNetwork: "ネットワークに問題があります。再試行してください",
    errorUnknown: "処理に失敗しました。再試行してください",
  },
  ko: {
    title: "공동 가계부",
    back: "뒤로",
    overviewEmpty: "아직 지출이 없어요. 눌러서 함께 기록해 보세요.",
    overviewMore: "외 {n}개 통화 · {m}건",
    overviewCount: "{count}건",
    overviewCountOne: "{count}건",
    overviewLoading: "불러오는 중…",
    overviewLoadFailed: "가계부를 불러오지 못했어요",
    overviewCta: "보기 →",
    tabsLabel: "가계부 섹션",
    tabExpenses: "지출",
    tabSettle: "정산",
    totalLabel: "총 지출",
    myNetLabel: "내 잔액",
    netOwed: "받을 돈 {amount}",
    netOwe: "갚을 돈 {amount}",
    netSettled: "정산 완료",
    emptyTitle: "아직 지출이 없어요",
    emptyBody: "함께 쓴 돈을 기록하면 누가 누구에게 갚아야 하는지 Roamie가 계산해 드려요.",
    add: "지출 추가",
    loading: "지출을 불러오는 중…",
    loadFailed: "지출을 불러오지 못했어요. 잠시 후 다시 시도해 주세요",
    retry: "다시 시도",
    refreshing: "새로고침 중…",
    pullToRefresh: "당겨서 새로고침",
    releaseToRefresh: "놓으면 새로고침",
    paidBy: "{name} 님이 결제",
    settlementRow: "{from} → {to} 상환",
    settlementTag: "상환",
    you: "나",
    deletedUser: "나간 멤버",
    deleted: "“{title}” 삭제됨",
    undo: "실행 취소",
    restored: "복원했어요",
    sheetAddTitle: "지출 추가",
    sheetEditTitle: "지출 수정",
    settlementSheetTitle: "상환 기록",
    amountLabel: "금액",
    currencyLabel: "통화",
    currencyChange: "통화 선택",
    currencySearch: "통화 이름 또는 코드 검색",
    currencyUsed: "이 일정에서 사용",
    currencyCommon: "자주 쓰는 통화",
    currencyAll: "전체 A–Z",
    currencyNone: "일치하는 통화가 없어요",
    titleLabel: "항목명",
    titlePlaceholder: "예: 저녁 식사, 교통권",
    dateLabel: "날짜",
    payerLabel: "결제한 사람",
    splitLabel: "나누는 방식",
    splitEqual: "균등",
    splitExact: "금액 지정",
    splitPercent: "비율",
    participantsLabel: "참여 멤버",
    exactRemaining: "{amount} 남음",
    exactOver: "{amount} 초과",
    exactMatched: "금액이 일치해요",
    percentRemaining: "{value}% 남음",
    percentOver: "{value}% 초과",
    percentMatched: "합계 100%",
    noteLabel: "메모",
    notePlaceholder: "선택 사항",
    save: "저장",
    saving: "저장 중…",
    delete: "삭제",
    deleting: "삭제 중…",
    close: "닫기",
    conflictReloaded:
      "다른 멤버가 이 지출을 방금 수정했어요. 최신 내용을 불러왔으니 확인 후 저장해 주세요.",
    validationAmount: "0보다 큰 금액을 입력해 주세요",
    validationAmountDecimals: "이 통화는 소수점 {n}자리까지 입력할 수 있어요",
    validationAmountTooLarge: "금액이 너무 커요",
    validationTitle: "항목명을 입력해 주세요(최대 80자)",
    validationDate: "날짜를 선택해 주세요",
    validationPayer: "결제한 사람을 선택해 주세요",
    validationParticipants: "참여 멤버를 한 명 이상 선택해 주세요",
    validationExact: "각자 금액의 합이 총액과 같아야 해요",
    validationPercent: "비율의 합이 100%여야 해요",
    validationShareInvalid: "금액 형식이 올바르지 않아요",
    membersLoading: "멤버를 불러오는 중…",
    membersLoadFailed: "멤버 목록을 불러오지 못했어요",
    memberPlaceholder: "멤버",
    settleIntro: "통화별로 따로 정산하며 환전하지 않아요.",
    settleEmpty: "아직 정산할 지출이 없어요.",
    settleMember: "멤버",
    settlePaid: "결제액",
    settleOwed: "부담액",
    settleNet: "잔액",
    settleNetNote: "잔액에는 상환 완료로 표시한 금액이 반영돼요.",
    settleTransfers: "추천 송금",
    settleAllSettled: "이 통화는 정산이 끝났어요",
    settleMarkPaid: "상환 완료",
    settleMarking: "처리 중…",
    settleMarked: "상환 완료로 표시했어요",
    settlementTitle: "{from} → {to} 상환",
    settlePrecision: "금액이 너무 커서 정산 금액이 정확하지 않을 수 있어요.",
    settleFormerMember: "이 멤버는 여행에서 나가서 표시할 수 없어요",
    errorNotAuthenticated: "먼저 로그인해 주세요",
    errorNotMember: "이 일정에서 더 이상 멤버가 아니에요",
    errorMalformed: "데이터 형식에 문제가 있어요. 확인 후 다시 시도해 주세요",
    errorTitle: "항목명은 1~80자여야 해요",
    errorAmount: "금액이 올바르지 않아요",
    errorCurrency: "지원하지 않는 통화예요",
    errorDate: "날짜가 올바르지 않아요",
    errorNote: "메모는 최대 500자예요",
    errorSplit: "나눈 금액이 총액과 맞지 않아요. 다시 확인해 주세요",
    errorDuplicate: "같은 멤버가 중복되어 있어요",
    errorParticipantNotMember: "일정에서 나간 멤버가 있어요. 다시 선택해 주세요",
    errorSettlement: "상환 기록이 올바르지 않아요",
    errorNotFound: "이 지출을 찾을 수 없어요. 삭제되었을 수 있어요",
    errorDeleted: "삭제된 지출이에요",
    errorConflict: "다른 멤버가 이 지출을 방금 수정했어요. 최신 내용을 불러왔어요",
    errorLimit: "이 일정의 기록 건수가 한도에 도달했어요",
    errorNetwork: "네트워크 문제가 있어요. 다시 시도해 주세요",
    errorUnknown: "처리하지 못했어요. 다시 시도해 주세요",
  },
} satisfies Record<Locale, Record<TripExpensesCopyKey, string>>;

export type TripExpensesCopy = Record<TripExpensesCopyKey, string>;

export function getTripExpensesCopy(locale: Locale = effectiveAppLocale()): TripExpensesCopy {
  return EXPENSES_COPY[locale];
}

// ── 我的行李（Trip Workspace V1 第 5 階段） ─────────────────────────────

type TripPackingCopyKey =
  | "title"
  | "privateNote"
  | "back"
  | "editCategories"
  | "done"
  | "progress"
  | "categoryProgress"
  | "overviewProgress"
  | "overviewEmpty"
  | "overviewLoading"
  | "overviewLoadFailed"
  | "overviewCta"
  | "loading"
  | "loadFailed"
  | "retry"
  | "refreshing"
  | "collapse"
  | "expand"
  | "categoryEmpty"
  | "emptyTitle"
  | "emptyBody"
  | "addItem"
  | "addItemPlaceholder"
  | "addItemLabel"
  | "suggestionsLabel"
  | "addSuggestionLabel"
  | "quantityBadge"
  | "itemSheetTitle"
  | "nameLabel"
  | "quantityLabel"
  | "quantityDecrease"
  | "quantityIncrease"
  | "categoryLabel"
  | "noteLabel"
  | "notePlaceholder"
  | "save"
  | "saving"
  | "delete"
  | "deleting"
  | "cancel"
  | "close"
  | "conflictReloaded"
  | "validationName"
  | "validationNote"
  | "validationCategoryName"
  | "itemDeleted"
  | "undo"
  | "restored"
  | "categoriesSheetTitle"
  | "categoriesSheetHint"
  | "addCategory"
  | "newCategoryPlaceholder"
  | "categoryNameLabel"
  | "iconLabel"
  | "iconOption"
  | "moveUp"
  | "moveDown"
  | "deleteCategory"
  | "deleteCategoryTitle"
  | "deleteCategoryEmptyBody"
  | "deleteCategoryItemsBody"
  | "deleteCategoryItemsBodyOne"
  | "deleteMoveOption"
  | "deleteMoveTarget"
  | "deleteWithItemsOption"
  | "deleteWithItemsConfirmTitle"
  | "deleteWithItemsConfirmTitleOne"
  | "deleteWithItemsConfirmBody"
  | "confirmDelete"
  | "categoryDeleted"
  | "categoryDeletedMoved"
  | "categoryDeletedMovedSplit"
  | "categoryMovedElsewherePart"
  | "categoryMovedElsewhereSeparator"
  | "defaultClothing"
  | "defaultToiletries"
  | "defaultElectronics"
  | "defaultDocuments"
  | "defaultMedicine"
  | "defaultOther"
  | "errorNotAuthenticated"
  | "errorNotMember"
  | "errorInvalidIcon"
  | "errorCategoryDeleted"
  | "errorCategoryNotFound"
  | "errorCategoryLimit"
  | "errorItemLimit"
  | "errorItemName"
  | "errorQuantity"
  | "errorNote"
  | "errorCategoryName"
  | "errorConflict"
  | "errorToggle"
  | "errorMoveFailed"
  | "errorMovePartialConflict"
  | "errorMovePartialNetwork"
  | "errorMovePartial"
  | "errorNetwork"
  | "errorUnknown";

const PACKING_COPY = {
  "zh-TW": {
    title: "我的行李",
    privateNote: "只有你看得到這份清單",
    back: "返回",
    editCategories: "編輯分類",
    done: "完成",
    progress: "已打包 {checked} / {total}",
    categoryProgress: "{checked} / {total}",
    overviewProgress: "{checked} / {total} 已打包",
    overviewEmpty: "還沒有物品，點這裡開始整理行李。",
    overviewLoading: "載入中…",
    overviewLoadFailed: "無法載入行李清單",
    overviewCta: "查看 →",
    loading: "載入行李清單中…",
    loadFailed: "無法載入行李清單，請稍後再試",
    retry: "重試",
    refreshing: "更新中…",
    collapse: "收合「{name}」",
    expand: "展開「{name}」",
    categoryEmpty: "這個分類還沒有物品",
    emptyTitle: "還沒有任何分類",
    emptyBody: "新增物品時會自動建立「其他」分類。",
    addItem: "新增物品",
    addItemPlaceholder: "輸入物品名稱，按 Enter 新增",
    addItemLabel: "新增到「{name}」的物品名稱",
    suggestionsLabel: "建議",
    addSuggestionLabel: "新增「{item}」到「{name}」",
    quantityBadge: "×{count}",
    itemSheetTitle: "編輯物品",
    nameLabel: "名稱",
    quantityLabel: "數量",
    quantityDecrease: "減少數量",
    quantityIncrease: "增加數量",
    categoryLabel: "分類",
    noteLabel: "備註",
    notePlaceholder: "選填",
    save: "儲存",
    saving: "儲存中…",
    delete: "刪除",
    deleting: "刪除中…",
    cancel: "取消",
    close: "關閉",
    conflictReloaded: "這個物品剛在其他裝置被修改，已載入最新版本，請確認後再儲存。",
    validationName: "請輸入名稱（最多 80 字）",
    validationNote: "備註最多 200 字",
    validationCategoryName: "請輸入分類名稱（最多 40 字）",
    itemDeleted: "已刪除「{name}」",
    undo: "復原",
    restored: "已復原",
    categoriesSheetTitle: "編輯分類",
    categoriesSheetHint: "點名稱即可改名，點圖示可更換。",
    addCategory: "新增分類",
    newCategoryPlaceholder: "分類名稱",
    categoryNameLabel: "分類名稱",
    iconLabel: "圖示",
    iconOption: "圖示 {n}",
    moveUp: "上移",
    moveDown: "下移",
    deleteCategory: "刪除分類",
    deleteCategoryTitle: "刪除「{name}」？",
    deleteCategoryEmptyBody: "這個分類沒有物品。",
    deleteCategoryItemsBody: "這個分類有 {count} 件物品，要怎麼處理？",
    deleteCategoryItemsBodyOne: "這個分類有 {count} 件物品，要怎麼處理？",
    deleteMoveOption: "移到其他分類",
    deleteMoveTarget: "移到",
    deleteWithItemsOption: "連同物品一起刪除",
    deleteWithItemsConfirmTitle: "確定連同 {count} 件物品一起刪除？",
    deleteWithItemsConfirmTitleOne: "確定連同 {count} 件物品一起刪除？",
    deleteWithItemsConfirmBody: "刪除後 6 秒內可以復原。",
    confirmDelete: "刪除",
    categoryDeleted: "已刪除「{name}」",
    categoryDeletedMoved: "已刪除「{name}」，物品已移到「{target}」",
    categoryDeletedMovedSplit: "已刪除「{name}」，物品已移到「{target}」，另有 {others}",
    categoryMovedElsewherePart: "{count} 件在「{target}」",
    categoryMovedElsewhereSeparator: "、",
    defaultClothing: "衣物",
    defaultToiletries: "盥洗用品",
    defaultElectronics: "電子用品",
    defaultDocuments: "證件",
    defaultMedicine: "藥品",
    defaultOther: "其他",
    errorNotAuthenticated: "請先登入",
    errorNotMember: "你已不在此行程中",
    errorInvalidIcon: "不支援這個圖示",
    errorCategoryDeleted: "這個分類已被刪除",
    errorCategoryNotFound: "找不到這個分類，可能已被刪除",
    errorCategoryLimit: "分類數量已達上限（30 個）",
    errorItemLimit: "物品數量已達上限（500 件）",
    errorItemName: "物品名稱需為 1–80 字",
    errorQuantity: "數量需為 1–99",
    errorNote: "備註最多 200 字",
    errorCategoryName: "分類名稱需為 1–40 字",
    errorConflict: "這個物品剛被修改，已載入最新版本",
    errorToggle: "無法更新打包狀態，請重試",
    errorMoveFailed: "無法移動物品，分類未刪除",
    errorMovePartialConflict:
      "物品剛被修改，已移動 {count} 件到「{target}」，分類未刪除，可重試移動剩下的物品",
    errorMovePartialNetwork:
      "網路連線有問題，已移動 {count} 件到「{target}」，分類未刪除，可重試移動剩下的物品",
    errorMovePartial: "移動中斷，已移動 {count} 件到「{target}」，分類未刪除，可重試移動剩下的物品",
    errorNetwork: "網路連線有問題，請重試",
    errorUnknown: "操作失敗，請重試",
  },
  en: {
    title: "My packing list",
    privateNote: "Only you can see this list",
    back: "Back",
    editCategories: "Edit categories",
    done: "Done",
    progress: "Packed {checked} / {total}",
    categoryProgress: "{checked} / {total}",
    overviewProgress: "{checked} / {total} packed",
    overviewEmpty: "No items yet. Tap to start packing.",
    overviewLoading: "Loading…",
    overviewLoadFailed: "Couldn't load your packing list",
    overviewCta: "View →",
    loading: "Loading your packing list…",
    loadFailed: "Couldn’t load your packing list. Please try again later.",
    retry: "Retry",
    refreshing: "Refreshing…",
    collapse: "Collapse “{name}”",
    expand: "Expand “{name}”",
    categoryEmpty: "No items in this category yet",
    emptyTitle: "No categories yet",
    emptyBody: "An “Other” category is created automatically when you add an item.",
    addItem: "Add item",
    addItemPlaceholder: "Item name, press Enter to add",
    addItemLabel: "New item name for “{name}”",
    suggestionsLabel: "Suggestions",
    addSuggestionLabel: "Add “{item}” to “{name}”",
    quantityBadge: "×{count}",
    itemSheetTitle: "Edit item",
    nameLabel: "Name",
    quantityLabel: "Quantity",
    quantityDecrease: "Decrease quantity",
    quantityIncrease: "Increase quantity",
    categoryLabel: "Category",
    noteLabel: "Note",
    notePlaceholder: "Optional",
    save: "Save",
    saving: "Saving…",
    delete: "Delete",
    deleting: "Deleting…",
    cancel: "Cancel",
    close: "Close",
    conflictReloaded:
      "This item was just changed on another device. The latest version is loaded—please review before saving.",
    validationName: "Enter a name (up to 80 characters)",
    validationNote: "Notes can be up to 200 characters",
    validationCategoryName: "Enter a category name (up to 40 characters)",
    itemDeleted: "Deleted “{name}”",
    undo: "Undo",
    restored: "Restored",
    categoriesSheetTitle: "Edit categories",
    categoriesSheetHint: "Tap a name to rename it, or an icon to change it.",
    addCategory: "Add category",
    newCategoryPlaceholder: "Category name",
    categoryNameLabel: "Category name",
    iconLabel: "Icon",
    iconOption: "Icon {n}",
    moveUp: "Move up",
    moveDown: "Move down",
    deleteCategory: "Delete category",
    deleteCategoryTitle: "Delete “{name}”?",
    deleteCategoryEmptyBody: "This category has no items.",
    deleteCategoryItemsBody: "This category has {count} items. What should happen to them?",
    deleteCategoryItemsBodyOne: "This category has {count} item. What should happen to it?",
    deleteMoveOption: "Move to another category",
    deleteMoveTarget: "Move to",
    deleteWithItemsOption: "Delete with items",
    deleteWithItemsConfirmTitle: "Delete the category and its {count} items?",
    deleteWithItemsConfirmTitleOne: "Delete the category and its {count} item?",
    deleteWithItemsConfirmBody: "You can undo this for 6 seconds.",
    confirmDelete: "Delete",
    categoryDeleted: "Deleted “{name}”",
    categoryDeletedMoved: "Deleted “{name}”. Items moved to “{target}”",
    categoryDeletedMovedSplit: "Deleted “{name}”. Items moved to “{target}” ({others})",
    categoryMovedElsewherePart: "{count} in “{target}”",
    categoryMovedElsewhereSeparator: ", ",
    defaultClothing: "Clothing",
    defaultToiletries: "Toiletries",
    defaultElectronics: "Electronics",
    defaultDocuments: "Documents",
    defaultMedicine: "Medicine",
    defaultOther: "Other",
    errorNotAuthenticated: "Please log in first",
    errorNotMember: "You’re no longer in this trip",
    errorInvalidIcon: "This icon isn’t supported",
    errorCategoryDeleted: "This category has been deleted",
    errorCategoryNotFound: "This category couldn’t be found. It may have been deleted.",
    errorCategoryLimit: "You’ve reached the category limit (30)",
    errorItemLimit: "You’ve reached the item limit (500)",
    errorItemName: "Item names must be 1–80 characters",
    errorQuantity: "Quantity must be 1–99",
    errorNote: "Notes can be up to 200 characters",
    errorCategoryName: "Category names must be 1–40 characters",
    errorConflict: "This item was just changed. The latest version is loaded.",
    errorToggle: "Couldn’t update the packed status. Please try again.",
    errorMoveFailed: "Couldn’t move the items, so the category wasn’t deleted",
    errorMovePartialConflict:
      "An item was just changed. Moved {count} to “{target}”; the category wasn’t deleted. Try again to move the rest.",
    errorMovePartialNetwork:
      "Network problem. Moved {count} to “{target}”; the category wasn’t deleted. Try again to move the rest.",
    errorMovePartial:
      "Moving stopped. Moved {count} to “{target}”; the category wasn’t deleted. Try again to move the rest.",
    errorNetwork: "Network problem. Please try again.",
    errorUnknown: "Something went wrong. Please try again.",
  },
  ja: {
    title: "自分の持ち物",
    privateNote: "このリストは自分だけに表示されます",
    back: "戻る",
    editCategories: "カテゴリを編集",
    done: "完了",
    progress: "準備済み {checked} / {total}",
    categoryProgress: "{checked} / {total}",
    overviewProgress: "{checked} / {total} 準備済み",
    overviewEmpty: "まだ持ち物はありません。タップして準備を始めましょう。",
    overviewLoading: "読み込み中…",
    overviewLoadFailed: "持ち物リストを読み込めませんでした",
    overviewCta: "見る →",
    loading: "持ち物リストを読み込み中…",
    loadFailed: "持ち物リストを読み込めませんでした。しばらくしてからお試しください",
    retry: "再試行",
    refreshing: "更新中…",
    collapse: "「{name}」を折りたたむ",
    expand: "「{name}」を展開",
    categoryEmpty: "このカテゴリにはまだ持ち物がありません",
    emptyTitle: "カテゴリがありません",
    emptyBody: "持ち物を追加すると「その他」カテゴリが自動で作成されます。",
    addItem: "持ち物を追加",
    addItemPlaceholder: "持ち物の名前を入力して Enter",
    addItemLabel: "「{name}」に追加する持ち物の名前",
    suggestionsLabel: "おすすめ",
    addSuggestionLabel: "「{item}」を「{name}」に追加",
    quantityBadge: "×{count}",
    itemSheetTitle: "持ち物を編集",
    nameLabel: "名前",
    quantityLabel: "数量",
    quantityDecrease: "数量を減らす",
    quantityIncrease: "数量を増やす",
    categoryLabel: "カテゴリ",
    noteLabel: "メモ",
    notePlaceholder: "任意",
    save: "保存",
    saving: "保存中…",
    delete: "削除",
    deleting: "削除中…",
    cancel: "キャンセル",
    close: "閉じる",
    conflictReloaded:
      "この持ち物は別の端末で変更されました。最新の内容を読み込みましたので、確認してから保存してください。",
    validationName: "名前を入力してください（80 文字まで）",
    validationNote: "メモは 200 文字までです",
    validationCategoryName: "カテゴリ名を入力してください（40 文字まで）",
    itemDeleted: "「{name}」を削除しました",
    undo: "元に戻す",
    restored: "元に戻しました",
    categoriesSheetTitle: "カテゴリを編集",
    categoriesSheetHint: "名前をタップすると名前を変更、アイコンをタップすると変更できます。",
    addCategory: "カテゴリを追加",
    newCategoryPlaceholder: "カテゴリ名",
    categoryNameLabel: "カテゴリ名",
    iconLabel: "アイコン",
    iconOption: "アイコン {n}",
    moveUp: "上へ移動",
    moveDown: "下へ移動",
    deleteCategory: "カテゴリを削除",
    deleteCategoryTitle: "「{name}」を削除しますか？",
    deleteCategoryEmptyBody: "このカテゴリには持ち物がありません。",
    deleteCategoryItemsBody: "このカテゴリには持ち物が {count} 件あります。どうしますか？",
    deleteCategoryItemsBodyOne: "このカテゴリには持ち物が {count} 件あります。どうしますか？",
    deleteMoveOption: "別のカテゴリに移動",
    deleteMoveTarget: "移動先",
    deleteWithItemsOption: "持ち物ごと削除",
    deleteWithItemsConfirmTitle: "持ち物 {count} 件ごと削除しますか？",
    deleteWithItemsConfirmTitleOne: "持ち物 {count} 件ごと削除しますか？",
    deleteWithItemsConfirmBody: "削除後 6 秒間は元に戻せます。",
    confirmDelete: "削除",
    categoryDeleted: "「{name}」を削除しました",
    categoryDeletedMoved: "「{name}」を削除し、持ち物を「{target}」に移動しました",
    categoryDeletedMovedSplit:
      "「{name}」を削除し、持ち物を「{target}」に移動しました（ほか{others}）",
    categoryMovedElsewherePart: "{count}件は「{target}」に移動済み",
    categoryMovedElsewhereSeparator: "、",
    defaultClothing: "衣類",
    defaultToiletries: "洗面用具",
    defaultElectronics: "電子機器",
    defaultDocuments: "書類・身分証",
    defaultMedicine: "薬",
    defaultOther: "その他",
    errorNotAuthenticated: "先にログインしてください",
    errorNotMember: "この旅程のメンバーではなくなりました",
    errorInvalidIcon: "このアイコンは使用できません",
    errorCategoryDeleted: "このカテゴリは削除されています",
    errorCategoryNotFound: "このカテゴリが見つかりません。削除された可能性があります",
    errorCategoryLimit: "カテゴリ数が上限（30 個）に達しました",
    errorItemLimit: "持ち物の数が上限（500 件）に達しました",
    errorItemName: "持ち物の名前は 1〜80 文字で入力してください",
    errorQuantity: "数量は 1〜99 で入力してください",
    errorNote: "メモは 200 文字までです",
    errorCategoryName: "カテゴリ名は 1〜40 文字で入力してください",
    errorConflict: "この持ち物は変更されました。最新の内容を読み込みました",
    errorToggle: "準備状態を更新できませんでした。再試行してください",
    errorMoveFailed: "持ち物を移動できなかったため、カテゴリは削除されていません",
    errorMovePartialConflict:
      "持ち物が変更されました。{count} 件を「{target}」に移動済みで、カテゴリは削除されていません。再試行すると残りを移動します",
    errorMovePartialNetwork:
      "ネットワークに問題があります。{count} 件を「{target}」に移動済みで、カテゴリは削除されていません。再試行すると残りを移動します",
    errorMovePartial:
      "移動が中断されました。{count} 件を「{target}」に移動済みで、カテゴリは削除されていません。再試行すると残りを移動します",
    errorNetwork: "ネットワークに問題があります。再試行してください",
    errorUnknown: "処理に失敗しました。再試行してください",
  },
  ko: {
    title: "내 짐",
    privateNote: "이 목록은 나만 볼 수 있어요",
    back: "뒤로",
    editCategories: "카테고리 편집",
    done: "완료",
    progress: "챙긴 짐 {checked} / {total}",
    categoryProgress: "{checked} / {total}",
    overviewProgress: "{checked} / {total} 챙김",
    overviewEmpty: "아직 짐이 없어요. 눌러서 짐 싸기를 시작해 보세요.",
    overviewLoading: "불러오는 중…",
    overviewLoadFailed: "짐 목록을 불러오지 못했어요",
    overviewCta: "보기 →",
    loading: "짐 목록을 불러오는 중…",
    loadFailed: "짐 목록을 불러오지 못했어요. 잠시 후 다시 시도해 주세요",
    retry: "다시 시도",
    refreshing: "새로고침 중…",
    collapse: "“{name}” 접기",
    expand: "“{name}” 펼치기",
    categoryEmpty: "이 카테고리에는 아직 짐이 없어요",
    emptyTitle: "카테고리가 없어요",
    emptyBody: "짐을 추가하면 “기타” 카테고리가 자동으로 만들어져요.",
    addItem: "짐 추가",
    addItemPlaceholder: "짐 이름을 입력하고 Enter",
    addItemLabel: "“{name}”에 추가할 짐 이름",
    suggestionsLabel: "추천",
    addSuggestionLabel: "“{item}”을(를) “{name}”에 추가",
    quantityBadge: "×{count}",
    itemSheetTitle: "짐 편집",
    nameLabel: "이름",
    quantityLabel: "수량",
    quantityDecrease: "수량 줄이기",
    quantityIncrease: "수량 늘리기",
    categoryLabel: "카테고리",
    noteLabel: "메모",
    notePlaceholder: "선택 사항",
    save: "저장",
    saving: "저장 중…",
    delete: "삭제",
    deleting: "삭제 중…",
    cancel: "취소",
    close: "닫기",
    conflictReloaded:
      "다른 기기에서 이 짐을 방금 수정했어요. 최신 내용을 불러왔으니 확인 후 저장해 주세요.",
    validationName: "이름을 입력해 주세요(최대 80자)",
    validationNote: "메모는 최대 200자예요",
    validationCategoryName: "카테고리 이름을 입력해 주세요(최대 40자)",
    itemDeleted: "“{name}” 삭제됨",
    undo: "실행 취소",
    restored: "복원했어요",
    categoriesSheetTitle: "카테고리 편집",
    categoriesSheetHint: "이름을 누르면 이름을, 아이콘을 누르면 아이콘을 바꿀 수 있어요.",
    addCategory: "카테고리 추가",
    newCategoryPlaceholder: "카테고리 이름",
    categoryNameLabel: "카테고리 이름",
    iconLabel: "아이콘",
    iconOption: "아이콘 {n}",
    moveUp: "위로 이동",
    moveDown: "아래로 이동",
    deleteCategory: "카테고리 삭제",
    deleteCategoryTitle: "“{name}”을(를) 삭제할까요?",
    deleteCategoryEmptyBody: "이 카테고리에는 짐이 없어요.",
    deleteCategoryItemsBody: "이 카테고리에 짐이 {count}개 있어요. 어떻게 할까요?",
    deleteCategoryItemsBodyOne: "이 카테고리에 짐이 {count}개 있어요. 어떻게 할까요?",
    deleteMoveOption: "다른 카테고리로 옮기기",
    deleteMoveTarget: "옮길 곳",
    deleteWithItemsOption: "짐까지 함께 삭제",
    deleteWithItemsConfirmTitle: "짐 {count}개까지 함께 삭제할까요?",
    deleteWithItemsConfirmTitleOne: "짐 {count}개까지 함께 삭제할까요?",
    deleteWithItemsConfirmBody: "삭제 후 6초 동안 되돌릴 수 있어요.",
    confirmDelete: "삭제",
    categoryDeleted: "“{name}” 삭제됨",
    categoryDeletedMoved: "“{name}” 삭제됨, 짐을 “{target}”(으)로 옮겼어요",
    categoryDeletedMovedSplit: "“{name}” 삭제됨, 짐을 “{target}”(으)로 옮겼어요 (그 외 {others})",
    categoryMovedElsewherePart: "{count}개는 “{target}”에",
    categoryMovedElsewhereSeparator: ", ",
    defaultClothing: "의류",
    defaultToiletries: "세면도구",
    defaultElectronics: "전자기기",
    defaultDocuments: "서류",
    defaultMedicine: "의약품",
    defaultOther: "기타",
    errorNotAuthenticated: "먼저 로그인해 주세요",
    errorNotMember: "이 일정에서 더 이상 멤버가 아니에요",
    errorInvalidIcon: "지원하지 않는 아이콘이에요",
    errorCategoryDeleted: "삭제된 카테고리예요",
    errorCategoryNotFound: "이 카테고리를 찾을 수 없어요. 삭제되었을 수 있어요",
    errorCategoryLimit: "카테고리 수가 한도(30개)에 도달했어요",
    errorItemLimit: "짐 수가 한도(500개)에 도달했어요",
    errorItemName: "짐 이름은 1~80자여야 해요",
    errorQuantity: "수량은 1~99여야 해요",
    errorNote: "메모는 최대 200자예요",
    errorCategoryName: "카테고리 이름은 1~40자여야 해요",
    errorConflict: "이 짐이 방금 수정되었어요. 최신 내용을 불러왔어요",
    errorToggle: "챙김 상태를 바꾸지 못했어요. 다시 시도해 주세요",
    errorMoveFailed: "짐을 옮기지 못해서 카테고리를 삭제하지 않았어요",
    errorMovePartialConflict:
      "짐이 방금 수정됐어요. {count}개를 “{target}”(으)로 옮겼고 카테고리는 삭제하지 않았어요. 다시 시도하면 나머지를 옮겨요",
    errorMovePartialNetwork:
      "네트워크 문제가 있어요. {count}개를 “{target}”(으)로 옮겼고 카테고리는 삭제하지 않았어요. 다시 시도하면 나머지를 옮겨요",
    errorMovePartial:
      "옮기는 중에 중단됐어요. {count}개를 “{target}”(으)로 옮겼고 카테고리는 삭제하지 않았어요. 다시 시도하면 나머지를 옮겨요",
    errorNetwork: "네트워크 문제가 있어요. 다시 시도해 주세요",
    errorUnknown: "처리하지 못했어요. 다시 시도해 주세요",
  },
} satisfies Record<Locale, Record<TripPackingCopyKey, string>>;

export type TripPackingCopy = Record<TripPackingCopyKey, string>;

export function getTripPackingCopy(locale: Locale = effectiveAppLocale()): TripPackingCopy {
  return PACKING_COPY[locale];
}
