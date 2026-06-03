/**
 * 規劃新行程 — 旅行風格導向的 Places 搜尋與 AI 約束
 */
export function parsePlanStyleLabels(tripStyles: string | undefined): string[] {
  return (tripStyles ?? "")
    .split(/[、,，/]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function primaryDestinationArea(destination: string): string {
  const trimmed = destination.trim();
  const parts = trimmed.split(/[,，、・]/).map((s) => s.trim()).filter(Boolean);
  return parts[parts.length - 1] || trimmed;
}

/** 風格導向 Google 文字搜尋（優先於一般熱門地標） */
export function buildStyleAwarePlaceSearchQueries(
  destination: string,
  styleLabels: string[],
): string[] {
  const area = primaryDestinationArea(destination);
  const queries: string[] = [];
  const add = (...q: string[]) => {
    for (const s of q) {
      if (s.trim()) queries.push(s.trim());
    }
  };

  for (const label of styleLabels) {
    if (/豪華露營|glamping/i.test(label)) {
      add(
        `${area} glamping`,
        `${area} 豪華露營`,
        `${area} 露營區`,
        `箱根 glamping`,
        `河口湖 グランピング`,
        `山中湖 キャンプ`,
        `${area} 戶外體驗`,
        `${area} 星空`,
      );
    }
    if (/溫泉/i.test(label)) {
      add(
        `${area} 溫泉旅館`,
        `${area} 日歸溫泉`,
        `${area} 泡湯`,
        `箱根 溫泉`,
        `${area} 景觀咖啡`,
      );
    }
    if (/文青/i.test(label)) {
      add(
        `${area} 獨立咖啡`,
        `${area} 書店`,
        `${area} 選物店`,
        `${area} 老宅`,
        `${area} 展覽`,
      );
    }
    if (/親子/i.test(label)) {
      add(
        `${area} 親子景點`,
        `${area} 動物園`,
        `${area} 樂園`,
        `${area} 親子體驗`,
      );
    }
    if (/自然|戶外/i.test(label)) {
      add(
        `${area} 國家公園`,
        `${area} 步道`,
        `${area} 海岸`,
        `${area} 森林`,
      );
    }
    if (/美食|在地美食/i.test(label)) {
      add(`${area} 在地美食`, `${area} 必吃`, `${area} 市場`);
    }
    if (/夜生活/i.test(label)) {
      add(`${area} 夜景`, `${area} 酒吧`, `${area} 夜市`);
    }
    if (/豪華享受|luxury/i.test(label)) {
      add(`${area} 五星飯店`, `${area} 景觀餐廳`, `${area} SPA`);
    }
  }

  return [...new Set(queries)].slice(0, 14);
}

/** 有明確風格時，不套用「淺草寺、澀谷」等泛用熱門地標 */
export function shouldSkipGenericDestinationLandmarks(styleLabels: string[]): boolean {
  if (styleLabels.length === 0) return false;
  return styleLabels.some((l) =>
    /豪華露營|glamping|溫泉|文青|親子|自然|戶外|夜生活|豪華享受|luxury|美食|在地美食/i.test(
      l,
    ),
  );
}

/** 行程 AI system prompt 區塊 */
export function buildTravelStylePriorityPromptBlock(styleLabels: string[]): string {
  if (styleLabels.length === 0) return "";

  const lines = [
    "【旅行風格 — 最高優先級之一】",
    `使用者選擇：${styleLabels.join("、")}`,
    "必須依「目的地 + 旅行風格 + 預算 + 交通 + 天數」共同推算，不可只塞該城市泛用熱門打卡點。",
  ];

  if (styleLabels.some((l) => /豪華露營|glamping/i.test(l))) {
    lines.push(
      "豪華露營：優先 Glamping、露營區、山景住宿、自然景觀、星空與戶外體驗（可含箱根、河口湖、山中湖等近郊）。",
      "禁止為主軸：百貨公司、一般夜市、市區逛街、觀光客打卡排隊景點。",
    );
  }
  if (styleLabels.some((l) => /溫泉/i.test(l))) {
    lines.push(
      "溫泉療癒：優先溫泉飯店、泡湯、慢旅、景觀咖啡、自然景點。",
      "避免以購物中心、鬧區逛街為主軸。",
    );
  }
  if (styleLabels.some((l) => /文青/i.test(l))) {
    lines.push("文青探索：優先咖啡廳、書店、展覽、老宅、選物店。");
  }
  if (styleLabels.some((l) => /親子/i.test(l))) {
    lines.push("親子旅行：優先樂園、動物園、親子景點、體驗活動。");
  }

  lines.push(
    "每個 itinerary 項目的 description 須簡述「為何符合此旅行風格」。",
    "每項須含 placeName、date、time、lat、lng（可從已選地點帶入）；有 googlePlaceId 則保留。",
  );

  return lines.join("\n");
}

export function buildPlanFormContextForAi(form: {
  destinationLabel: string;
  originLabel: string | null;
  startDate: string;
  endDate: string;
  days: number;
  travelers: number;
  budgetMode: string;
  transport: string;
  styles: string[];
}): string {
  const dateLine =
    form.startDate && form.endDate
      ? `${form.startDate}～${form.endDate}（${form.days} 天）`
      : `約 ${form.days} 天（尚未設定具體日期）`;

  return [
    "【規劃新行程表單 — 完整上下文】",
    `目的地：${form.destinationLabel}`,
    form.originLabel ? `出發地：${form.originLabel}` : "",
    `旅行日期：${dateLine}`,
    `旅伴人數：${form.travelers} 人`,
    `預算模式：${form.budgetMode}`,
    `交通方式：${form.transport || "未指定"}`,
    `旅行風格：${form.styles.length ? form.styles.join("、") : "未指定"}`,
    buildTravelStylePriorityPromptBlock(form.styles),
  ]
    .filter(Boolean)
    .join("\n");
}
