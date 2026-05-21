const KEY = "roamie:recent-recommendations";
const MAX = 40;

export function loadRecentRecommendationNames(): string[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(localStorage.getItem(KEY) || "[]") as string[];
  } catch {
    return [];
  }
}

export function recordRecommendationNames(names: string[]): void {
  if (typeof window === "undefined" || !names.length) return;
  const prev = loadRecentRecommendationNames();
  const merged = [...names, ...prev.filter((n) => !names.includes(n))].slice(0, MAX);
  localStorage.setItem(KEY, JSON.stringify(merged));
}

export function formatRecentForPrompt(names: string[]): string {
  if (!names.length) return "（無近期推薦紀錄）";
  return names.slice(0, 15).join("、");
}
