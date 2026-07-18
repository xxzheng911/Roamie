const CN_DAY_MAP: Record<string, number> = {
  一: 1,
  二: 2,
  两: 2,
  兩: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9,
  十: 10,
};

const FULLWIDTH_DIGIT_RE = /[０-９]/g;

function normalizeDurationText(text: string): string {
  return text
    .trim()
    .replace(FULLWIDTH_DIGIT_RE, (ch) =>
      String.fromCharCode(ch.charCodeAt(0) - 0xff10 + 0x30),
    )
    .replace(/\s+/g, "");
}

/**
 * 解析「5 天」「五天」「3日」「大概3天」「5天4夜」「4晚」等天數。
 * 不含裸數字（裸數字須依 pendingQuestion 語境解析）。
 */
export function parseDayCountFromText(text: string): number | undefined {
  const t = normalizeDurationText(text);
  if (!t) return undefined;

  // 5天4夜 / 五天四夜 — prefer day count
  const dayNight = t.match(/(\d+)\s*天\s*\d+\s*夜/);
  if (dayNight) {
    return Math.min(30, Math.max(1, Number.parseInt(dayNight[1]!, 10)));
  }
  const cnDayNight = t.match(/([一二三四五六七八九十两兩])\s*天\s*[一二三四五六七八九十两兩]?\s*夜/);
  if (cnDayNight?.[1] && CN_DAY_MAP[cnDayNight[1]]) {
    return CN_DAY_MAP[cnDayNight[1]];
  }

  // Soft hedges: 大概3天 / 差不多3天 / 三天左右 / 3天吧
  const digit = t.match(/(?:大概|差不多|約|大约)?(\d+)\s*(?:天|日|晚)(?:左右|吧)?/);
  if (digit) {
    return Math.min(30, Math.max(1, Number.parseInt(digit[1]!, 10)));
  }

  const cn = t.match(
    /(?:大概|差不多|約|大约)?([一二三四五六七八九十两兩])\s*(?:天|日|晚)(?:左右|吧)?/,
  );
  if (cn?.[1]) {
    const n = CN_DAY_MAP[cn[1]];
    if (n) return n;
  }

  return undefined;
}
