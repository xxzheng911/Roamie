import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
const baselinePath = "docs/audits/phase2-reachability.json";
const baseline = fs.existsSync(baselinePath)
  ? JSON.parse(fs.readFileSync(baselinePath, "utf8")).items
  : JSON.parse(fs.readFileSync("docs/audits/ui-chinese-leakage-remaining.json", "utf8"));
const config = ts.readConfigFile("tsconfig.json", ts.sys.readFile);
const options = ts.parseJsonConfigFileContent(config.config, ts.sys, process.cwd()).options;
const trees = new Map(),
  edges = new Map();
function scan(file) {
  if (edges.has(file) || !fs.existsSync(file)) return;
  const ast = ts.createSourceFile(
    file,
    fs.readFileSync(file, "utf8"),
    ts.ScriptTarget.Latest,
    true,
  );
  trees.set(file, ast);
  edges.set(file, []);
  function visit(n) {
    const spec =
      ts.isImportDeclaration(n) || ts.isExportDeclaration(n)
        ? n.moduleSpecifier
        : ts.isCallExpression(n) && n.expression.kind === ts.SyntaxKind.ImportKeyword
          ? n.arguments[0]
          : null;
    if (
      spec &&
      ts.isStringLiteral(spec) &&
      !(ts.isImportDeclaration(n) && n.importClause?.isTypeOnly)
    ) {
      const resolved = ts.resolveModuleName(spec.text, path.resolve(file), options, ts.sys)
        .resolvedModule?.resolvedFileName;
      if (resolved) {
        const child = path.relative(process.cwd(), resolved);
        if (child.startsWith("src/")) {
          edges.get(file).push(child);
          scan(child);
        }
      }
    }
    ts.forEachChild(n, visit);
  }
  visit(ast);
}
scan("src/routeTree.gen.ts");
scan("src/client-entry.ts");
scan("src/router.tsx");
const roots = edges
  .get("src/routeTree.gen.ts")
  .filter(
    (f) =>
      f.startsWith("src/routes/") &&
      !f.includes("/api/") &&
      !/(_app\.developer|\/admin)\.tsx$/.test(f),
  );
roots.push("src/client-entry.ts");
const paths = new Map();
for (const root of roots) {
  const q = [[root]];
  while (q.length) {
    const chain = q.shift(),
      f = chain.at(-1);
    if (paths.has(f)) continue;
    paths.set(f, chain);
    for (const child of edges.get(f) ?? [])
      if (child !== "src/routeTree.gen.ts") q.push([...chain, child]);
  }
}
const verifiedDead = new Set([
  "src/components/CropEditActions.tsx",
  "src/components/MapPlacePreview.tsx",
  "src/components/RoamieSplashScreen.tsx",
  "src/components/TransitLegCard.tsx",
  "src/components/home/HomePlusPersonalization.tsx",
  "src/components/saved/SavedTripDetailView.tsx",
  "src/components/saved/SavedTripStopCard.tsx",
]);
const items = baseline.map((row) => {
  const ast = trees.get(row.file);
  const chain = paths.get(row.file);
  let category = "G",
    reason =
      "Import reachability alone cannot establish whether this value is rendered; requires symbol/callsite review.";
  if (
    /src\/routes\/(admin|_app\.developer)\.tsx$/.test(row.file) ||
    row.file === "src/components/chat/ChatKeyboardDebugOverlay.tsx"
  ) {
    category = "D";
    reason =
      "Dedicated admin/developer route or keyboard diagnostic overlay; not ordinary App copy.";
  } else if (verifiedDead.has(row.file) && !chain) {
    category = "C";
    reason =
      "No router/client import path; exported component has no consumers in src (SavedTripStopCard is referenced only by the also-unused SavedTripDetailView). Verified by repository symbol search.";
  } else if (
    row.file === "src/routes/login.tsx" &&
    ["已重置 onboarding / 首次啟動", "[Dev] 清除本機狀態"].includes(row.text)
  ) {
    category = "D";
    reason = "Login dev reset button is guarded by isDev = import.meta.env.DEV.";
  } else if (
    row.file === "src/routes/_app.settings.tsx" &&
    ["Free / Roamie Plus 測試請至「我」個人頁。", "Developer Mode 已解鎖"].includes(row.text)
  ) {
    category = "D";
    reason =
      "Developer settings section / unlock toast guarded by isDeveloperBuildEnabled or import.meta.env.DEV.";
  } else if (row.file === "src/components/saved/SavedTripItineraryEditor.tsx" && row.text === "尚未設定") {
    category = "E";
    reason = "Verified legacy destination sentinel: remaining occurrences are tripView.destination !== comparisons; the displayed fallback uses productionUi.pb795fc5e67.";
  } else if (!chain) {
    category = "G";
    reason =
      "No ordinary router import path found; verify dynamic/server entrypoints and symbol usage before declaring dead code.";
  } else if (row.classification === "remaining-ui" || row.category === "B") {
    category = "B";
    reason =
      "Router import chain reaches literal JSX/attribute/toast. Treat as production reachable, including conditional/error states, unless separately disproven.";
  }
  if (category === "G" && ast) {
    const matches = [];
    function visit(n) {
      if (
        (ts.isStringLiteral(n) ||
          ts.isNoSubstitutionTemplateLiteral(n) ||
          ts.isTemplateHead(n) ||
          ts.isTemplateMiddle(n) ||
          ts.isTemplateTail(n)) &&
        n.text.trim() === row.text
      )
        matches.push(n);
      ts.forEachChild(n, visit);
    }
    visit(ast);
    if (
      matches.length === 1 ||
      matches.some((n) => ast.getLineAndCharacterOfPosition(n.getStart(ast)).line + 1 === row.line)
    ) {
      const n =
          matches.find(
            (n) => ast.getLineAndCharacterOfPosition(n.getStart(ast)).line + 1 === row.line,
          ) ?? matches[0],
        anc = [];
      for (let p = n.parent; p; p = p.parent) anc.push(p);
      const binding = anc.find((p) => ts.isVariableDeclaration(p))?.name.getText(ast);
      const property = anc.find(p => ts.isPropertyAssignment(p))?.name.getText(ast);
      if ((row.file === "src/lib/ai/country-city-options.ts" && binding === "STRUCTURED_COUNTRY_DESTINATIONS" && property === "summary") || (row.file === "src/lib/ai/destination-travel-profile.ts" && binding === "CURATED_PROFILES" && property === "title")) {
        category = "B";
        reason = `Roamie-generated display field ${binding}.${property}; country/city option reply or combination title exposes it to Chat/planning. Locale in a cache key alone does not translate this source copy.`;
      } else if (row.file === "src/lib/ai/country-city-options.ts" && binding === "STRUCTURED_COUNTRY_DESTINATIONS" && ["name", "country"].includes(property)) {
        category = "F";
        reason = `Factual geographic ${property} in STRUCTURED_COUNTRY_DESTINATIONS; preserve place identity, audit summary separately.`;
      } else if (
        (row.file === "src/lib/ai/destination-alias-resolver.ts" &&
          binding === "DESTINATION_ALIAS_RECORDS") ||
        (row.file === "src/lib/place-localization/latin-zh-transliteration.ts" &&
          binding === "KNOWN_TOKEN_ZH")
      ) {
        category = "F";
        reason = `Literal within verified proper-name table ${binding}; geographic names/aliases are factual identity, not generated recommendation prose.`;
      } else if (anc.some((p) => ts.isTypeNode(p))) {
        category = "E";
        reason = "Type/schema literal, not a rendered value.";
      } else if (
        anc.some(
          (p) =>
            ts.isCallExpression(p) &&
            /^console\.|^devVerbose|^log[A-Z]/.test(p.expression.getText(ast)),
        )
      ) {
        category = "E";
        reason = "Developer diagnostic call argument.";
      } else if (
        anc.some(
          (p) =>
            ts.isCallExpression(p) &&
            /\.(includes|startsWith|endsWith|indexOf|replace|match|test)$/.test(
              p.expression.getText(ast),
            ),
        )
      ) {
        category = "E";
        reason = "Matcher or normalization token; not a display value.";
      } else if (
        ts.isBinaryExpression(n.parent) &&
        ["===", "!=="].includes(n.parent.operatorToken.getText(ast))
      ) {
        category = "E";
        reason = "Comparison operand used for semantic classification.";
      } else if (ts.isPropertyAssignment(n.parent) && n.parent.name === n) {
        category = "E";
        reason = "Object lookup key; not display copy.";
      } else if (
        ts.isPropertyAssignment(n.parent) &&
        ["name", "address", "city", "displayName"].includes(n.parent.name.getText(ast)) &&
        ts.isObjectLiteralExpression(n.parent.parent) &&
        n.parent.parent.properties.some(
          (p) =>
            p.name &&
            ["lat", "lng", "latitude", "longitude", "googlePlaceId"].includes(p.name.getText(ast)),
        )
      ) {
        category = "F";
        reason =
          "Name/address in a place facts record with coordinates or Google place identity; not generated UI copy.";
      } else if (anc.some((p) => ts.isJsxExpression(p) || ts.isJsxAttribute(p))) {
        category = "B";
        reason = "Value rendered inside JSX; reachable via the router import chain.";
      } else if (
        ts.isPropertyAssignment(n.parent) &&
        ["systemPrompt", "system", "searchQuery", "query"].includes(n.parent.name.getText(ast))
      ) {
        category = "E";
        reason = "Internal prompt/search request field, not display text.";
      }
    }
  }
  return { ...row, category, reason, importPath: chain ?? [] };
});
const out = {
  categories: {
    A: "PRODUCTION_REACHABLE_UI",
    B: "CONDITIONAL_PRODUCTION_UI",
    C: "DEAD_OR_UNUSED_UI",
    D: "ADMIN_OR_DEBUG_UI",
    E: "INTERNAL_NON_UI",
    F: "EXTERNAL_OR_USER_CONTENT",
    G: "NEEDS_MANUAL_REVIEW",
  },
  items,
};
fs.writeFileSync(baselinePath, JSON.stringify(out, null, 2) + "\n");
const count = (xs) =>
  Object.fromEntries(
    Object.entries(Object.groupBy(xs, (x) => x.category)).map(([k, v]) => [k, v.length]),
  );
console.log(
  JSON.stringify(
    {
      direct: count(items.filter((x) => x.classification === "remaining-ui")),
      other: count(items.filter((x) => x.classification !== "remaining-ui")),
    },
    null,
    2,
  ),
);
