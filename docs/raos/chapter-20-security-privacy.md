# Chapter 20 — Security & Privacy Framework (SPF)

Version: 1.0  
Status: Planning → Documented

---

## 1–2. Purpose & Philosophy

定義安全、權限與隱私管理。AI 必須記住使用者，但使用者永遠擁有資料控制權。Privacy by Design。使用者擁有自己的旅行資料、AI 記憶、Travel DNA、聊天紀錄；Roamie 只是代為管理，不得將使用者資料視為平台資產。

---

## 3–4. Classification & Ownership

Public / Internal / Private / Sensitive。Trip、Workspace、Conversation、Memory、DNA 皆屬於 User；可查看、匯出、刪除、永久移除。

---

## 5–12. Controls

- Memory / DNA 可管理與清除
- Workspace 預設 Private；分享須主動
- 分享 Trip 不得夾帶 Memory/DNA/Conversation（除非另授權）
- 共編可改 Trip，不可改建立者 Memory/DNA/Learning/偏好
- Learning 可停用
- 支援封存與永久刪除；Forget Everything 後 AI 不得繼續使用

---

## 13–19. Transparency, Consent, Security, Compliance

引用 Memory/DNA 應可解釋。首次啟用需明確同意。Private/Sensitive：TLS + 儲存加密。Auth：Apple/Google/Email（未來 Passkey/MFA）。API 驗證 Identity + Membership + Permission。Audit Log。符合 App Store、GDPR、CCPA（可選）、台灣個資法。

---

## 20. Engineering Principle

新功能必須回答：是否涉及個資？是否需同意？是否可刪除？是否可查看？若否，不得直接上線。

---

## Acceptance Criteria

- 使用者完整擁有資料
- Memory/DNA 可自由管理；Learning 可停用
- 共編不影響個人 AI 資料
- Privacy by Design；具備長期隱私架構
