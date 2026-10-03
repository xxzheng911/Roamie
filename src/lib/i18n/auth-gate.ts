import type { Locale } from "@/lib/i18n/types";

export const authGateMessages: Record<
  Locale,
  {
    aiTitle: string;
    aiBody: string;
    favoriteTitle: string;
    favoriteBody: string;
    tripTitle: string;
    tripBody: string;
    continueBrowsing: string;
    loginCta: string;
    savedTitle: string;
    savedBody: string;
    profileTitle: string;
    profileBody: string;
    requiredTitle: string;
    requiredBody: string;
    back: string;
    login: string;
  }
> = {
  "zh-TW": {
    aiTitle: "登入後使用 Roamie AI",
    aiBody: "登入即可取得個人化地點推薦與行程規劃。",
    favoriteTitle: "登入後收藏地點",
    favoriteBody: "登入即可保存喜歡的地點。",
    tripTitle: "登入後建立行程",
    tripBody: "登入即可建立、保存與同步你的旅程。",
    continueBrowsing: "先逛逛",
    loginCta: "登入",
    savedTitle: "登入後查看收藏與行程",
    savedBody: "登入即可保存喜歡的地點，並建立、同步你的旅程。",
    profileTitle: "登入後使用個人功能",
    profileBody: "瀏覽地點不需要登入。登入後可以收藏、規劃行程，並使用 Roamie AI。",
    requiredTitle: "需要登入",
    requiredBody: "若要繼續，需要先完成登入。",
    back: "返回",
    login: "登入",
  },
  en: {
    aiTitle: "Sign in to use Roamie AI",
    aiBody: "Sign in for personal place recommendations and trip planning.",
    favoriteTitle: "Sign in to save places",
    favoriteBody: "Sign in to keep the places you like.",
    tripTitle: "Sign in to create a trip",
    tripBody: "Sign in to create, save, and sync your trips.",
    continueBrowsing: "Browse first",
    loginCta: "Sign in",
    savedTitle: "Sign in to see saved places and trips",
    savedBody: "Sign in to save places and keep your trips in sync.",
    profileTitle: "Sign in for personal features",
    profileBody: "Browsing places does not require an account. Sign in to save, plan, and use Roamie AI.",
    requiredTitle: "Sign in required",
    requiredBody: "Sign in to continue.",
    back: "Back",
    login: "Sign in",
  },
  ja: {
    aiTitle: "ログインして Roamie AI を使う",
    aiBody: "ログインすると、あなた向けの場所提案と旅程づくりが使えます。",
    favoriteTitle: "ログインして場所を保存",
    favoriteBody: "ログインすると、気に入った場所を保存できます。",
    tripTitle: "ログインして旅程を作成",
    tripBody: "ログインすると、旅程の作成・保存・同期ができます。",
    continueBrowsing: "まずは見てみる",
    loginCta: "ログイン",
    savedTitle: "ログインして保存と旅程を見る",
    savedBody: "ログインすると、場所の保存と旅程の同期ができます。",
    profileTitle: "ログインして個人機能を使う",
    profileBody: "場所の閲覧にログインは不要です。保存、計画、Roamie AI はログイン後に使えます。",
    requiredTitle: "ログインが必要です",
    requiredBody: "続けるには、先にログインしてください。",
    back: "戻る",
    login: "ログイン",
  },
  ko: {
    aiTitle: "로그인 후 Roamie AI 사용",
    aiBody: "로그인하면 맞춤 장소 추천과 일정 계획을 받을 수 있습니다.",
    favoriteTitle: "로그인 후 장소 저장",
    favoriteBody: "로그인하면 좋아하는 장소를 저장할 수 있습니다.",
    tripTitle: "로그인 후 여행 만들기",
    tripBody: "로그인하면 여행을 만들고 저장하고 동기화할 수 있습니다.",
    continueBrowsing: "먼저 둘러보기",
    loginCta: "로그인",
    savedTitle: "로그인 후 저장과 여행 보기",
    savedBody: "로그인하면 장소를 저장하고 여행을 동기화할 수 있습니다.",
    profileTitle: "로그인 후 개인 기능 사용",
    profileBody: "장소 둘러보기는 로그인 없이 가능합니다. 저장, 계획, Roamie AI는 로그인 후 사용할 수 있습니다.",
    requiredTitle: "로그인이 필요해요",
    requiredBody: "계속하려면 먼저 로그인해 주세요.",
    back: "돌아가기",
    login: "로그인",
  },
};
