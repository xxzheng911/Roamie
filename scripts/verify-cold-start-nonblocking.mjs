import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";

const root = process.cwd();
const profileSource = fs.readFileSync(path.join(root, "src/routes/_app.profile.tsx"), "utf8");
const chatSource = fs.readFileSync(path.join(root, "src/routes/_app.chat.tsx"), "utf8");
const listSource = fs.readFileSync(
  path.join(root, "src/components/chat/ChatMessageList.tsx"),
  "utf8",
);

assert.doesNotMatch(
  profileSource,
  /if \(authLoading\) \{\s*return \([\s\S]{0,240}animate-spin/,
  "profile auth restore must not replace the route with a blocking spinner",
);
assert.doesNotMatch(
  profileSource,
  /if \(userId && loading && !profileSnapshotRef\.current\) \{\s*return/,
  "profile remote hydration must not replace local/default UI",
);
assert.match(
  chatSource,
  /useState<ChatMsg\[\]>\(\(\) => \[\s*\{ role: "assistant", content: t\("chat\.greeting"\) \}/,
  "chat greeting must exist before remote/local history hydration",
);
assert.match(
  listSource,
  /if \(hydrating && msgs\.length === 0\)/,
  "hydration may show a spinner only when there is no locally renderable message",
);

console.log("verify:cold-start-nonblocking passed");
