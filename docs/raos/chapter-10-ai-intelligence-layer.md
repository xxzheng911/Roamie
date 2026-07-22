# Chapter 10 — AI Intelligence Layer (AIL)

Version: 1.0  
Status: Planning → Documented

---

## 1–2. Purpose & Philosophy

智慧決策層。不負責生成文字、建立行程、推薦景點。工作是思考 AI 是否應主動提供更好的旅行建議。

一般 AI：問→答。Roamie AI：除了回答，還能幫助什麼？核心是陪伴整趟旅行。

---

## 3. Intelligence Flow

User → Context → Decision → **AIL** → Planner → LLM → Validator → Response

---

## 4–15. Capabilities (summary)

分析旅行目的、階段、日期、城市、DNA、Memory、天氣、節慶、預算、同行、真正需求。

主動提醒：最佳月份、花季/楓葉/雪、煙火/祭典、限定活動/美食/展覽。  
Opportunity Discovery、Travel Optimization、Weather/Budget Intelligence、Risk Detection、Preference Evolution、Intelligent Reminder、Comparison、Learning Loop、Human-like Reasoning。

最終定位：私人旅遊顧問。主動思考/提醒/優化，但不替使用者做決定。

---

## 17. Engineering Principle

獨立智慧層。不得直接修改 Memory、DNA、Conversation Engine、Planner Optimizer。僅提供分析與建議，由其他模組執行。

---

## Acceptance Criteria

- 能主動提醒並發現更好安排
- 能依天氣、節慶、預算提出建議
- 能逐步學習習慣
- 角色從回答問題提升為旅行顧問
