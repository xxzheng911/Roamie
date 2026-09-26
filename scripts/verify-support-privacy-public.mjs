import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const supportRoute = readFileSync(new URL("../src/routes/support.tsx", import.meta.url), "utf8");
const privacyRoute = readFileSync(new URL("../src/routes/privacy.tsx", import.meta.url), "utf8");
const publicRoutes = readFileSync(new URL("../src/lib/public-routes.ts", import.meta.url), "utf8");
const loginLegalRoute = readFileSync(
  new URL("../src/routes/login/legal.tsx", import.meta.url),
  "utf8",
);

assert.match(supportRoute, /href=\{LEGAL_PATHS.privacy\}/);
assert.match(supportRoute, /href=\{LEGAL_PATHS.terms\}/);
assert.match(privacyRoute, /createFileRoute\("\/privacy"\)/);
assert.match(privacyRoute, /Roamie 隱私權政策與資料使用說明。/);
assert.match(privacyRoute, /<LegalDocumentPage doc="privacy"/);
const legalDocument = readFileSync(
  new URL("../src/components/LegalDocumentPage.tsx", import.meta.url),
  "utf8",
);
assert.match(legalDocument, /plusPurchase\.privacyContent/);
assert.doesNotMatch(privacyRoute, /Roamie Travel|text-4xl|renderPrivacyContent/);
assert.match(publicRoutes, /path === "\/support"/);
assert.match(publicRoutes, /path === "\/privacy"/);
assert.match(publicRoutes, /path === "\/terms"/);
assert.match(loginLegalRoute, /createFileRoute\("\/login\/legal"\)/);
assert.match(loginLegalRoute, /resolveLegalReturnTarget/);

console.info("[verify-support-privacy-public] PASS");
