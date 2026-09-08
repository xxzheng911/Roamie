#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  claimChatAutoScrollTarget,
  resolveChatShortcutRenderBranch,
  stableChatMessageKey,
} from "../src/lib/chat-render-stability.ts";

const loadingMessage = { role: "assistant", content: "整理推薦中" };
const recommendationMessage = {
  ...loadingMessage,
  roamie: { recommendations: [{ name: "公園" }] },
};

assert.equal(stableChatMessageKey(loadingMessage, 2), "assistant:2");
assert.equal(
  stableChatMessageKey(recommendationMessage, 2),
  stableChatMessageKey(loadingMessage, 2),
  "recommendation count must not change message/group identity",
);

assert.equal(
  resolveChatShortcutRenderBranch({
    hydrating: false,
    messageCount: 2,
    loading: true,
    recommendationLoading: true,
    recommendationCount: 0,
  }),
  "loading",
);
assert.equal(
  resolveChatShortcutRenderBranch({
    hydrating: false,
    messageCount: 3,
    loading: false,
    recommendationLoading: false,
    recommendationCount: 1,
  }),
  "recommendations",
  "result completion transitions directly to recommendations",
);

assert.equal(claimChatAutoScrollTarget("", "assistant:2:recommendations"), true);
assert.equal(
  claimChatAutoScrollTarget("assistant:2:recommendations", "assistant:2:recommendations"),
  false,
  "one recommendation group only claims auto-scroll once",
);
assert.equal(
  claimChatAutoScrollTarget("assistant:2:recommendations", "assistant:4:recommendations"),
  true,
  "continuation group can claim its own scroll",
);

const listSource = readFileSync("src/components/chat/ChatMessageList.tsx", "utf8");
assert.match(listSource, /stableChatMessageKey\(m, i\)/);
assert.doesNotMatch(listSource, /key=.*recCount/);
assert.match(listSource, /reason: "recommendations_ready"/);

const layoutSource = readFileSync("src/hooks/use-messenger-chat-layout.ts", "utf8");
assert.doesNotMatch(layoutSource, /setTimeout\(\(\) => \{\s*performScroll\(\)/);
assert.match(layoutSource, /\[CHAT_AUTOSCROLL\]/);

const cardSource = readFileSync("src/components/RoamieResponseView.tsx", "utf8");
assert.match(cardSource, /aspect-\[16\/10\] min-h-\[7\.5rem\]/);
assert.match(cardSource, /min-h-\[12rem\]/);

const chatSource = readFileSync("src/routes/_app.chat.tsx", "utf8");
assert.match(chatSource, /\[CHAT_SHORTCUT_RENDER_STATE\]/);
assert.match(chatSource, /claimChatAutoScrollTarget/);
assert.match(chatSource, /RT_CONTINUATION_RESULT/);

console.log("[verify:chat-shortcut-render-stability] OK");
