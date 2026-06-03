/** 從使用者訊息解析必去景點（行程生成時強制納入） */
const MUST_INCLUDE_RULES: { pattern: RegExp; label: string }[] = [
  { pattern: /富士山|富士(?:五湖|急)|河口湖|五合目/, label: "富士山" },
  {
    pattern: /哈利波特(?:影城|工作室|世界)?|Harry\s*Potter|華納.*?哈利|Making of Harry Potter/i,
    label: "哈利波特影城",
  },
  { pattern: /環球影城|ユニバーサル|USJ|Universal\s*Studios/i, label: "環球影城" },
  { pattern: /迪士尼|迪士尼樂園|東京迪士尼/, label: "東京迪士尼" },
  { pattern: /晴空塔|東京スカイツリー|Skytree/i, label: "晴空塔" },
  { pattern: /淺草寺|雷門/, label: "淺草寺" },
];

export function parseMustIncludePlaces(text: string): string[] {
  const t = text.trim();
  if (!t) return [];
  const found: string[] = [];
  for (const { pattern, label } of MUST_INCLUDE_RULES) {
    if (pattern.test(t) && !found.includes(label)) found.push(label);
  }
  return found;
}

export function mergeMustIncludePlaces(
  prev: string[] | undefined,
  fromText?: string[] | undefined,
): string[] {
  return [...new Set([...(prev ?? []), ...(fromText ?? [])])];
}
