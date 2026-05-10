# v3.0 部署規格 — 給 Claude Code 看的

**目的**：把 production 從 v2.6 升級到第一階段 Week 1（v3.0）
**對齊**：PRODUCT-TRUTH v1.3（9 週進程、拿掉影片、Vivi 教練筆記本）

---

## 📋 必讀順序

1. **06-chat_v30_spec.md** ⭐ 主規格、含 line-by-line diff、SQL migration、前端 spec、驗證 checklist
2. **05-D2_design_spec.md** D2 設計 + second-pass prompt（Vivi 教練筆記本）
3. **04-Cathy_responses_Q1_Q2_Q5_2026-05-10.md** Cathy 三題答覆
4. **03-Patrick_to_Vivi_v3_3_patch.md** Damon 三條測試 + 「被」字句處理
5. **02-Patrick_to_Vivi_v3_2_patch.md** Damon 第一輪校準
6. **01-Patrick_to_Vivi_3_drafts_v3.md** v3 教練學基準

---

## 🎯 執行任務（高層）

1. 跑 `migration/006_notebook_page.sql` 在 Neon Console（**等 Vivi 確認、不要自動跑**）
2. 改寫 `api/chat.js` v22 → v30（對照 06 spec Part 1.1-1.9）
3. 改寫 `index.html` v19 → v20（對照 06 spec Part 2）
4. **不要 push**、改完跟 Vivi 說「v30 寫好了、要 review 嗎？」

---

## ⚠️ Vivi 給的明確指示

- Vivi 跳過 prompt 校稿、staging 走為準
- 改完先給 Vivi review 整體、確認再 push
- 不要動 `coach-login.html`（不在 scope）
- 不要動 `api/auth/`、`api/notes.js`、`api/sessions.js`、`api/setup.js`、`api/students.js`（不在 scope）

---

## 📁 reference/ 子目錄

額外脈絡（不必讀、有問題時查）：
- patrick-todo-v3.0.md：Patrick 全部 to do（看 Block 1 區段）
- PATRICK-CHANGELOG-v2.7.md：v2.6 → v2.7 大變動的決策歷史
- PATRICK-CHANGELOG-v2.7.1-patch.md：v2.7.1 Prompt review 職責加入
- PATRICK-CHANGELOG-v2.7.2-patch.md：v2.7.2 工程進度週報加入

---

*— v3.0 docs README ｜ 2026-05-10 ｜ Patrick —*
