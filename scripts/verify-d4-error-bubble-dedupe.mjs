/**
 * D4 — send() state-machine catch branch: the recovery setMsgs updater dedupes the user bubble
 * by comparing the last user message content. Since bubbles are committed as displayMessage,
 * the comparison must use displayMessage; comparing against trimmed (the zh routing payload of a
 * chip) appends a second user bubble in en / ja / ko.
 *
 * The updater body is extracted from src/routes/_app.chat.tsx and executed as-is.
 *
 * Run: npx vite-node scripts/verify-d4-error-bubble-dedupe.mjs --config scripts/vite.verify.config.mjs
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const out = console.log.bind(console);
for (const k of ["log", "info", "warn", "debug"]) console[k] = () => {};
let fetchCalls = 0;
globalThis.fetch = async () => { fetchCalls++; throw new Error("NO_NETWORK"); };
const chips = await import(/* @vite-ignore */ "/src/lib/chat-shortcut-chips.ts");

const route = readFileSync("src/routes/_app.chat.tsx", "utf8");
const anchor = route.indexOf("const errorConversation: ChatMsg[] = [...msgs, { role: \"user\", content: displayMessage }];");
assert.ok(anchor > 0, "catch branch anchor");
const start = route.indexOf("setMsgs((prev) => {", anchor);
const end = route.indexOf("\n      });", start);
const body = route.slice(start + "setMsgs(".length, end + "\n      }".length);
const src = body.replace(/ as const/g, "");
// isChatRuntimeCopy / chatRuntimeCopy stubs: recovery copy is a fixed marker.
const make = new Function("trimmed", "displayMessage", "locale", "isChatRuntimeCopy", "chatRuntimeCopy", `return (${src});`);
let failed = false;
const RECOVERY = "__recovery__";
for (const p of chips.CHAT_SHORTCUT_SEND_CHIPS) {
  for (const L of ["zh-TW", "en", "ja", "ko"]) {
    const displayMessage = chips.chatShortcutContract(p, L).displayMessage;
    const updater = make(p, displayMessage, L, (c) => c === RECOVERY, () => RECOVERY);
    // The turn already committed the user bubble (displayMessage) before throwing.
    const prev = [{ role: "assistant", content: "hi" }, { role: "user", content: displayMessage }];
    const next = updater(prev);
    const users = next.filter((m) => m.role === "user").length;
    try {
      assert.equal(users, 1, `${L} ${p}: user bubbles=${users} ${JSON.stringify(next.map((m) => m.content))}`);
      out(`PASS ${L} ${p} → one user bubble`);
    } catch (e) { failed = true; out(`FAIL ${e.message}`); }
  }
}
try { assert.equal(fetchCalls, 0); out("PASS no network"); } catch { failed = true; out("FAIL network"); }
process.exit(failed ? 1 : 0);
