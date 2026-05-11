# Claude Code 一鍵任務｜v3.4 完整落地

**Patrick 留給 Claude Code 的指令、Vivi 早上開 Claude Code 一鍵啟動**

---

## 🎯 你的任務

把 production v30 升級到 v34、含工具二 2A/2B/2C 三池系統 + 5 對話設計守則 + 4 工具路徑 + plan_b 跨模組推進 + 結尾「主動說一件事」。

## 📋 必讀（按順序）

1. `docs/v3.4/README.md` — v3.4 整體脈絡
2. `docs/v3.4/07-chat_v34_spec.md` ⭐ — 主規格、含 line-by-line 改動
3. `docs/v3.4/08-chat_v34_patch_dialog_rules.md` ⭐ — 對話守則 patch、含完整 prompt 文字
4. `docs/v3.4/00-工具二_v3.2b.txt` — 工具二 reference
5. `docs/v3.4/01-Cathy_自我模組三週手冊.docx` v3 — 自我模組教練學
6. `docs/v3.4/02-Cathy_金錢事業模組三週手冊.docx` — 金錢模組
7. `docs/v3.4/03-Cathy_關係模組三週手冊.docx` — 關係模組

## 🚀 執行步驟

### Step 1｜跑 migration_009
```bash
npm run migrate -- migration/009_completion_tracking.sql
```
（confirm 自動傳 Y、跑完 SELECT 看 5 row）

### Step 2｜改寫 api/chat.js v30 → v34
按 07 spec Part 1-2.7 + 08 patch Part 1-4：
- WEEK_GOALS 全部重寫（self W1-3 + money W1-3 + relationship W1-3、依 Cathy 三本手冊 + 工具二 v3.2b）
- 加 `getAvailableTool2Pools(week, day)` 函數
- buildSystemPrompt 加 tool2Section 注入 + Week 3 Day 5 微證據邊界 case
- advanceStudentDay 加跨模組推進（trial / plan_a / plan_b 分流）
- 寫 stub: `onTrialComplete()` / `onSelfWeek3CompleteForPlanA()` / `onPlanBComplete()`（內含 console.log + TODO）
- DAMON_CORE 加 5 對話設計守則段落（08 patch Part 1）
- DAMON_CORE 加 4 工具路徑段落（08 patch Part 2）
- DAMON_CORE 補觸發 #5 完整 5 句 + 觸發 #6 Step1-Step4 完整原文（07 spec Part 2.5）
- DAMON_CORE 補觸發 #3 走到節點後的 4 訊號分叉路（07 spec Part 2.6）
- generateDamonNote prompt 加來源標籤（07 spec Part 2.4）+ 採集追蹤（08 patch Part 3）
- closureHint 改成「主動說一件事」流程（08 patch Part 4）

### Step 3｜index.html 不動
v34 = v20 既有版本、不需改 frontend（07 spec Part 3 確認）。

### Step 4｜commit + push
```bash
git add api/chat.js docs/v3.4/ migration/009_completion_tracking.sql
git commit -m "v34: 工具二 2A/2B/2C + 5 對話守則 + 跨模組推進 + Cathy 三模組手冊全部落地"
# 確認 fast-forward 可行
git push origin claude/[your-branch]:main
```
⚠️ 不開 PR、Vivi 已授權 fast-forward push 到 main

### Step 5｜verify Vercel deploy
等 30s、curl 確認 production 跑 v34（marker：對話守則 / 比喻路徑 / 結尾「想留下什麼」等字串在 production chat.js）

### Step 6｜跑 reset-test-data（destructive、要 Vivi 確認）
```bash
echo "請 Vivi 確認 YES 才跑 reset-test-data 清空 students/sessions/messages"
```
⚠️ **不要自動跑 reset**——等 Vivi 醒來看到「v34 部署完、要跑 reset 嗎？」、她說「跑」才動。

### Step 7｜回報
跟 Vivi 說：「v34 已部署、Vercel verify ✓、要跑 reset-test-data 嗎？」

## ⚠️ 紀律

- 不開 PR、fast-forward push（Vivi 之前授權）
- 不自動跑 reset-test-data（等 Vivi 確認）
- 改寫 chat.js 大改（>500 行）、出疑慮停下來、寫進 commit message 或回報
- migration_009 用 IF NOT EXISTS 防呆、跑兩次也安全
- 7 + 8 spec 內容衝突時、08 是 patch、優先於 7（基於更晚的實測校準）

