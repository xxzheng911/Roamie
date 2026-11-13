/**
 * English place names that take "the" mid-sentence ("in the Netherlands", "for the French Riviera").
 * Display-only post-processing for en copy; other locales are never touched.
 */
export const EN_NAMES_WITH_ARTICLE: readonly string[] = [
  "United Arab Emirates", "United Kingdom", "United States", "Czech Republic", "French Riviera",
  "Lake District", "Gobi Desert", "Netherlands", "Philippines", "Gold Coast", "Maldives", "Red Sea", "Gobi",
];

const PREPOSITIONS = "in|for|to|around|of|from|at|across|explore|visit|through|note|noted|plan";

// Longest names first so "Gobi Desert" wins over "Gobi".
const ARTICLE_RES: readonly RegExp[] = [...EN_NAMES_WITH_ARTICLE]
  .sort((a, b) => b.length - a.length)
  .map((name) => {
    // Same-line whitespace only: a name starting the next line is a title, not an object.
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/ /g, "[ \\t]+");
    return new RegExp(`\\b(${PREPOSITIONS})([ \\t]+)(${escaped})\\b`, "gi");
  });

/**
 * "in Netherlands" → "in the Netherlands" after in / for / to / around / of / from / at / across /
 * explore / visit / through / note / noted / plan, on the same line. Sentence-initial or title names ("Netherlands · 3-day trip") and names
 * already preceded by "the" are left as they are. Non-en text is returned unchanged.
 */
export function applyEnglishPlaceArticles(text: string, locale: string | undefined): string {
  if (locale !== "en" || !text) return text;
  let out = text;
  for (const re of ARTICLE_RES) {
    out = out.replace(re, (_m, prep: string, space: string, name: string) => `${prep}${space}the ${name}`);
  }
  return out;
}

/** en mid-sentence form of a single shown name (list items such as "Kamakura, the French Riviera"). */
export function englishNameInSentence(shown: string, locale: string): string {
  const name = shown.trim();
  return locale === "en" && EN_NAMES_WITH_ARTICLE.some((n) => n.toLowerCase() === name.toLowerCase())
    ? `the ${name}`
    : shown;
}
