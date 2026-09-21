/**
 * Keyboard bottom-nav hide rules must stay a separate selector list from
 * .plan-budget-grid. Computed-style agreement is not enough: a later cascade
 * can hide a merged selector list, so this checks PostCSS selector structure.
 *
 * Run: node scripts/verify-keyboard-nav-selector.mjs
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import postcss from "postcss";

const css = fs.readFileSync("src/styles.css", "utf8");
const root = postcss.parse(css, { from: "src/styles.css" });
const rules = [];
root.walkRules((rule) => rules.push(rule));

const KEYBOARD_SELECTORS = [
  "html.app-keyboard-open .bottom-nav",
  "html.chat-keyboard-open .bottom-nav",
  "html.chat-keyboard-open .bottom-nav.chat-nav-keyboard-hide",
  "html.plan-keyboard-open .bottom-nav",
];

function sameSelectors(rule, expected) {
  return (
    rule.selectors.length === expected.length &&
    rule.selectors.every((selector, index) => selector === expected[index])
  );
}

function declarations(rule) {
  const out = {};
  rule.walkDecls((decl) => {
    out[decl.prop] = decl.important ? `${decl.value} !important` : decl.value;
  });
  return out;
}

for (const rule of rules) {
  const hasBudget = rule.selectors.some((selector) => selector.trim() === ".plan-budget-grid");
  const hasKeyboardNav = rule.selectors.some((selector) =>
    KEYBOARD_SELECTORS.includes(selector.trim()),
  );
  assert.equal(
    hasBudget && hasKeyboardNav,
    false,
    `.plan-budget-grid shares a selector list with keyboard bottom-nav: ${rule.selector}`,
  );
}

const keyboardRules = rules.filter((rule) =>
  KEYBOARD_SELECTORS.every((selector) => rule.selectors.includes(selector)),
);
assert.equal(keyboardRules.length, 1, "keyboard bottom-nav selectors must share one rule");
assert.ok(
  sameSelectors(keyboardRules[0], KEYBOARD_SELECTORS),
  `keyboard selector list drifted: ${keyboardRules[0].selector}`,
);
const keyboardDecls = declarations(keyboardRules[0]);
assert.equal(keyboardDecls.visibility, "hidden !important");
assert.equal(keyboardDecls.opacity, "0 !important");
assert.equal(keyboardDecls["pointer-events"], "none !important");
assert.equal(keyboardDecls.transform, "none !important");
assert.equal(keyboardDecls.transition, "none !important");
assert.equal(keyboardDecls.display, undefined, "keyboard bottom-nav rule must not set display");

const budgetRules = rules.filter((rule) =>
  rule.selectors.some((selector) => selector.trim() === ".plan-budget-grid"),
);
assert.equal(budgetRules.length, 1, ".plan-budget-grid must have one rule");
assert.deepEqual(budgetRules[0].selectors, [".plan-budget-grid"]);
const budgetDecls = declarations(budgetRules[0]);
assert.equal(budgetDecls.display, "grid");
assert.equal(budgetDecls["align-items"], "stretch");
assert.equal(budgetDecls.gap, "0.5rem");
assert.equal(
  budgetDecls["grid-template-columns"],
  "repeat(auto-fit, minmax(min(100%, 9.75rem), 1fr))",
);
for (const prop of ["visibility", "opacity", "pointer-events"]) {
  assert.equal(budgetDecls[prop], undefined, `.plan-budget-grid must not set ${prop}`);
}

for (const selectors of [
  ["html.chat-keyboard-open main.app-scroll"],
  ["html.plan-keyboard-open main.app-scroll"],
  ["html.plan-keyboard-open .plan-page-scroll"],
  ["html.map-keyboard-open .bottom-nav"],
  ["html.trip-detail-route-active.trip-keyboard-open .bottom-nav"],
  [".media-action-grid"],
]) {
  assert.ok(
    rules.some((rule) => sameSelectors(rule, selectors)),
    `missing preserved selector: ${selectors.join(", ")}`,
  );
}

function specificity(selector) {
  const classes = selector.match(/\.[a-zA-Z0-9_-]+/g)?.length ?? 0;
  const elements = selector.match(/(^|[\s>+~])[a-zA-Z][\w-]*/g)?.length ?? 0;
  return classes * 100 + elements;
}

function matches(selector, htmlClass, elementClasses) {
  if (selector === ".plan-budget-grid") return elementClasses.includes("plan-budget-grid");
  const html = selector.match(/^html((?:\.[a-zA-Z0-9_-]+)+)\s+(.+)$/);
  if (!html) return false;
  const required = html[1].slice(1).split(".");
  if (!required.every((name) => name === htmlClass)) return false;
  const rest = html[2];
  if (rest === ".bottom-nav") return elementClasses.includes("bottom-nav");
  if (rest === ".bottom-nav.chat-nav-keyboard-hide") {
    return (
      elementClasses.includes("bottom-nav") && elementClasses.includes("chat-nav-keyboard-hide")
    );
  }
  return false;
}

function apply(htmlClass, elementClasses) {
  const props = {
    display: { value: "block", important: false, specificity: 0 },
    visibility: { value: "visible", important: false, specificity: 0 },
    opacity: { value: "1", important: false, specificity: 0 },
    "pointer-events": { value: "auto", important: false, specificity: 0 },
  };
  for (const rule of rules) {
    for (const selector of rule.selectors) {
      if (!matches(selector, htmlClass, elementClasses)) continue;
      const score = specificity(selector);
      rule.walkDecls((decl) => {
        if (!(decl.prop in props)) return;
        const current = props[decl.prop];
        const important = Boolean(decl.important);
        const wins = important !== current.important ? important : score >= current.specificity;
        if (wins) {
          props[decl.prop] = { value: decl.value, important, specificity: score };
        }
      });
    }
  }
  return Object.fromEntries(Object.entries(props).map(([prop, state]) => [prop, state.value]));
}

const hidden = { visibility: "hidden", opacity: "0", "pointer-events": "none" };
const cases = [
  [
    "normal",
    "",
    ["bottom-nav"],
    { display: "block", visibility: "visible", opacity: "1", "pointer-events": "auto" },
  ],
  ["app-keyboard-open", "app-keyboard-open", ["bottom-nav"], { display: "block", ...hidden }],
  [
    "chat-keyboard-open",
    "chat-keyboard-open",
    ["bottom-nav", "chat-nav-keyboard-hide"],
    { display: "block", ...hidden },
  ],
  ["plan-keyboard-open", "plan-keyboard-open", ["bottom-nav"], { display: "block", ...hidden }],
  [
    "keyboard-close",
    "",
    ["bottom-nav"],
    { display: "block", visibility: "visible", opacity: "1", "pointer-events": "auto" },
  ],
];
const budgetVisible = {
  display: "grid",
  visibility: "visible",
  opacity: "1",
  "pointer-events": "auto",
};

for (const [name, htmlClass, elementClasses, expectedNav] of cases) {
  assert.deepEqual(apply(htmlClass, elementClasses), expectedNav, `${name} bottom-nav`);
  assert.deepEqual(apply(htmlClass, ["plan-budget-grid"]), budgetVisible, `${name} budget grid`);
}

console.log("PASS keyboard nav selector contract");
