# Chapter 13 — Travel Knowledge Graph (TKG)

Version: 1.0  
Status: Planning → Documented

---

## 1–2. Purpose & Philosophy

旅行知識層：可靠、可驗證、可持續更新。AI 不應完全依賴 LLM。所有旅行相關知識應優先查詢 TKG。

- LLM 擅長：理解、推理、對話
- TKG 擅長：事實、規則、旅行資訊

LLM 不應自行猜測節慶、花季、簽證、票券、旅行規則。

---

## 3. Knowledge Flow

User → Conversation → Context → Decision → **TKG** → Decision Update → Planner → LLM → Validator → Response

---

## 4–15. Domains (summary)

Country/City/Region、Attraction/Restaurant、Festival/Holiday、Weather Pattern、Season、Flower/Autumn/Snow、Transportation/Airport、Visa/Currency/Language、Culture/Safety/Emergency、Payment/Internet/Etiquette、Opening/Ticket/Reservation Rules、Travel Tips。

包含 Country Profile、City Knowledge、Seasonal/Festival、歷史氣候、交通票券知識、景點知識（停留/天氣/拍照/預約/DNA 關聯）、文化與安全、預約需求、Travel Intelligence。

---

## 16–17. Update & Source Priority

可更新節慶、票價、簽證、交通、新舊景點，且不影響 AI 架構。

來源優先：Official Government → Tourism Board → Official Attraction → Transportation Operator → Trusted Travel Partner → Verified Internal Database。

LLM 不作為唯一知識來源。

---

## 18–19. Engineering & Future

獨立知識層；不得直接寫入 Memory/DNA/Conversation/Decision。各模組可查詢。未來可擴充 Restaurant/Cafe/Museum/UNESCO/Michelin/Hidden Gems/Accessibility/Sustainability。

---

## Acceptance Criteria

- 擁有可驗證知識來源
- 能引用季節、節慶與文化資訊
- 不再完全依賴 LLM 回答旅行知識
- 可持續更新且不影響其他模組
