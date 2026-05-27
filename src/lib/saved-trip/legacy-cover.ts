/** 舊版情境圖（溫泉等）不應作為行程封面 */
export function isLegacySceneCoverUrl(url: string | null | undefined): boolean {
  if (!url?.trim()) return false;
  const u = url.trim();
  return /scene-onsen|scene-cafe|\/assets\/scene-/i.test(u);
}
