# v4.0 Source of Truth Pack（給 Claude Code 用）

**版本**：v4.0
**狀態**：教練學三方校準完成（Cathy v5/v3/v3 + 工具二 v4 + Damon 6 點校準）+ Patrick spec + Prompt Engineering Advisor Round 1-4 結論
**Code 動作**：本 folder 是 v4.0 落地的 source of truth、Code 從這裡讀教練學內容 + 工程 spec

---

## 📁 檔案清單

### 教練學內容（Cathy + Damon 校準完）

| 檔案 | 性質 | 對應 chat.js |
|---|---|---|
| **cathy_self_v5.md** | 自我關係模組 Week 1-3、含 Damon Change 1/2/4 | `WEEK_GOALS.self.1-3` |
| **cathy_money_v3.md** | 金錢事業模組 Week 1-3 | `WEEK_GOALS.money.1-3` |
| **cathy_relationship_v3.md** | 關係模組 Week 1-3 | `WEEK_GOALS.relationship.1-3` |
| **tool2_v4.txt** | 工具二 v4、JavaScript const 結構 + Damon 6 點全部 | `lib/tool2/tool2-data.js` |
| **session_handbook_v2.md** | 1-on-1 4 週 Session 手冊（reference 用、不直接落地）| 對照 |

### Damon 源頭

| 檔案 | 性質 |
|---|---|
| **damon_6point_calibration.md** | Damon 工具二 6 點校準回覆（行動清單）|
| **damon_deep_analysis_notes.md** | Damon 深度解析 1-5 Patrick 筆記（核心 thesis）|
| **asian_behavior_pattern.md** | 亞洲人行為模式核心整理（v3 → v4 變動表）|

### Patrick 工程 spec

| 檔案 | 性質 |
|---|---|
| **02-chat_v40_spec.md** | Patrick v4.0 落地 spec（§1-10、含 DAMON_CORE 守則三改寫 + WEEK_GOALS 9 週改動 + generateDamonNote 5 個新欄位）|

---

## 🚦 Code 讀的順序

```
1. 02-chat_v40_spec.md（spec 主檔、§1-10 改動清單）
2. asian_behavior_pattern.md（理解 v3 → v4 核心轉向）
3. damon_6point_calibration.md（工具二 v4 為何這樣寫）
4. tool2_v4.txt（直接 cp 進 lib/tool2/tool2-data.js）
5. cathy_self_v5.md / cathy_money_v3.md / cathy_relationship_v3.md
   （WEEK_GOALS direction 重寫的 source）
6. damon_deep_analysis_notes.md（背景知識、寫 prompt 時對齊）
```

---

## ⚠️ 重要：v4.0 Code Prompt 由 Vivi 給、不在這 folder

Vivi 會在 Code chat 貼：
- Advisor Code Prompt（主結構：8 phase + migrations + dispatcher）
- Patrick refine 補充（補 Phase 5.0a/5.0b/5.0c + repo context anchor）

本 folder 是 Code 執行時讀的 reference 素材、不是執行指令。

---

*— docs/v4.0/ README ｜ Patrick ｜ 2026-05-12 —*
*v4.0 教練學 + 工程 spec 三方校準完成、Code 落地用*
