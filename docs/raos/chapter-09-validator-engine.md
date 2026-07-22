# Chapter 9 — Validator Engine

Version: 1.0  
Status: Planning → Documented

---

## 1–2. Purpose & Flow

品質驗證系統。所有 AI 回覆、行程、推薦都必須經過 Validator。不產生答案；不合理則要求重新生成。使用者不應看到未通過內容。

Flow：Conversation → Context → Decision → Planner → LLM → **Validator** → Pass 顯示；Fail → 重生成 → 再驗。

---

## 3. Validation Categories

Context、Intent、Destination、Google Place、Category、Duplicate、Business Hours、Travel Time、Meal Logic、Travel Days、Travel Pace、DNA、Memory、Budget、Weather、Language、Travel Order、Recommendation Quality。

---

## 4–18. Key Rules (summary)

- Place 必須存在且 Place ID 有效；禁幻覺
- Duplicate / Category / Meal / Hours / Route / Weather / Budget / Days / Pace
- Negative Preference 再掃一次
- 推薦須有理由；排除墓地/靈骨塔/量販/私人住宅/停業等
- Language 一致；「第二個」等指代必須正確，不得亂猜
- Quality Score；Overall < 90 → 重新生成

---

## 20. Engineering Principle

最後一道防線。未來 AI Bug 優先新增 Validation Rule，不得直接修改 Prompt。

---

## Acceptance Criteria

- 不再推薦不存在或無關低品質地點
- 不重複；餐食與天數合理
- 回覆符合需求；所有回覆皆經 Validator
