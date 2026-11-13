/**
 * D4 — does tapping a chip in en / ja / ko show the zh routing payload in the user bubble?
 *
 *  1. Every chip payload the chat can render (shortcut chips + actionChips 生成行程 / 再推薦一些 /
 *     重新生成 / 幫我生成) maps to a localized displayMessage (en/ko no Han, ja ≠ payload).
 *  2. ChatComposer renders chatShortcutLabel(label) and calls onChipSend(label); _app.chat.tsx wires
 *     onChipSend → send(s, { source: "chat_shortcut" }) and send() derives displayMessage via
 *     chatShortcutContract for chat_shortcut / auto / home_mood.
 *  3. Inside send(), every user bubble uses displayMessage except the rejectNumericSelection branch,
 *     which only runs for /^\d+[.、)]?$/ text — chatShortcutLabel returns such text unchanged, so the
 *     bubble is identical to displayMessage (the native-qa L61 regex is stricter than the behaviour).
 *
 * Run: npx vite-node scripts/verify-d4-chip-display-message.mjs --config scripts/vite.verify.config.mjs
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const out = console.log.bind(console);
for (const k of ["log", "info", "warn", "debug"]) console[k] = () => {};
const watchdog = setTimeout(() => { out("FAIL watchdog"); process.exit(3); }, 120_000);
watchdog.unref();
let fetchCalls = 0;
globalThis.fetch = async () => { fetchCalls++; throw new Error("NO_NETWORK"); };

const chips = await import(/* @vite-ignore */ "/src/lib/chat-shortcut-chips.ts");
const { isNumericSelection } = await import(/* @vite-ignore */ "/src/lib/ai/numeric-selection-authority.ts");
const HAN = /\p{Script=Han}/u;
const failures = [];
function check(name, fn) { try { fn(); out(`PASS ${name}`); } catch (e) { failures.push(name); out(`FAIL ${name}\n  ${String(e?.message ?? e).split("\n").join("\n  ")}`); } }

const route = readFileSync("src/routes/_app.chat.tsx", "utf8");
const composer = readFileSync("src/components/chat/ChatComposer.tsx", "utf8");
// actionChips literal payloads pushed in _app.chat.tsx
const actionBlock = route.slice(route.indexOf("const actionChips = useMemo("), route.indexOf("}, [", route.indexOf("const actionChips = useMemo(")));
// Literal payloads only (chatRuntimeCopy(...) chips are already localized copy).
const actionPayloads = [...new Set([...actionBlock.matchAll(/chips\.push\(\s*("[^"]+"(?:\s*,\s*"[^"]+")*)\s*\)/g)].flatMap((m) => [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1])))];

check(`actionChips payloads found in _app.chat.tsx: ${JSON.stringify(actionPayloads)}`, () => {
  assert.deepEqual([...actionPayloads].sort(), ["再推薦一些", "幫我生成", "生成行程", "重新生成"].sort());
});
const ALL = [...chips.CHAT_SHORTCUT_SEND_CHIPS, chips.CHAT_SHORTCUT_PLAN_LABEL, ...actionPayloads];
const samples = [];
check("every chip payload → localized displayMessage in en / ja / ko (en/ko no Han, ja ≠ zh payload)", () => {
  const bad = [];
  for (const p of ALL) {
    for (const L of ["en", "ja", "ko"]) {
      const d = chips.chatShortcutContract(p, L).displayMessage;
      samples.push(`${L} ${p} → ${d}`);
      if (d === p) bad.push(`${L} ${p}: unchanged`);
      if ((L === "en" || L === "ko") && HAN.test(d)) bad.push(`${L} ${p}: Han ${d}`);
      if (chips.chatShortcutLabel(p, L) !== d) bad.push(`${L} ${p}: label ≠ displayMessage`);
    }
    if (chips.chatShortcutContract(p, "zh-TW").displayMessage !== p) bad.push(`zh-TW ${p} changed`);
  }
  assert.deepEqual(bad, []);
});
check("ChatComposer shows chatShortcutLabel(label) and sends the raw label; route sends it as chat_shortcut", () => {
  assert.match(composer, /onClick=\{\(\) => onChipSend\(label\)\}/);
  assert.match(composer, /\{chatShortcutLabel\(label, locale\)\}/);
  assert.match(route, /onChipSend=\{\(s\) => void send\(s, \{ source: "chat_shortcut"/);
});
const sendStart = route.indexOf("  const send = async (");
const send = route.slice(sendStart, route.indexOf("\n  };", sendStart));
check("send(): displayMessage = chatShortcutContract(trimmed, locale).displayMessage for chat_shortcut / auto / home_mood", () => {
  assert.match(send, /const displayMessage = \(opts\?\.source === "chat_shortcut" \|\| opts\?\.source === "auto" \|\| opts\?\.source === "home_mood"\)\s*\? chatShortcutContract\(trimmed, locale\)\.displayMessage\s*: trimmed;/);
});
const TRIMMED_BUBBLE = /\{\s*role: ?["']user["'], ?content: ?trimmed\s*\}/g;
const trimmedHits = [...send.matchAll(TRIMMED_BUBBLE)].map((m) => ({
  line: route.slice(0, sendStart + m.index).split("\n").length,
  before: send.slice(Math.max(0, m.index - 260), m.index),
}));
out(`  user bubbles with content: trimmed in send(): ${JSON.stringify(trimmedHits.map((h) => h.line))}`);
check("send(): rejectNumericSelection bubble uses content: displayMessage (routing still uses trimmed)", () => {
  assert.match(send, /if \(rejectNumericSelection\(session, trimmed\)\) \{\s*const conversation: ChatMsg\[\] = \[\.\.\.msgsRef\.current,\s*\{\s*role: ?"user", ?content: ?displayMessage\s*\}/);
});
check("send(): rejectNumericSelection numeric input → displayMessage === trimmed for every source / locale", () => {
  const bad = [];
  for (const n of ["1", "2", "3.", "2、", "4)", "12"]) {
    assert.equal(isNumericSelection(n), true, n);
    for (const L of ["zh-TW", "en", "ja", "ko"]) {
      // user source: displayMessage = trimmed; chat_shortcut/auto/home_mood: chatShortcutContract
      if (chips.chatShortcutContract(n, L).displayMessage !== n) bad.push(`${L} ${n}`);
    }
  }
  assert.deepEqual(bad, []);
});
check("send(): date_confirmation branch commits content: displayMessage; consume still uses trimmed", () => {
  assert.match(send, /session\.pendingQuestion\?\.type === "date_confirmation" && turnSwitch\.state === "NO_SWITCH"\) \{\s*const conversation: ChatMsg\[\] = \[\.\.\.msgsRef\.current, ?\{role: ?"user", ?content: ?displayMessage\}\];[\s\S]{0,200}consumeTripDateConfirmation\(session, trimmed\)/);
});
check("send(): no user bubble uses content: trimmed anywhere in send()", () => {
  assert.deepEqual(trimmedHits.map((h) => h.line), []);
});
check("whole route: every user bubble is displayMessage, the localized place line, or the commit helper param; helper callers pass displayMessage", () => {
  const USER = /role\s*:\s*["']user["'](?:\s+as const)?\s*,\s*content\s*:\s*([A-Za-z_$][\w$]*)/g;
  const sources = [...route.matchAll(USER)].map((m) => ({ v: m[1], line: route.slice(0, m.index).split("\n").length }));
  const unexpected = sources.filter((s) => !["displayMessage", "userLine", "trimmed"].includes(s.v));
  assert.deepEqual(unexpected, []);
  const trimmedOutsideHelper = sources.filter((s) => s.v === "trimmed").filter((s) => {
    const helperAt = route.indexOf("const commitUserMessageWithDiscoveringLoading = useCallback(");
    const helperLine = route.slice(0, helperAt).split("\n").length;
    return s.line < helperLine || s.line > helperLine + 8;
  });
  assert.deepEqual(trimmedOutsideHelper, [], "content: trimmed only allowed as the helper's own parameter");
  const calls = [...route.matchAll(/commitUserMessageWithDiscoveringLoading\(([^,)]+),/g)].map((m) => m[1].trim());
  assert.ok(calls.length >= 1, "helper has call sites");
  assert.deepEqual(calls.filter((c) => c !== "displayMessage"), [], `helper call args: ${JSON.stringify(calls)}`);
  // handleDiscussPlace userLine: zh-TW literal, other locales chatRuntimeCopy("placeDetailUserLine")
  assert.match(route, /const userLine =\s*locale === "zh-TW"\s*\? `想聊聊 \$\{placeDisplayName\(item\)\}`\s*: chatRuntimeCopy\("placeDetailUserLine", locale/);
});
// Bug probe: the date_confirmation branch commits `trimmed` (the zh routing payload of a chip).
const tdc = await import(/* @vite-ignore */ "/src/lib/ai/trip-date-confirmation.ts");
const tpc = await import(/* @vite-ignore */ "/src/lib/ai/trip-planning-context.ts");
const pendingDate = {
  workspaceId: "w", conversationId: "c", planningSessionId: "p", tripDays: 3,
  travelContext: { interests: [], destination: "東京", days: 3 },
  pendingQuestion: { type: "date_confirmation", options: [], dateConfirmation: { continuation: { entry: "recommendation" }, workspaceId: "w", conversationId: "c", planningSessionId: "p" } },
};
check("date_confirmation pending + shortcut chip tap (en/ja/ko): the user bubble must be displayMessage, not the zh payload", () => {
  const branch = trimmedHits.filter((h) => /session\.pendingQuestion\?\.type === "date_confirmation" && turnSwitch\.state === "NO_SWITCH"\) \{\s*const conversation: ChatMsg\[\] = \[\.\.\.msgsRef\.current, $/.test(h.before));
  const reach = chips.CHAT_SHORTCUT_SEND_CHIPS.map((p) => ({
    p, sw: tpc.classifyDestinationSwitchTurn(p).state, repeated: tdc.isRepeatedTripDateConfirmation(pendingDate, p),
    status: tdc.consumeTripDateConfirmation(pendingDate, p).status, en: chips.chatShortcutContract(p, "en").displayMessage,
  }));
  out(`  reachability: ${JSON.stringify(reach)}`);
  const reachable = reach.filter((r) => r.sw === "NO_SWITCH" && !r.repeated);
  // Shown bubble = trimmed (zh payload) on that branch while the en/ja/ko displayMessage differs.
  const leaks = branch.length ? reachable.map((r) => `${r.p} shown instead of "${r.en}" (line ${branch[0].line})`) : [];
  assert.deepEqual(leaks, []);
});
check("numeric selection text is never a chip payload and is shown unchanged (chatShortcutLabel(n) = n)", () => {
  for (const p of ALL) assert.equal(isNumericSelection(p), false, p);
  for (const n of ["1", "2", "3.", "2、", "4)"]) for (const L of ["zh-TW", "en", "ja", "ko"]) assert.equal(chips.chatShortcutContract(n, L).displayMessage, n);
});
check("no network", () => assert.equal(fetchCalls, 0));
if (process.argv.includes("--samples")) for (const s of samples) out(`  ${s}`);
if (failures.length) { out(`FAIL ${failures.length} check(s)`); process.exit(1); }
out("PASS d4 chip displayMessage");
process.exit(0);
