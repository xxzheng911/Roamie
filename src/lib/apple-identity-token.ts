/** 將 Capacitor / native bridge 回傳的 identity token 正規為 JWT 字串 */

export type AppleIdentityTokenNormalizeResult =
  | { ok: true; token: string; meta: AppleIdentityTokenMeta }
  | { ok: false; meta: AppleIdentityTokenMeta };

export type AppleIdentityTokenMeta = {
  inputType: string;
  tokenLength: number;
  looksLikeJwt: boolean;
};

export function describeAppleIdentityTokenInput(value: unknown): AppleIdentityTokenMeta {
  const tokenLength =
    typeof value === "string"
      ? value.length
      : value instanceof Uint8Array
        ? value.length
        : 0;
  const str = typeof value === "string" ? value.trim() : "";
  return {
    inputType: value == null ? "null" : typeof value,
    tokenLength,
    looksLikeJwt: str.split(".").length === 3,
  };
}

export function normalizeAppleIdentityToken(
  value: unknown,
): AppleIdentityTokenNormalizeResult {
  const meta = describeAppleIdentityTokenInput(value);

  if (value == null) {
    return { ok: false, meta };
  }

  if (typeof value === "string") {
    const token = value.trim();
    if (!token) return { ok: false, meta: { ...meta, tokenLength: 0, looksLikeJwt: false } };
    return {
      ok: true,
      token,
      meta: {
        inputType: "string",
        tokenLength: token.length,
        looksLikeJwt: token.split(".").length === 3,
      },
    };
  }

  if (value instanceof Uint8Array) {
    const token = utf8FromBytes(value).trim();
    return token
      ? {
          ok: true,
          token,
          meta: {
            inputType: "Uint8Array",
            tokenLength: token.length,
            looksLikeJwt: token.split(".").length === 3,
          },
        }
      : { ok: false, meta: { ...meta, inputType: "Uint8Array" } };
  }

  if (typeof value === "object") {
    const o = value as Record<string, unknown>;
    if (typeof o.identityToken === "string") {
      return normalizeAppleIdentityToken(o.identityToken);
    }
    if (typeof o.token === "string") {
      return normalizeAppleIdentityToken(o.token);
    }
    if (typeof o.value === "string") {
      return normalizeAppleIdentityToken(o.value);
    }
  }

  return { ok: false, meta };
}

function utf8FromBytes(bytes: Uint8Array): string {
  if (typeof TextDecoder !== "undefined") {
    return new TextDecoder().decode(bytes);
  }
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return s;
}
