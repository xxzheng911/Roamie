import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const PLACEHOLDER_KEYS = new Set([
  "sk-xxxxxxx",
  "sk-xxxxxxxxxxxxxxxx",
  "your-openai-api-key",
  "changeme",
]);

function parseDotEnv(content: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    out[key] = val;
  }
  return out;
}

function envFileCandidates(): string[] {
  const cwd = process.cwd();
  return [
    resolve(cwd, ".env"),
    resolve(cwd, ".dev.vars"),
    resolve(cwd, "..", ".env"),
    resolve(cwd, "..", ".dev.vars"),
    resolve(cwd, "../..", ".env"),
    resolve(cwd, "../../..", ".env"),
  ];
}

let cachedFileEnv: Record<string, string> | null | undefined;

function loadFileEnv(): Record<string, string> {
  if (cachedFileEnv !== undefined) return cachedFileEnv ?? {};
  cachedFileEnv = {};
  for (const filePath of envFileCandidates()) {
    if (!existsSync(filePath)) continue;
    try {
      const parsed = parseDotEnv(readFileSync(filePath, "utf8"));
      cachedFileEnv = { ...cachedFileEnv, ...parsed };
    } catch (e) {
      console.warn("[Roamie env] failed to read", filePath, e);
    }
  }
  return cachedFileEnv;
}

export function isPlaceholderSecret(value: string): boolean {
  const v = value.trim().toLowerCase();
  if (PLACEHOLDER_KEYS.has(v)) return true;
  if (v === "sk-xxxxxxx") return true;
  if (/^sk-x{5,}$/i.test(v)) return true;
  return false;
}

export type EnvResolveResult = {
  value: string;
  source: "process.env" | ".env" | ".dev.vars";
};

/** Resolve a server secret: process.env (Cloudflare bindings) then .env / .dev.vars on disk. */
export function resolveServerEnv(name: string): EnvResolveResult | null {
  const fromProcess = process.env[name]?.trim();
  if (fromProcess && !isPlaceholderSecret(fromProcess)) {
    return { value: fromProcess, source: "process.env" };
  }

  const fileEnv = loadFileEnv();
  const fromFile = fileEnv[name]?.trim();
  if (fromFile && !isPlaceholderSecret(fromFile)) {
    const source = existsSync(resolve(process.cwd(), ".dev.vars")) ? ".dev.vars" : ".env";
    return { value: fromFile, source };
  }

  if (fromProcess) {
    console.warn(`[Roamie env] ${name} from process.env looks like a placeholder`);
  }
  return null;
}
