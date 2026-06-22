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

/** 解析「5 天」「五天」等天數 */
export function parseDayCountFromText(text: string): number | undefined {
  const digit = text.match(/(\d+)\s*天/);
  if (digit) {
    return Math.min(30, Math.max(1, Number.parseInt(digit[1], 10)));
  }
  const cn = text.match(/([一二三四五六七八九十两兩])\s*天/);
  if (cn?.[1]) {
    const n = CN_DAY_MAP[cn[1]];
    if (n) return n;
  }
  return undefined;
}
