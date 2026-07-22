# Roamie AI Operating System (RAOS)

Version: 1.0  
Status: Foundation (documentation only)

RAOS 是 Roamie 的長期 AI 工程憲章與模組藍圖。

目前此目錄僅定義產品理念、架構原則與模組邊界。  
**尚未要求修改 App 功能、UI、API、商業邏輯或資料庫。**

---

## 閱讀順序

建議依章節編號閱讀。前半定義產品與會員；中段定義 AI 引擎；後半定義架構、資料、事件、效能、隱私與工程憲章。

| # | 章節 | 檔案 | 核心主題 |
|---|---|---|---|
| 1 | Product Vision & Membership Philosophy | [chapter-01-product-vision.md](./chapter-01-product-vision.md) | 產品定位、Free/Plus 哲學 |
| 2 | Membership System | [chapter-02-membership-system.md](./chapter-02-membership-system.md) | 會員能力、Credits、Workspace |
| 3 | AI Conversation Engine | [chapter-03-conversation-engine.md](./chapter-03-conversation-engine.md) | 對話引擎、引導規劃 |
| 4 | Travel Memory | [chapter-04-travel-memory.md](./chapter-04-travel-memory.md) | Plus 結構化旅行記憶 |
| 5 | Travel DNA | [chapter-05-travel-dna.md](./chapter-05-travel-dna.md) | 旅行人格分析層 |
| 6 | Context Engine | [chapter-06-context-engine.md](./chapter-06-context-engine.md) | 上下文整合與 Prompt Builder |
| 7 | Decision Engine | [chapter-07-decision-engine.md](./chapter-07-decision-engine.md) | 決策層與 Decision Object |
| 8 | Planner Optimizer | [chapter-08-planner-optimizer.md](./chapter-08-planner-optimizer.md) | 行程最佳化 |
| 9 | Validator Engine | [chapter-09-validator-engine.md](./chapter-09-validator-engine.md) | 品質驗證最後防線 |
| 10 | AI Intelligence Layer (AIL) | [chapter-10-ai-intelligence-layer.md](./chapter-10-ai-intelligence-layer.md) | 主動智慧建議層 |
| 11 | Recommendation System | [chapter-11-recommendation-system.md](./chapter-11-recommendation-system.md) | 統一推薦排序 |
| 12 | Place Intelligence Engine (PIE) | [chapter-12-place-intelligence-engine.md](./chapter-12-place-intelligence-engine.md) | 地點資料唯一入口 |
| 13 | Travel Knowledge Graph (TKG) | [chapter-13-travel-knowledge-graph.md](./chapter-13-travel-knowledge-graph.md) | 可驗證旅行知識 |
| 14 | Travel Agent Framework (TAF) | [chapter-14-travel-agent-framework.md](./chapter-14-travel-agent-framework.md) | 任務代理框架 |
| 15 | Learning & Feedback Engine (LFE) | [chapter-15-learning-feedback-engine.md](./chapter-15-learning-feedback-engine.md) | 持續學習與回饋 |
| 16 | System Architecture | [chapter-16-system-architecture.md](./chapter-16-system-architecture.md) | 分層架構與邊界 |
| 17 | Domain Model & Data Architecture | [chapter-17-domain-model.md](./chapter-17-domain-model.md) | 核心資料模型 |
| 18 | Event-Driven Architecture (EDA) | [chapter-18-event-driven-architecture.md](./chapter-18-event-driven-architecture.md) | Event Bus |
| 19 | Performance & Scalability (PSF) | [chapter-19-performance-scalability.md](./chapter-19-performance-scalability.md) | 效能與擴展 |
| 20 | Security & Privacy (SPF) | [chapter-20-security-privacy.md](./chapter-20-security-privacy.md) | 安全與隱私 |
| 21 | Engineering Manifesto | [chapter-21-engineering-manifesto.md](./chapter-21-engineering-manifesto.md) | 長期工程憲章 |

---

## 標準 AI 管線（目標架構）

```
User
  → Conversation Engine
  → Context Engine
  → Decision Engine
  → AI Intelligence Layer (Plus / optional)
  → Travel Knowledge Graph (facts)
  → Planner Optimizer (itineraries)
  → LLM
  → Validator Engine
  → Response
```

支援系統（非管線主幹，但為共用能力）：

- Recommendation System
- Place Intelligence Engine (PIE)
- Travel Memory / Travel DNA（Plus）
- Travel Agent Framework (TAF)
- Learning & Feedback Engine (LFE)

---

## Cursor Rules 對應

| Rule 檔 | 用途 | alwaysApply |
|---|---|---|
| `.cursor/rules/raos-core.mdc` | 不可違反的核心原則 | Yes |
| `.cursor/rules/ai-architecture.mdc` | AI 引擎與管線 | No |
| `.cursor/rules/membership.mdc` | Free / Plus 與 Credits | No |
| `.cursor/rules/memory-dna.mdc` | Travel Memory / DNA | No |
| `.cursor/rules/planner.mdc` | Planner / Validator | No |
| `.cursor/rules/recommendation-place.mdc` | Recommendation / PIE | No |
| `.cursor/rules/knowledge-agent.mdc` | TKG / TAF | No |
| `.cursor/rules/learning-feedback.mdc` | LFE | No |
| `.cursor/rules/domain-events.mdc` | Domain Model / EDA | No |
| `.cursor/rules/performance.mdc` | PSF | No |
| `.cursor/rules/security-privacy.mdc` | SPF | No |
| `.cursor/rules/testing.mdc` | 測試與驗證策略 | No |
| `.cursor/rules/engineering-manifesto.mdc` | 長期工程憲章摘要 | No |

---

## 遷移路線圖

分階段遷移（P0→P3）、衝突清單與下一決策點見：

- [migration-roadmap.md](./migration-roadmap.md)
- [recommendation-engine-design.md](./recommendation-engine-design.md)（Phase 2：Pipeline 已定；R0 Explore）
- [planner-recommendation-integration.md](./planner-recommendation-integration.md)（Planner × Rec Engine 分階段整合）
- [planner-contract.md](./planner-contract.md)（Planner 職責邊界契約 — P2+ 強制）
- [candidate-pool-pipeline.md](./candidate-pool-pipeline.md)（Candidate Pool：Quality → Diversity → Geo → Temporal → Flow → Experience）

原則：小步重構、逐步驗證；衝突先記錄並經確認後才改碼。

---

## 實作狀態

- [x] RAOS 文件導入（Chapter 1–21）
- [x] Cursor rules 建立
- [x] 遷移路線圖（Phase 0–7）
- [x] Phase 1 Step A：PIE Facade（加層 + Feature Flag）
- [x] Phase 1 Step B：Place Detail 呼叫端 → places-gateway（**Phase 1 closed — Places 第一階段結束**）
- [x] Phase 2 設計：Recommendation Pipeline（normalize→…→explain→validate）+ 約束確認
- [x] Phase 2 實作 R0（Explore Adapter；行為 = 現況；Flag `VITE_REC_ENGINE_ENABLED`）— ✅ 已確認
- [x] Phase 2 R1.1（Profiles：Hours / Distance / Rating / Reviews）— ✅ 已確認
- [x] Phase 2 調整：Recommendation Profiles + 結構化 Explain
- [x] Phase 2 R1.2（Memory / DNA = Suggestion/Signal only）— ✅ 已確認
- [x] Phase 2 Planner Integration 設計 — [planner-recommendation-integration.md](./planner-recommendation-integration.md)
- [x] Phase 2 Planner P1（行為對齊 trip-place-scoring；Flag `VITE_REC_ENGINE_PLANNER_ENABLED`）— ✅ 已確認
- [x] Phase 2 Planner Design Contract — [planner-contract.md](./planner-contract.md)
- [x] Phase 2 Planner P2.1（Flag ON = Engine Profile 排序）— ✅
- [x] Phase 2 Planner P2.2（slot pick 依 pool 順序 + 約束）— ✅
- [x] Phase 2 Planner P2.3（Local life / Classic / rankByQuality 去 Ranking）— ✅ 已確認
- [x] Phase 2 Planner P3.1（PIE Search Gateway；Flag `VITE_PIE_PLANNER_SEARCH_ENABLED`）— ✅ 已確認
- [x] Phase 2 Planner P4.1（Recommendation Validator；Flag `VITE_REC_ENGINE_VALIDATOR_ENABLED`）— ✅ 已確認
- [x] Phase 2 Planner P4.2（Itinerary Validator；Flag `VITE_ITINERARY_VALIDATOR_ENABLED`）— ✅
- [ ] AI 接線 Priority 1 Step 1（僅 Planner Flag；實機 Case 1–5）— [acceptance](./ai-wiring-p1-step1-acceptance.md)
- [ ] Phase 2 Planner P3.2+（PIE Search 內部強化）— 接線完成後
- [ ] Legacy Removal（Migration 完成後再做）
- [ ] Phase 2 R1.3（Weather / Season / Festival）— **暫停**
- [ ] Phase 3–7：依 roadmap 推進
- [ ] 功能開發（對齊 RAOS 後再進行）
