import type { ClientContextBundle } from "@/lib/fetch-context";
import { formatDateRangeLabel } from "@/lib/picker-utils";
import { formatTripLocationLabel } from "@/lib/location/format";
import type { PlanTripFormInput } from "@/lib/plan-trip-handoff";
import type { Locale } from "@/lib/i18n/types";

export function buildPlanTripHandoffOpening(
  form: PlanTripFormInput,
  bundle: ClientContextBundle,
  locale: Locale,
): string {
  const dest = formatTripLocationLabel(form.destination);
  const w = bundle.weather;
  const month = form.startDate ? new Date(`${form.startDate}T12:00:00`).getMonth() + 1 : null;
  const styleSep = locale === "en" ? ", " : "、";
  const styles = form.styles.slice(0, 3).join(styleSep);

  switch (locale) {
    case "en": {
      const seasonHint =
        month === 12
          ? `${dest} in December can feel chilly—layers and a warm coat help at night`
          : month && month >= 6 && month <= 8
            ? `${dest} is usually hot then—stay hydrated`
            : `I'm getting a feel for your ${dest} trip`;
      const weatherBit = w
        ? `Weather looks like ${w.condition}, around ${w.tempC}°C`
        : "I'll keep an eye on weather for your dates";
      const dateBit =
        form.startDate && form.endDate
          ? `You're planning ${formatDateRangeLabel(form.startDate, form.endDate, { withYear: true })} in ${dest}`
          : `You're heading to ${dest}`;
      const styleBit = styles ? `, and I noted you like ${styles}` : "";
      return `${dateBit}${styleBit} ☺️ ${seasonHint}; ${weatherBit}. I'll suggest a few spots worth slotting in—tell me which ones you'd like first.`;
    }
    case "ja": {
      const seasonHint =
        month === 12
          ? `${dest}の12月は肌寒いことが多いので、コートと重ね着があると安心`
          : month && month >= 6 && month <= 8
            ? `${dest}はこの時期暑めなので、水分補給を忘れずに`
            : `${dest}の旅の雰囲気をつかんでいます`;
      const weatherBit = w
        ? `天気はだいたい${w.condition}、約${w.tempC}°Cくらい`
        : "日程に合わせて天気も見ていきますね";
      const dateBit =
        form.startDate && form.endDate
          ? `${formatDateRangeLabel(form.startDate, form.endDate, { withYear: true })}に${dest}へ`
          : `${dest}への旅`;
      const styleBit = styles ? `。好みは${styles}もメモしました` : "";
      return `${dateBit}${styleBit} ☺️ ${seasonHint}；${weatherBit}。まず入れたい場所をいくつか挙げるので、気になるものを教えてください。`;
    }
    case "ko": {
      const seasonHint =
        month === 12
          ? `${dest} 12월은 쌀쌀할 수 있어요—코트와 겹쳐 입기 좋아요`
          : month && month >= 6 && month <= 8
            ? `${dest}는 이 시기 더울 때가 많아요—수분 챙기세요`
            : `${dest} 여행 분위기를 잡아볼게요`;
      const weatherBit = w
        ? `날씨는 ${w.condition}, 약 ${w.tempC}°C 정도예요`
        : "날짜에 맞춰 날씨도 살펴볼게요";
      const dateBit =
        form.startDate && form.endDate
          ? `${formatDateRangeLabel(form.startDate, form.endDate, { withYear: true })}에 ${dest}`
          : `${dest}로 떠나요`;
      const styleBit = styles ? `, ${styles} 취향도 적어뒀어요` : "";
      return `${dateBit}${styleBit} ☺️ ${seasonHint}; ${weatherBit}. 먼저 넣기 좋은 곳 몇 곳 골라볼게요—마음에 드는 곳 알려주세요.`;
    }
    default: {
      const seasonHint =
        month === 12
          ? `${dest} 12 月偏冷，晚上體感溫度會再低一點，大衣跟保暖層會很實用`
          : month && month >= 6 && month <= 8
            ? `${dest} 這段時間通常比較熱，記得補充水分`
            : `我先把 ${dest} 這趟的感覺抓出來了`;
      const weatherBit = w
        ? `現在查到的天氣大概是 ${w.condition}、約 ${w.tempC}°C`
        : "我會依你選的日期幫你留意天氣";
      const dateBit =
        form.startDate && form.endDate
          ? `你打算 ${formatDateRangeLabel(form.startDate, form.endDate, { withYear: true })} 去 ${dest}`
          : `你打算去 ${dest}`;
      const styleBit = form.styles.length ? `，也記下你喜歡 ${styles}` : "";
      return `${dateBit}${styleBit} ☺️ ${seasonHint}；${weatherBit}。我先挑幾個這趟很值得去的地方，你看看有哪幾個想先放進行程？`;
    }
  }
}

/** 「讓 Roamie 替我安排」專屬開場 */
export function buildPlanAiHandoffOpening(
  form: PlanTripFormInput,
  _bundle: ClientContextBundle,
  locale: Locale,
): string {
  const dest = formatTripLocationLabel(form.destination);
  const styleSep = locale === "en" ? ", " : "、";
  const styles = form.styles.slice(0, 4).join(styleSep);
  const days = form.days;
  const mood = form.mood?.trim();

  if (locale === "en") {
    const styleBit = styles ? ` with ${styles}` : "";
    const moodBit = mood ? ` and a ${mood} mood` : "";
    return `Based on your ${days}-day trip to ${dest}${styleBit}${moodBit}, I found a few spots worth checking out. Tell me which ones you like—or ask for more cafes, night views, or a fresh batch.`;
  }
  if (locale === "ja") {
    const styleBit = styles ? `、${styles}` : "";
    const moodBit = mood ? `、${mood}な気分` : "";
    return `${dest}の${days}日${styleBit}${moodBit}に合いそうな場所をいくつか見つけました。気になるものを教えてください。別の候補やカフェ追加もOKです。`;
  }
  if (locale === "ko") {
    const styleBit = styles ? `, ${styles}` : "";
    const moodBit = mood ? `, ${mood} 기분` : "";
    return `${dest} ${days}일 여행${styleBit}${moodBit}에 맞는 곳 몇 군데 골라봤어요. 마음에 드는 곳 알려주세요—다른 후보나 카페 추가도 괜찮아요.`;
  }

  const styleBit = styles ? `、${styles}` : "";
  const moodBit = mood ? `、${mood}的心情` : "";
  return `依照你選擇的${dest}${days}日遊${styleBit}${moodBit}，我幫你找到幾個不錯的地方。看看有哪幾個喜歡—也可以跟我說想換一批、多加咖啡廳或看夜景。`;
}
