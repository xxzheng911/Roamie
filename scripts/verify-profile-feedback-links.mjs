import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { I18nProvider } from "../src/hooks/use-i18n.tsx";
import { translate } from "../src/lib/i18n/translate.ts";
import {
  ProfileFeedbackLinks,
  ROAMIE_FEEDBACK_FORM_URL,
  ROAMIE_INSTAGRAM_URL,
} from "../src/components/profile/ProfileFeedbackLinks.tsx";
import { openExternalUrl } from "../src/lib/open-external-url.ts";

globalThis.React = React;
const originalFetch = globalThis.fetch;
let requests = 0;
globalThis.fetch = async () => {
  requests++;
  throw new Error("No network allowed");
};
const pass = (name) => console.log("PASS", name);

try {
  // 1. Four locales, no emoji.
  const expected = { "zh-TW": "意見回饋", en: "Feedback", ja: "フィードバック", ko: "의견 보내기" };
  for (const [locale, label] of Object.entries(expected)) {
    assert.equal(translate(locale, "profile.feedback"), label);
    const aria = translate(locale, "profile.instagram");
    assert.ok(aria && aria !== "profile.instagram", `${locale} instagram aria-label`);
    assert.doesNotMatch(label + aria, /\p{Extended_Pictographic}/u);
  }
  pass("four-locale feedback copy and Instagram aria-label, no emoji");

  // 2–3. Responder form (never /edit) and official Instagram, both safe external anchors.
  assert.match(ROAMIE_FEEDBACK_FORM_URL, /^https:\/\/docs\.google\.com\/forms\/d\/e\/[\w-]+\/viewform$/);
  assert.doesNotMatch(ROAMIE_FEEDBACK_FORM_URL, /\/edit\b/);
  assert.equal(ROAMIE_INSTAGRAM_URL, "https://www.instagram.com/roamie.tw/");
  const html = renderToStaticMarkup(createElement(I18nProvider, null, createElement(ProfileFeedbackLinks)));
  const anchors = [...html.matchAll(/<a [^>]*>/g)].map((m) => m[0]);
  assert.equal(anchors.length, 2, "two independent tap targets");
  for (const a of anchors) {
    assert.match(a, /target="_blank"/);
    assert.match(a, /rel="noopener noreferrer"/);
    assert.match(a, /min-h-11/, "44pt touch target");
    assert.doesNotMatch(a, /bg-|rounded-full|border/, "plain text, no button/card chrome");
  }
  assert.match(anchors[0], new RegExp(`href="${ROAMIE_FEEDBACK_FORM_URL.replace(/[.?/]/g, "\\$&")}"`));
  assert.match(anchors[1], /href="https:\/\/www\.instagram\.com\/roamie\.tw\/"/);
  assert.match(anchors[1], /aria-label="[^"]+"/);
  assert.match(html, /justify-center/, "horizontally centered");
  assert.match(html, /text-muted-foreground/, "neutral secondary color");
  assert.match(html, /lucide-instagram/, "existing icon library");
  pass("responder URL, Instagram URL, separate safe anchors, layout classes");

  // Web path of the shared external-link authority opens a new browsing context only.
  const opened = [];
  globalThis.window = { open: (...args) => (opened.push(args), {}) };
  assert.equal(await openExternalUrl(ROAMIE_FEEDBACK_FORM_URL), true);
  assert.equal(await openExternalUrl(ROAMIE_INSTAGRAM_URL), true);
  assert.deepEqual(opened, [
    [ROAMIE_FEEDBACK_FORM_URL, "_blank", "noopener,noreferrer"],
    [ROAMIE_INSTAGRAM_URL, "_blank", "noopener,noreferrer"],
  ]);
  delete globalThis.window;
  pass("web opens both links via openExternalUrl with noopener,noreferrer");

  // 4–6. Guest + signed-in placement: below sign-out, outside the auth conditional, no auth gate.
  const profile = readFileSync(new URL("../src/routes/_app.profile.tsx", import.meta.url), "utf8");
  const signOutEnd = profile.indexOf('{t("settings.signOutAccount")}');
  const linksAt = profile.indexOf("<ProfileFeedbackLinks />");
  assert.ok(signOutEnd > 0 && linksAt > signOutEnd, "rendered below sign-out");
  assert.match(profile.slice(signOutEnd, linksAt), /<\/button>\s*\) : null}\s*$/, "outside {user ? … : null}");
  assert.equal(profile.match(/<ProfileFeedbackLinks \/>/g).length, 1);
  const component = readFileSync(new URL("../src/components/profile/ProfileFeedbackLinks.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(component, /useAuth|requireAccount|AuthDialog|signOut|supabase/i, "no auth dependency");
  pass("guest and signed-in: below sign-out, no new sign-out, no auth gate");

  assert.equal(requests, 0);
  pass("zero network requests");
} finally {
  globalThis.fetch = originalFetch;
}
