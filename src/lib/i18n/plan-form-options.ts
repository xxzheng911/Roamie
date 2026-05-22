import type { Locale } from "@/lib/i18n/types";
import type { BudgetMode } from "@/lib/preferences-storage";

export type PlanBudgetOption = { value: BudgetMode; label: string; hint: string };

export function getPlanBudgetOptions(locale: Locale): PlanBudgetOption[] {
  switch (locale) {
    case "en":
      return [
        { value: "budget", label: "Budget", hint: "Affordable & local" },
        { value: "standard", label: "Standard", hint: "Comfortable pace" },
        { value: "quality", label: "Quality", hint: "Polished, not flashy" },
        { value: "luxury", label: "Luxury", hint: "Treat yourself" },
      ];
    case "ja":
      return [
        { value: "budget", label: "節約", hint: "リーズナブル・ローカル" },
        { value: "standard", label: "標準", hint: "のんびり快適" },
        { value: "quality", label: "こだわり", hint: "質感重視" },
        { value: "luxury", label: "贅沢", hint: "しっかり楽しむ" },
      ];
    case "ko":
      return [
        { value: "budget", label: "알뜰", hint: "합리적·로컬" },
        { value: "standard", label: "일반", hint: "편안한 여유" },
        { value: "quality", label: "품질", hint: "감각 있게" },
        { value: "luxury", label: "럭셔리", hint: "제대로 즐기기" },
      ];
    default:
      return [
        { value: "budget", label: "小資", hint: "平價、在地" },
        { value: "standard", label: "一般", hint: "舒服自在" },
        { value: "quality", label: "品質感", hint: "有質感但不浮誇" },
        { value: "luxury", label: "奢華", hint: "好好享受" },
      ];
  }
}

export function getPlanTransportOptions(locale: Locale): string[] {
  switch (locale) {
    case "en":
      return ["Public transit", "Mostly walking", "Self-drive", "Taxi / rideshare", "Cycling"];
    case "ja":
      return ["公共交通", "徒歩中心", "レンタカー", "タクシー・配車", "自転車"];
    case "ko":
      return ["대중교통", "도보 위주", "렌터카", "택시·호출", "자전거"];
    default:
      return ["大眾運輸", "步行為主", "租車自駕", "計程車/共乘", "單車"];
  }
}

export function getPlanStyleOptions(locale: Locale): string[] {
  switch (locale) {
    case "en":
      return ["Slow travel", "Local food", "Café culture", "Outdoors", "Night stroll", "Art & museums"];
    case "ja":
      return ["スロー旅", "ご当地グルメ", "カフェ", "自然・アウトドア", "夜散歩", "アート・展覧会"];
    case "ko":
      return ["슬로우 여행", "로컬 맛집", "카페", "자연·야외", "야간 산책", "예술·전시"];
    default:
      return ["慢旅行", "在地美食", "文青咖啡", "自然戶外", "夜景散步", "藝術展覽"];
  }
}

export function getPlanMoodOptions(locale: Locale): string[] {
  switch (locale) {
    case "en":
      return ["Need a break", "Solo time", "Rainy day", "Late-night walk", "Coffee hunt", "By the sea"];
    case "ja":
      return ["のんびり", "ひとり", "雨の日", "深夜散歩", "カフェ探し", "海"];
    case "ko":
      return ["쉬고 싶어", "혼자", "비 오는 날", "심야 산책", "카페", "바다"];
    default:
      return ["想放空", "一個人", "下雨天", "深夜散步", "找咖啡", "看海"];
  }
}
