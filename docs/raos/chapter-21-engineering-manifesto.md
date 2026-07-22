# Chapter 21 — Engineering Manifesto & Product Evolution

Version: 1.0  
Status: Foundation

---

## 1. Purpose

Engineering Manifesto 定義 Roamie 長期發展的核心原則。這不是功能文件或需求文件，而是所有未來開發者都應共同遵守的設計信念。任何新功能、AI 能力、架構調整皆應符合本章原則。

---

## 2–4. Mission, Vision, AI Philosophy

使命：讓每一位旅行者都擁有一位真正理解自己的 AI Travel Companion。

不追求回答最多問題；追求做出最適合使用者的旅行決策。價值來自理解、陪伴、持續學習。

AI 永遠不是主角，旅行者才是。AI 應理解、建議、提醒、協助，而不是替使用者決定。最終決定權屬於使用者。

---

## 5–8. Engineering, Architecture, Quality, Trust

- 先問是否已有模組可完成；優先擴充，避免重複架構與 Prompt 堆疊
- 永遠先設計架構再開發功能；不得因趕進度直接改 Prompt/UI
- AI 回答越可靠越好；資料不足應誠實說明、主動詢問、避免猜測
- 不得破壞使用者信任（未經同意學習、不透明推薦、無法刪除、過度通知）

---

## 9–14. Learning, Modularity, Scale, Explainability, Human-centered, Sustainability

長期學習逐步改善；能力模組化可替換；架構支援到百萬使用者；建議可解釋；以旅行者需求為中心；考慮維護/API/效能/測試/長期可維護性。

---

## 15–18. Evolution, Decision Rules, Tech Debt, Documentation

可演進但須符合架構、向下相容、不破核心原則。新功能前必須通過 Vision / AI Philosophy / Privacy / Architecture / Long-term 檢查。技術債需在大型版本安排 Refactoring 與 Architecture/Performance Review。重要能力需設計文件、資料模型、事件流程、測試策略；RAOS 應始終保持更新。

---

## 19. Product Evolution

未來可能加入多人/商務/親子/無障礙旅行、語音導遊、AR、Wearable、車載等——皆應建立於 RAOS。

---

## 20. Final Principle

目標不是打造最強大的 AI，而是打造最值得信任、最理解旅行者、最能陪伴旅行的 AI。

如果某項功能無法讓旅行變得更簡單、更安心、更有樂趣，即使技術上做得到，也不應加入。

---

## Acceptance Criteria

- 所有未來功能皆有共同設計原則
- 團隊理解長期願景；AI 方向一致
- 技術債有治理策略
- RAOS 成為長期工程憲章與最高設計準則
