const PLACEHOLDER_KEYS = new Set([
  "sk-xxxxxxx",
  "sk-xxxxxxxxxxxxxxxx",
  "your-openai-api-key",
  "changeme",
]);

export function isPlaceholderSecret(value: string): boolean {
  const v = value.trim().toLowerCase();
  if (PLACEHOLDER_KEYS.has(v)) return true;
  if (v === "sk-xxxxxxx") return true;
  if (/^sk-x{5,}$/i.test(v)) return true;
  return false;
}

export type EnvResolveResult = {
  value: string;
  source: "process.env" | "import.meta.env";
};

/** Resolve a server secret from process.env only. */
export function resolveServerEnv(name: string): EnvResolveResult | null {
  const fromProcess = process.env[name]?.trim();
  if (fromProcess && !isPlaceholderSecret(fromProcess)) {
    return { value: fromProcess, source: "process.env" };
  }

  const fromImportMeta =
    typeof import.meta !== "undefined" &&
    import.meta.env &&
    typeof import.meta.env[name] === "string"
      ? (import.meta.env[name] as string).trim()
      : "";
  if (fromImportMeta && !isPlaceholderSecret(fromImportMeta)) {
    return { value: fromImportMeta, source: "import.meta.env" };
  }

  if (fromProcess) {
    console.warn(`[Roamie env] ${name} from process.env looks like a placeholder`);
  }
  if (fromImportMeta) {
    console.warn(`[Roamie env] ${name} from import.meta.env looks like a placeholder`);
  }
  return null;
}
