const STYLE_KEYWORDS = ["文青", "極簡", "韓系", "街頭", "日系", "日式", "美式", "法式", "休閒", "運動風"];

/** 從個人檔案 travelStyle、行程 style、興趣中解析穿搭風格描述 */
export function resolveFashionStyle(opts: {
  travelStyle?: string;
  style?: string;
  interests?: string[];
}): string | undefined {
  const blob = [opts.travelStyle, opts.style, ...(opts.interests ?? [])]
    .filter(Boolean)
    .join(" ");
  if (!blob.trim()) return undefined;
  const found = STYLE_KEYWORDS.filter((k) => blob.includes(k));
  if (found.length) return [...new Set(found)].join("、");
  const trimmed = opts.travelStyle?.trim();
  return trimmed || undefined;
}
