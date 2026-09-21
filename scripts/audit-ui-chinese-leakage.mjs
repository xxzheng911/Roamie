import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import ts from "typescript";
import { fileURLToPath } from "node:url";

// AST literal inventory: comments and regular expressions are not UI text.
// Uncertain strings stay in the backlog; they are never silently allowlisted.
export function inventoryChineseLiterals() {
  const files = [];
  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(p);
      else if (/\.tsx?$/.test(p)) files.push(p);
    }
  }
  walk("src");
  const rows = [];
  for (const file of files.sort()) {
    const source = fs.readFileSync(file, "utf8");
    const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
    function visit(node) {
      if (
        ts.isStringLiteral(node) ||
        ts.isNoSubstitutionTemplateLiteral(node) ||
        ts.isTemplateHead(node) ||
        ts.isTemplateMiddle(node) ||
        ts.isTemplateTail(node) ||
        ts.isJsxText(node)
      ) {
        const text = node.text.trim();
        if (/\p{Script=Han}/u.test(text)) {
          const ancestors = [];
          for (let p = node.parent; p; p = p.parent) ancestors.push(p);
          let classification = "needs-review",
            reason =
              "May be UI, generated copy, data or a semantic payload; inspect before translation.";
          if (
            file.startsWith("src/lib/i18n/") ||
            file === "src/content/legal-purchase-translations.ts"
          ) {
            classification = "allowed";
            reason =
              "Canonical locale dictionary; zh-TW and Japanese Han characters are intentional.";
          } else if (
            ["src/lib/outfit/generate-trip-outfit.server.ts", "src/lib/outfit/outfit-ai.server.ts"].includes(file) &&
            ancestors.some((p) => ts.isFunctionDeclaration(p) &&
              ["buildTripOutfitSystemPrompt", "buildOutfitSystemPrompt"].includes(p.name?.text))
          ) {
            classification = "allowed";
            reason = "Internal outfit system instruction; aiLanguageInstruction(locale) governs generated output. Not rendered or persisted as display copy.";
          } else if (
            file === "src/lib/chat-shortcut-chips.ts" &&
            [
              "進階手動規劃",
              "今天想放鬆走走",
              "想找安靜的咖啡廳",
              "下雨天可以去哪",
              "生成行程",
              "再推薦一些",
              "重新生成",
              "幫我生成",
            ].includes(text)
          ) {
            classification = "allowed";
            reason =
              "Legacy canonical Chat routing payload; ChatComposer renders chatShortcutLabel(payload, locale), while click sends the unchanged payload. Covered by verify-ui-language-coverage.";
          } else if (
            ancestors.some(
              (p) =>
                ts.isCallExpression(p) &&
                /^(console\.|(?:devVerbose|log[A-Z]|recordAnalytics|trackEvent))/.test(
                  p.expression.getText(ast),
                ),
            )
          ) {
            classification = "allowed";
            reason = "Developer diagnostics or analytics, not rendered UI.";
          } else if (
            ancestors.some(
              (p) =>
                ts.isObjectLiteralExpression(p) &&
                ["en", "ja", "ko"].every((k) =>
                  p.properties.some((x) => x.name?.getText(ast).replace(/["']/g, "") === k),
                ),
            )
          ) {
            classification = "allowed";
            reason = "Explicit multilingual dictionary branch; not unconditional Chinese UI.";
          } else if (
            ancestors.some(
              (p) =>
                ts.isCallExpression(p) &&
                ts.isPropertyAccessExpression(p.expression) &&
                ["includes", "startsWith", "endsWith"].includes(p.expression.name.text),
            )
          ) {
            classification = "allowed";
            reason = "Input matching / classification token; not display copy.";
          } else if (
            node.parent?.name === node &&
            (ts.isPropertyAssignment(node.parent) || ts.isPropertySignature(node.parent))
          ) {
            classification = "allowed";
            reason = "Object/schema lookup key; display values are audited separately.";
          } else if (
            file === "src/lib/ai/recommendation-badge-display.ts" &&
            ancestors.some(
              (p) =>
                ts.isArrayLiteralExpression(p) &&
                ts.isPropertyAssignment(p.parent) &&
                ts.isIdentifier(p.parent.name) &&
                p.parent.name.text === "aliases",
            )
          ) {
            classification = "allowed";
            reason =
              "Canonical badge semantic alias for routing normalization. Display is projected by projectRecommendationBadge and chatMoodDisplay; this literal is not rendered. A new displayable semantic still fails verify-recommendation-badge-display when any locale translation is missing.";
          } else if (
            ts.isJsxText(node) ||
            ancestors.some(
              (p) =>
                ts.isJsxAttribute(p) ||
                (ts.isCallExpression(p) && /^toast\./.test(p.expression.getText(ast))),
            )
          ) {
            classification = "remaining-ui";
            reason = "Literal rendered text, JSX attribute or toast needs canonical translation.";
          }
          const line = ast.getLineAndCharacterOfPosition(node.getStart(ast)).line + 1;
          const id = crypto
            .createHash("sha256")
            .update(file + "\0" + ts.SyntaxKind[node.kind] + "\0" + text)
            .digest("hex")
            .slice(0, 20);
          rows.push({
            id,
            file,
            line,
            kind: ts.SyntaxKind[node.kind],
            text,
            classification,
            reason,
          });
        }
      }
      ts.forEachChild(node, visit);
    }
    visit(ast);
  }
  return rows;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const rows = inventoryChineseLiterals();
  fs.mkdirSync("docs/audits", { recursive: true });
  const pending = rows.filter((r) => r.classification !== "allowed");
  const allowed = rows.filter((r) => r.classification === "allowed");
  fs.writeFileSync(
    "docs/audits/ui-chinese-leakage-remaining.json",
    JSON.stringify(pending, null, 2) + "\n",
  );
  fs.writeFileSync(
    "docs/audits/ui-chinese-leakage-allowlist.json",
    JSON.stringify(allowed, null, 2) + "\n",
  );
  const counts = Object.groupBy(rows, (r) => r.classification);
  console.log(Object.fromEntries(Object.entries(counts).map(([k, v]) => [k, v.length])));
}
