# Chapter 17 — Domain Model & Data Architecture

Version: 1.0  
Status: Planning → Documented

---

## 1–2. Purpose & Philosophy

定義核心資料模型。所有功能、AI、API 皆應建立於同一套資料模型。每一個 Domain Object 代表一個真實世界概念；不得一個 Model 同時承擔多個責任。

---

## 3. Core Domain Objects

User、Trip、TripDay、TripPlace、Conversation、ConversationWorkspace、TravelMemory、TravelDNA、Recommendation、Place、DecisionObject、ValidationResult、KnowledgeObject、AgentTask、WeatherSnapshot、Route、Budget、Attachment、Event。

---

## 4–21. Object Summaries

- **User**：根節點（Profile、Membership、Preference、Memory/DNA Ref、Workspace/Trip List）
- **Trip / TripDay / TripPlace**：行程結構；TripPlace 僅存在於某一 Trip
- **Place**：由 PIE 管理
- **Conversation**：不直接保存 Memory
- **Workspace**：Conversation/Trip/Memory/DNA Snapshot；可恢復聊天
- **Travel Memory**：結構化偏好 + Confidence + Evidence；不保存聊天
- **Travel DNA**：Type/Weight/Confidence/Trend/Evidence
- **Recommendation**：只保存 Place Reference
- **DecisionObject / ValidationResult**：AI 共用；Validator 不修改資料
- **KnowledgeObject / AgentTask / WeatherSnapshot / Route / Budget / Event**

---

## 22. Relationships (simplified)

User → Trip → TripDay → TripPlace → Place  
Conversation → Workspace → Memory/DNA Snapshot  
Recommendation → Place Reference  
Knowledge → Decision → Planner → Validator

---

## 23–24. Versioning & Engineering

Domain Object 含 Schema Version、Created/Updated。新功能優先新增 Domain Object，不得隨意新增 JSON。所有模組共用同一套 Domain Model。

---

## Acceptance Criteria

- 核心資料結構已定義
- AI 模組共用 Domain Model
- Place/Trip/Memory/DNA 責任清楚
- 可支援長期擴充與版本升級
