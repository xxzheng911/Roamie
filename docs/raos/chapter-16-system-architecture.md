# Chapter 16 — System Architecture

Version: 1.0  
Status: Planning → Documented

---

## 1–2. Purpose & Philosophy

定義各模組責任、資料流、事件流與邊界。目標：低耦合、高內聚。新功能建立於既有模組，而非直接修改 Prompt 或 UI。

採用 Layered Architecture；不得跨層直接存取。

---

## 3. High-Level Architecture

```
Presentation Layer
  → Application Layer
  → AI Layer
  → Knowledge Layer
  → Service Layer
  → Data Layer
```

---

## 4–9. Layers

| Layer | Responsibility | Must not |
|---|---|---|
| Presentation | UI/UX | AI logic |
| Application | flows, navigation, dispatch | call AI directly |
| AI | Conversation, Context, Decision, Planner, Validator, AIL, Recommendation, TAF, LFE | — |
| Knowledge | TKG, Memory, DNA, Season/Festival, PIE | be mutated ad-hoc by AI writebacks without rules |
| Service | Places, Directions, Weather, Maps, Affiliate, Push, Analytics, Auth | be called from UI |
| Data | Supabase, Cache, Storage, Profile, Trips, Workspace, Favorites, Settings, AI Logs | be accessed without Repository |

---

## 10–18. Cross-cutting

- Data flow 單向；不得逆向呼叫
- Event Bus 統一事件
- 模組責任不重疊
- Repository Pattern
- Dependency Rule：上層可依下層
- 集中 State Management
- API Gateway
- 統一 Error Handling / Logging
- 模組可新增、替換、獨立部署

---

## 20. Engineering Principle

新功能先判斷屬於哪一層。不得直接新增 Prompt 或寫死 UI；必須符合 Layered Architecture。

---

## Acceptance Criteria

- 模組責任明確
- AI 不直接操作 UI；UI 不直接呼叫第三方 API
- 資料經 Repository；事件經 Event Bus
- 可持續擴充
