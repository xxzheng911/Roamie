#!/usr/bin/env node
/**
 * 產生 Supabase Apple OAuth 用的 client secret JWT（最長 6 個月）。
 *
 *   APPLE_KEY_PATH=/path/to/AuthKey_XXXX.p8 node scripts/generate-apple-client-secret.mjs
 *
 * 勿將 .p8 或輸出的 JWT 提交到 git。
 */
import fs from "node:fs";
import crypto from "node:crypto";

const TEAM_ID = process.env.APPLE_TEAM_ID ?? "K88UK4PZ43";
const KEY_ID = process.env.APPLE_KEY_ID ?? "6P5QA2K6TA";
const CLIENT_ID = process.env.APPLE_CLIENT_ID ?? "com.roamie.service";
const KEY_PATH = process.env.APPLE_KEY_PATH;

if (!KEY_PATH) {
  console.error("請設定 APPLE_KEY_PATH 指向 AuthKey_*.p8 檔案");
  process.exit(1);
}

const privateKey = fs.readFileSync(KEY_PATH, "utf8");
const now = Math.floor(Date.now() / 1000);
const exp = now + 15777000; // Apple 上限：iat 起算 6 個月

const header = { alg: "ES256", kid: KEY_ID };
const payload = {
  iss: TEAM_ID,
  iat: now,
  exp,
  aud: "https://appleid.apple.com",
  sub: CLIENT_ID,
};

const b64url = (obj) => Buffer.from(JSON.stringify(obj)).toString("base64url");
const data = `${b64url(header)}.${b64url(payload)}`;
const sig = crypto.sign("sha256", Buffer.from(data), { key: privateKey, dsaEncoding: "ieee-p1363" });
const jwt = `${data}.${sig.toString("base64url")}`;

console.log(jwt);
console.error(`\nValid: ${new Date(now * 1000).toISOString()} → ${new Date(exp * 1000).toISOString()}`);
console.error(`Services ID (Client ID): ${CLIENT_ID}`);
