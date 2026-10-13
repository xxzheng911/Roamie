#!/usr/bin/env node
// PreToolUse guard for the /dispatch workflow.
// - Every session (main + all subagents): blocks git commands that can discard
//   uncommitted work, and isolated agents/worktrees (they start from a clean
//   checkout and miss uncommitted changes).
// - Roamie role subagents (frontend/backend/tester/ops, identified by the hook
//   input's `agent_type`): Bash is limited to an allowlist of read/check
//   commands, and file writes are limited per role.
// Blocks by printing a reason to stderr and exiting 2. Anything it cannot
// parse confidently is blocked rather than allowed.
import { readFileSync, existsSync, realpathSync } from "node:fs";
import { resolve, relative, isAbsolute, dirname, basename, sep } from "node:path";

const ROLES = new Set(["frontend", "backend", "tester", "ops"]);

function block(reason) {
  process.stderr.write(`[role-guard] ${reason}\n`);
  process.exit(2);
}

let input;
try {
  input = JSON.parse(readFileSync(0, "utf8"));
} catch {
  // Cannot tell who is calling; do not guess.
  block("無法解析 hook 輸入，為安全起見拒絕此工具呼叫。");
}

const tool = input.tool_name ?? "";
const ti = input.tool_input ?? {};
const role = typeof input.agent_type === "string" ? input.agent_type : "";
const isRole = ROLES.has(role);
const root = canonical(resolve(process.env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd()));

// ---------- shared: isolated copies ----------
if (tool === "EnterWorktree") {
  block("禁止建立 worktree：worktree 從乾淨的分支建立，會看不到未提交的 V2 修改。");
}
if ((tool === "Agent" || tool === "Task") && ti.isolation) {
  block(`禁止以 isolation: ${ti.isolation} 派工：隔離副本看不到未提交的 V2 修改。請改為依序在主工作區派工。`);
}

// ---------- Bash ----------
if (tool === "Bash") {
  const cmd = String(ti.command ?? "");
  const destructive = destructiveGit(cmd);
  if (destructive) block(destructive);
  if (isRole) {
    const why = bashNotAllowed(cmd, role);
    if (why) block(`${role} 不可執行此指令：${why}`);
  }
  process.exit(0);
}

// ---------- file writes ----------
const WRITE_TOOLS = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit"]);
if (WRITE_TOOLS.has(tool) && isRole) {
  const raw = ti.file_path ?? ti.notebook_path ?? "";
  if (!raw) block("無法判斷寫入路徑。");
  const abs = canonical(resolve(input.cwd || root, String(raw)));
  const why = writeNotAllowed(abs, role);
  if (why) block(`${role} 不可寫入 ${raw}：${why}`);
}
process.exit(0);

// =====================================================================

// Resolve symlinks (and on macOS the on-disk letter case) for the deepest
// existing ancestor, so a link or a differently-cased path cannot point a
// write somewhere the rules would refuse.
function canonical(p) {
  let head = p;
  const tail = [];
  while (!existsSync(head)) {
    const parent = dirname(head);
    if (parent === head) return p;
    tail.unshift(basename(head));
    head = parent;
  }
  try {
    return resolve(realpathSync.native(head), ...tail);
  } catch {
    return p;
  }
}

function destructiveGit(cmd) {
  for (const seg of splitSegments(cmd)) {
    const t = tokens(seg).filter((x, i, a) => !(i < a.indexOf("git") && /^[A-Za-z_][A-Za-z0-9_]*=/.test(x)));
    const gi = t.indexOf("git");
    if (gi === -1) continue;
    // skip global options like `git -C dir`
    let i = gi + 1;
    while (i < t.length && t[i].startsWith("-")) i += t[i] === "-C" || t[i] === "-c" ? 2 : 1;
    const sub = t[i];
    const args = t.slice(i + 1);
    const has = (...f) => args.some((a) => f.includes(a));
    if (sub === "reset" && has("--hard", "--merge", "--keep")) return "禁止 git reset --hard：會覆蓋未提交的修改。";
    if (sub === "clean") return "禁止 git clean：會刪除未追蹤的檔案。";
    if (sub === "stash" && !["list", "show"].includes(args[0])) return "禁止 git stash：保留未提交修改原樣。";
    if (sub === "checkout" && (has("--", ".", "-f", "--force") || args.some((a) => a.startsWith("--theirs") || a.startsWith("--ours"))))
      return "禁止以 git checkout 覆蓋檔案。";
    if (sub === "restore" && !(has("--staged", "-S") && !has("--worktree", "-W"))) return "禁止 git restore 覆蓋工作區檔案。";
    if (sub === "switch" && has("--discard-changes", "-f", "--force")) return "禁止丟棄修改的 git switch。";
    if (sub === "worktree" && args[0] === "add") return "禁止建立 worktree：會遺漏未提交的 V2 修改。";
  }
  return null;
}

function bashNotAllowed(cmd, role) {
  if (/`|\$\(|<\(|>\(|\$'|\$"/.test(cmd)) return "不允許命令替換或 $'…' 引號。";
  for (const rawSeg of splitSegments(cmd)) {
    // Only redirects to /dev/null or between descriptors are allowed. Escaped
    // characters and quoted text are neutralised first so `\"` cannot hide a
    // real redirect inside what looks like a string.
    const seg = rawSeg
      .replace(/\\./gs, "__")
      .replace(/"[^"]*"|'[^']*'/g, '""')
      .replace(/\d?>&\d/g, " ")
      .replace(/&>\s*\/dev\/null/g, " ")
      .replace(/\d?>>?\s*\/dev\/null/g, " ");
    if (/[<>]/.test(seg)) return "不允許檔案重新導向（> 或 <）。";
    const t = tokens(rawSeg);
    if (!t.length) continue;
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(t[0])) return "不允許在指令前設定環境變數。";
    const why = commandNotAllowed(t, role);
    if (why) return why;
  }
  return null;
}

function commandNotAllowed(t, role) {
  const [c, ...a] = t;
  const READ = new Set(["cat", "head", "tail", "wc", "ls", "pwd", "grep", "cut", "diff", "echo", "stat", "which", "true", "cd", "test", "[", "basename", "dirname", "realpath", "tr", "jq"]);
  if (READ.has(c)) return null;
  if (c === "rg") return a.some((x) => x === "--pre" || x.startsWith("--pre=")) ? "rg --pre 會執行外部程式。" : null;
  if (c === "sort") return a.some((x) => x === "-o" || x.startsWith("--output") || /^-[a-zA-Z]*o/.test(x)) ? "sort -o 會寫檔。" : null;
  if (c === "find") {
    const bad = ["-delete", "-exec", "-execdir", "-ok", "-okdir", "-fprint", "-fprint0", "-fprintf", "-fls"];
    return a.some((x) => bad.includes(x)) ? "find 不允許 -delete／-exec／-fprint。" : null;
  }
  if (c === "git") {
    if (a.some((x) => x === "-c" || x.startsWith("--config-env") || x.startsWith("--exec-path"))) return "git -c 可改變執行行為，不允許。";
    if (a.some((x) => x.startsWith("--output") || x === "-O" || x.startsWith("--open-files-in-pager") || x.startsWith("--ext-diff")))
      return "git 輸出到檔案或外部程式的選項不允許。";
    const sub = a.find((x, i) => !x.startsWith("-") && a[i - 1] !== "-C");
    const ok = ["status", "diff", "log", "show", "ls-files", "rev-parse", "blame", "grep", "merge-base", "cat-file", "describe"];
    if (ok.includes(sub)) return null;
    if (sub === "branch" && a.every((x) => x === "branch" || ["-a", "-r", "--list", "--show-current", "-v", "-vv"].includes(x))) return null;
    return `git ${sub ?? ""} 不在允許清單（僅限唯讀 git 指令）。`;
  }
  // flags that make otherwise read-only tools write files
  const WRITES = (x) => x.startsWith("--fix") || x === "-u" || x === "--update" || x.startsWith("--output") || x.startsWith("--outputFile") || x === "--write" || x.startsWith("--generateTrace") || x === "-o";
  if (c === "npm") {
    if (a.some(WRITES)) return "不允許會寫檔的參數（--fix、-u、--output 等）。";
    if (a[0] === "test" || a[0] === "ls") return null;
    if (a[0] === "run") {
      const s = a[1] ?? "";
      if (s === "build" || s === "build:dev") return role === "tester" ? "build 由 ops 執行。" : null;
      if (/^(test|lint|typecheck|verify|check|release[-:]guard|guard)(:|$)/.test(s)) return null;
    }
    return `npm ${a.join(" ")} 不在允許清單。`;
  }
  if (c === "npx") {
    if (a.some(WRITES)) return "不允許會寫檔的參數（--fix、-u、--output 等）。";
    const [bin, ...rest] = a;
    if (bin === "tsc" && rest.includes("--noEmit") && !rest.some((x) => x === "-b" || x === "--build" || x === "--watch" || x === "-w")) return null;
    if (bin === "vitest" && rest[0] === "run") return null;
    if (bin === "eslint") return null;
    if (bin === "prettier" && (rest.includes("--check") || rest.includes("-c")) && !rest.includes("-w")) return null;
    if (bin === "vite-node" && isCheckScript(rest[0])) return null;
    return `npx ${a.join(" ")} 不在允許清單。`;
  }
  if (c === "node") {
    const rest = a[0] === "--experimental-strip-types" ? a.slice(1) : a;
    if (isCheckScript(rest[0])) return null;
    return "node 只允許直接執行 scripts/verify-*／check-*／release-guard 腳本，不可加載入參數。";
  }
  return `「${c}」不在允許清單。`;
}

function isCheckScript(s) {
  return /^(\.\/)?scripts\/(verify|check|release-guard|supabase-env-check)[\w.-]*\.m?js$/.test(s ?? "");
}

function writeNotAllowed(abs, role) {
  const rel = relative(root, abs);
  const inRepo = rel && !rel.startsWith("..") && !isAbsolute(rel);
  if (!inRepo) {
    const scratch = input.scratchpad_dir ? canonical(resolve(input.scratchpad_dir)) : null;
    if (scratch && (abs === scratch || abs.startsWith(scratch + sep))) return null;
    return "只能寫入專案內的指定範圍或 scratchpad。";
  }
  const p = rel.split(sep).join("/");
  const lower = p.toLowerCase();
  if (lower.startsWith(".claude/") || lower.startsWith(".git/") || lower === ".git") return "工作流程設定與 git 內部檔案只有使用者能改。";
  if (role === "ops") return "ops 不得修改任何專案檔案。";
  if (role === "tester") {
    const testFile = /\.test\.(ts|tsx|mts)$/.test(p) || /^scripts\/verify-[\w.-]+\.mjs$/.test(p);
    return testFile ? null : "tester 只能建立或修改測試檔（*.test.ts(x)、scripts/verify-*.mjs）。";
  }
  // frontend / backend: only what the dispatcher assigned
  const scope = loadScope()[role];
  if (!Array.isArray(scope) || scope.length === 0) return "指派者尚未在 .claude/dispatch-scope.json 指定你的修改範圍。";
  if (isProtected(p)) {
    return scope.includes(p) ? null : "屬於安全／訂閱／核心邏輯，需指派者在範圍內逐檔列出完整路徑。";
  }
  return scope.some((g) => typeof g === "string" && globToRegExp(g).test(p)) ? null : "不在指派者指定的修改範圍內。";
}

function loadScope() {
  const f = resolve(root, ".claude/dispatch-scope.json");
  if (!existsSync(f)) return {};
  try {
    return JSON.parse(readFileSync(f, "utf8"));
  } catch {
    return {};
  }
}

function isProtected(p) {
  const PROTECTED = [
    "src/lib/access/**", "src/hooks/use-access.tsx", "src/hooks/use-auth.tsx", "src/hooks/use-plus-upgrade.ts",
    "src/providers/SubscriptionProvider.tsx", "src/services/subscription/**", "src/constants/subscription.ts",
    "src/constants/auth*.ts", "src/lib/subscription-*.ts", "src/lib/auth-*.ts", "src/lib/require-auth.ts",
    "src/lib/qa-auth/**", "src/integrations/supabase/**", "src/lib/supabase-auth-storage.ts",
    "src/lib/**/*ranking*.ts",
    "src/lib/google-*.ts", "src/lib/places-api-*.ts",
    "supabase/**", "wrangler.jsonc", "capacitor.config.ts", "scripts/**", "vite.config.ts", "vitest.config.ts",
    "tsconfig.json", "eslint.config.js", "package.json", "package-lock.json", "bun.lock", "bunfig.toml",
    ".env*", ".dev.vars", ".gitignore", "ios/**",
  ];
  // case-insensitive so a differently-cased path cannot slip past on macOS
  return PROTECTED.some((g) => globToRegExp(g, "i").test(p));
}

function globToRegExp(g, flags = "") {
  let re = "";
  for (let i = 0; i < g.length; i++) {
    const ch = g[i];
    if (ch === "*") {
      if (g[i + 1] === "*") {
        re += g[i + 2] === "/" ? "(?:.*/)?" : ".*";
        i += g[i + 2] === "/" ? 2 : 1;
      } else re += "[^/]*";
    } else if (ch === "?") re += "[^/]";
    else re += ch.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${re}$`, flags);
}

// Split on && || ; | & and newlines, outside quotes, honouring backslash
// escapes. `&` that belongs to a redirect (2>&1, &>) stays in the segment.
function splitSegments(cmd) {
  const segs = [];
  let cur = "";
  let q = null;
  const push = () => { if (cur.trim()) segs.push(cur.trim()); cur = ""; };
  for (let i = 0; i < cmd.length; i++) {
    const ch = cmd[i];
    if (ch === "\\" && q !== "'") { cur += ch + (cmd[i + 1] ?? ""); i++; continue; }
    if (q) { cur += ch; if (ch === q) q = null; continue; }
    if (ch === '"' || ch === "'") { q = ch; cur += ch; continue; }
    if ((ch === "&" && cmd[i + 1] === "&") || (ch === "|" && cmd[i + 1] === "|")) { push(); i++; continue; }
    if (ch === ";" || ch === "|" || ch === "\n") { push(); continue; }
    if (ch === "&" && cmd[i - 1] !== ">" && cmd[i + 1] !== ">") { push(); continue; }
    cur += ch;
  }
  push();
  return segs;
}

function tokens(seg) {
  const out = [];
  const re = /"((?:\\.|[^"\\])*)"|'([^']*)'|((?:\\.|[^\s"'])+)/g;
  let m;
  while ((m = re.exec(seg))) out.push(m[1] ?? m[2] ?? m[3]);
  return out;
}
