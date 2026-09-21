import { translate } from "@/lib/i18n/translate";
import type { Locale } from "@/lib/i18n/types";

/** Saved / trip detail delete confirmation. Buttons reuse the existing Delete and Cancel labels. */
const COPY = {
  "zh-TW": {
    title: "刪除這趟行程？",
    description: "刪除後將無法復原，Roamie 不會再保留這趟旅程。",
  },
  en: {
    title: "Delete this trip?",
    description: "This can't be undone. Roamie will no longer keep this trip.",
  },
  ja: {
    title: "この旅程を削除しますか？",
    description: "削除すると元に戻せません。Roamie にこの旅程は保存されなくなります。",
  },
  ko: {
    title: "이 여행 일정을 삭제할까요?",
    description: "삭제하면 되돌릴 수 없으며 Roamie에 이 여행 일정이 더 이상 저장되지 않습니다.",
  },
} as const satisfies Record<Locale, { title: string; description: string }>;

const CONFIRM_KEY = "productionUi.p3c8f5b363a";
const CANCEL_KEY = "productionUi.p2cd0f3be87";

export function deleteTripDialogLabels(locale: Locale) {
  const copy = COPY[locale];
  return {
    title: copy.title,
    description: copy.description,
    confirmLabel: translate(locale, CONFIRM_KEY),
    cancelLabel: translate(locale, CANCEL_KEY),
  };
}
