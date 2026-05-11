# chat.js v34 工程規格 ｜ 工具二 v3.2b + 完整 9 週進程

**版本**：v1.0
**日期**：2026-05-10
**作者**：Patrick
**Reference baseline**：chat.js v30 hotfix（commit `f139099`、含 Bug 1+2 patch）
**對齊**：Cathy 工具二 v3.2b + Cathy 三模組三週手冊 + Damon 觸發 #5/#6 完整原文 + Task #17（plan_b 跨模組推進）+ Damon Week 3 Day 5 邊界 case

---

## 📖 文件目的

把 production v30（v3.3 patch 的「12 句平鋪 + 4 週 placeholder」）升級到 v34：
1. 工具二從「12 句平鋪 + confirm + 為什麼重要」→ **2A/2B/2C 三池系統**（Cathy + Damon 對齊 v22 觸發編號）
2. WEEK_GOALS Week 4-9 從 placeholder → 完整內容（金錢 + 伴侶模組）
3. plan_b 跨模組自動推進（Task #17）
4. Damon Note prompt 加「依工具二來源決定詞進哪個 section」標籤
5. UI 層 Week 1 只顯示 2A + 2B、不顯示 2C
6. Week 3 Day 5 微證據掃描邊界 case

⚠️ **不上 production**——等 Vivi A001 走完 Day 1-6 親測 v30 穩定後才推。

---

## 🎯 改動 manifest

| 檔案 | 變動 | 範圍 |
|---|---|---|
| `api/chat.js` | v30 → v34 | WEEK_GOALS 全部重寫（含金錢 + 伴侶）+ buildSystemPrompt 加 Day-based selection + advanceStudentDay 加跨模組 + generateDamonNote prompt 加來源標籤 |
| `index.html` | v20 → v21 | UI 層工具二改 2A/2B/2C 顯示邏輯（Week 1 只顯示 2A+2B、Week 2 顯示 2C、Week 3 不顯示） |
| 資料庫 | 不動 | v34 沒新 schema（既有 plan/upgrade_deadline/notebook_page 都夠用）|

---

## 1️⃣ Reference 必讀（落地前看）

按以下順序看：

1. `00-工具二_v3.2b.txt`（本目錄、Cathy + Damon 對齊定稿、含 metadata + 觸發 #5/#6 完整原文 + 4 訊號分叉路）
2. `01-Cathy_自我模組三週手冊.docx`（Week 1-3）
3. `02-Cathy_金錢事業模組三週手冊.docx`（Week 4-6）
4. `03-Cathy_關係模組三週手冊.docx`（Week 7-9）
5. v3.0 spec（reference）：`/employees/patrick/prompt-design/v3.3/06-chat_v30_spec.md`

---

## 2️⃣ chat.js v30 → v34 詳細改動

### 2.1 WEEK_GOALS 全部重寫

**改前**（v30 production）：
- self.1 = 12 句平鋪（v3.3 patch B）
- self.2 = 家族語錄 v3.3
- self.3 = 整合 + SC Transfer v3.3
- money.1-3 = placeholder「⏳ 待 Cathy」
- relationship.1-3 = placeholder「⏳ 待 Cathy」

**改後**（v34）：
- self.1-3 = 對齊 Cathy 自我模組手冊 + 工具二 2A/2B/2C
- money.1-3 = 對齊 Cathy 金錢事業手冊 + 工具二 2A/2B/2C
- relationship.1-3 = 對齊 Cathy 關係手冊 + 工具二 2A/2B/2C

**原則**（每模組三週都套用）：

```javascript
// 結構：
{
  goal: '...教練學意圖（從 Cathy 手冊抽）',
  direction: `
    【這週的核心動作】
    [從 Cathy 手冊抽]
    
    【工具二可用範圍】（依 Week + Day 切換）
    Week X Day 1-2: 工具二 2A
    Week X Day 3-4: 工具二 2A + 2B
    Week X Day 5-6: 工具二 2A（整合用）
    （Week 2 任一天）: 工具二 2C（接觸發 #6 語錄溯源）
    （Week 3）: 不主動使用工具二
    
    【觸發鏈整合】
    2A 填完 → confirm → 觸發 #3 → 4 訊號分叉路
    2B 填完 → 觸發 #5「保護你什麼」（不 confirm）
    2C 填完 → 觸發 #6 Step1 回收 + Step2 問來源
    
    【模組特定核心動作】
    [從 Cathy 手冊抽當週的核心動作 + 範例]
    
    【學員視角的收穫】
    [從 Cathy 手冊抽該週「收穫一句話」]
  `
}
```

**完整 prompt 文字**：Claude Code 落地時、依 Cathy 三本手冊 + 工具二 v3.2b 寫入。Patrick 不在這份 spec 重寫完整內容（避免 prompt 文字成為 single source、應該以 Cathy 手冊為真相）。

### 2.2 buildSystemPrompt 加 Day-based selection 邏輯

**新增變數**：

```javascript
// 依 Week + Day 計算當前可用的工具二池
function getAvailableTool2Pools(week, day) {
  // Week 1
  if (week === 1) {
    if (day <= 2) return ['2A'];           // Day 1-2 主力 2A
    if (day <= 4) return ['2A', '2B'];     // Day 3-4 加 2B
    return ['2A'];                          // Day 5-6 整合用 2A
  }
  // Week 2
  if (week === 2) return ['2C'];           // Week 2 全週 2C
  // Week 3
  return [];                                // Week 3 不主動使用工具二
}

// 在 system prompt 注入：
const availablePools = getAvailableTool2Pools(week, day);
const tool2Section = availablePools.length > 0
  ? `\n\n# 今天可用的工具二池\n${availablePools.join(' + ')}\n（其他池今天不能用、學員看不到）`
  : `\n\n# 今天不主動使用工具二\n（Week 3 是整合週、用之前累積的素材）`;
```

**注入到 system prompt**：在 `weekGoal.direction` 之後、`closureHint` 之前。

### 2.3 advanceStudentDay 加跨模組推進（Task #17）

**改前**（v30）：
```javascript
// week 3 day 6 完成 → 停（self_week_completed = 3）
```

**改後**（v34）：
```javascript
// week 3 day 6 完成、依 plan + module 決定下一步：

if (currentModule === 'self' && currentWeek === 3 && day === 6) {
  // self 完成、依 plan 決定
  if (plan === 'trial') {
    // 試用結束、推 Day 7 Email + 學員可選付費
    await onTrialComplete(studentId);
    return; // 不推進
  }
  if (plan === 'plan_a') {
    // plan_a 完成、推升級邀請（限時 7 天 + 1500 / 過期 2000）
    await onSelfWeek3CompleteForPlanA(studentId);
    return;
  }
  if (plan === 'plan_b') {
    // plan_b 自動推進到 money week 1 day 1
    await sql`
      UPDATE students 
      SET current_module = 'money', current_week = 1, current_day = 1,
          self_week_completed = 3, money_unlocked = TRUE,
          updated_at = NOW()
      WHERE student_id = ${studentId}
    `;
    return;
  }
}

if (currentModule === 'money' && currentWeek === 3 && day === 6) {
  // plan_b money 完成、推進到 relationship week 1 day 1
  await sql`
    UPDATE students 
    SET current_module = 'relationship', current_week = 1, current_day = 1,
        money_week_completed = 3, relationship_unlocked = TRUE,
        updated_at = NOW()
    WHERE student_id = ${studentId}
  `;
  return;
}

if (currentModule === 'relationship' && currentWeek === 3 && day === 6) {
  // plan_b relationship 完成、整個 9 週走完
  // 觸發 9 週 Journal Report 生成（Brevo + App 內顯示）
  await onPlanBComplete(studentId);
  return;
}
```

⚠️ **依賴**：
- migration_007 plan 重定義（已落地）
- migration_008 upgrade_tracking（已落地）
- 新增 `money_week_completed` / `relationship_unlocked` 欄位（**migration_009 待寫**、見 Part 4）
- `onTrialComplete()` / `onSelfWeek3CompleteForPlanA()` / `onPlanBComplete()` 都是新 function、要寫 stub（內含 Brevo trigger、可先 console.log + TODO）

### 2.4 generateDamonNote prompt 加來源標籤

**改動**：在 prompt 加「依工具二來源決定詞進哪個 section」邏輯：

```javascript
system: `你是 Damon Cart...

格式：

【今天的模式】
...

【關鍵句】
今天學員說出來最重要的一句話...

⚠️ 如果學員今天用了工具二：
- 學員選 2A 句並 confirm → 那個填空詞 + confirm 後的延伸 → 寫進【關鍵句】
- 學員選 2B 句 → 那個填空詞 + 觸發 #5「保護什麼」答覆 → 寫進【SC 觀察】、標註「（反應模式、不是 SC、是慣性）」
- 學員選 2C 句 → 那個填空詞 + 觸發 #6 Step2「來源」答覆 → 寫進【還沒碰到的】、標註「Week 2 信念入口、待 Step3 反例提問」

【深度層次】
...

【SC 觀察】
（含 2B 反應模式如有）

【還沒碰到的】
（含 2C 信念入口如有）

【明天的入口】
...

注意：簡短有力、總長度不超過 400 字。
`,
```

### 2.5 觸發 #5 / #6 完整原文加進 prompt

**v30 production 的 DAMON_CORE 應該已經有觸發 #5 + #6 的精簡版**。v34 補完整原文（Cathy v3.2b 引用的 v22 原文）：

**觸發 #5 完整 5 句**（2B 用）：
```
1. 「這個部分的你——它是想保護你什麼嗎？」
2. 「如果我們先不把它當敵人——你覺得它是在試著為你做什麼？」
3. 「它的正向意圖會是什麼？」
4. 「它怕你失去什麼？」
5. 拿到答案後再翻一次：「好，那它想要的是什麼？不是它怕什麼，是它想要的。」

絕對不能說：「那是你需要克服的」「你要更有紀律」「不要讓它擋你」
```

**觸發 #6 Step1-Step4**（2C 用）：
```
Step1（必做）：原封不動回收。「『___』……嗯。」
Step2：問來源。
  「這個感覺——你最早是什麼時候開始這樣覺得的？」
  或：「這句話如果有聲音，是誰的聲音？」
Step3（NLP 反例提問）：
  「我問你一個問題——這句話永遠都是真的嗎？」
  「有沒有任何時候，哪怕一次，你不是這樣？」
Step4：不急著放大反例。讓他自己看見。
  「那這個（反例的你）也是你。對嗎？」

注意：2C 填完後 AI 先做 Step1 回收，再做 Step2 問來源
Step3（反例）通常在 Week 2 第 3-4 天做，不是 2C 填完就立刻做
```

### 2.6 第二層追問鏈整合進觸發 #3 下游（4 訊號分叉）

**改 prompt**（在觸發 #3 規則之後加一段）：

```
## 觸發 #3 走到節點後的分叉路（4 訊號）

學員回答觸發 #3 的「為什麼這對你來說很重要？」之後、
AI 看訊號選分叉路（不按順序全部問）：

訊號 A：學員說的詞讓她身體有反應（停頓、語氣變、嗯⋯⋯）
→ 觸發 #7 三段式：「我聽到了。身體有什麼感覺？」「我們在這裡停五秒、深呼吸三下。準備好、跟我說一聲。」

訊號 B：還在 L3-L4、沒有身體反應、繼續往 SC 層走
→ 追問鏈①：「為什麼這件事對你這麼重要？」（繼續觸發 #3）
→ 追問鏈③：「如果失去這個、你最害怕的是什麼？」（找 away-from 動機）

訊號 C：學員說出「從小就這樣」「我媽說」「以前有人說我」
→ 追問鏈②：「你是從什麼時候開始這樣相信的？」
→ Week 1 輕帶、不展開（這是 Week 2 伏筆）

訊號 D：學員說「但是我做不到」「我就是沒辦法」「每次都這樣」
→ 追問鏈④：「這句話保護了你什麼？」（進觸發 #5）
→ 追問鏈⑤：「這句話、又限制了你什麼？」（觸發 #5 另一面）

第二層追問鏈五條不是獨立系統、是觸發 #3 走到節點後的分叉路。
AI 根據學員回答的訊號選一條、不按順序全部問。
```

### 2.7 Week 3 Day 5 微證據邊界 case（Damon 補充）

**改 buildDay6Prompt（Week 3 Day 5 部分、實際上是 Day 5 邏輯、不是 Day 6）**：

`buildSystemPrompt` 加：

```javascript
// Week 3 Day 5 微證據掃描特殊規則
if (week === 3 && day === 5) {
  systemPrompt += `

# Week 3 Day 5｜微證據掃描

今天的任務：請學員回顧今天、找出任何「曾經是你新 SC 的瞬間」。
不論多小、5 秒鐘也算。

如果學員找不到任何微證據：
→ 不要新採集工具二
→ 回收 Week 1 學員選的 2A 詞、做身體確認
→ 「你 Week 1 說你是『___』的人。今天、有沒有任何一個瞬間、那個你出現過？」
→ 如果還是找不到：「OK。那這樣問——現在這一秒、你能不能就是『___』五秒鐘？」（身體錨定）
`;
}
```

⚠️ 需要從資料庫拉 Week 1 學員選的 2A 詞——這需要新 schema（`students.week1_2a_word` TEXT）或從 Damon Note parse。建議從 Damon Note Week 1 的【關鍵句】parse、不加新欄位。

---

## 3️⃣ index.html v20 → v21 詳細改動

### 3.1 工具二顯示邏輯

當對話進到 Week 1-2、AI 在 prompt 拋工具二題時、frontend 要根據 day 決定顯示哪些池。

**注意**：實際工具二的 12 句 / 25 句不是 frontend 顯示、是 AI 在對話裡拋出來。Frontend 只負責顯示對話 bubble。

→ **frontend 不需要動工具二顯示邏輯、只需要正常顯示 AI 回應**。

⚠️ 修正：v34 frontend 不需要動。我之前以為要、實際上 prompt 拋的句子就是對話內容、frontend render 即可。

### 3.2 學員選擇填空 UX

當 AI 拋「我是一個 ___ 的人」、學員直接打字回填空。**v30 既有 UX 不變**。

→ 結論：**index.html v34 = v20、不需要改**。

---

## 4️⃣ migration_009_completion_tracking.sql

```sql
-- Migration 009: 加 plan_b 跨模組推進需要的欄位
-- 目的：追蹤每個模組是否完成、解鎖下個模組
-- 對齊：v3.4 spec Part 2.3

-- 1. 跑前檢查
SELECT 'BEFORE' AS stage,
       (SELECT COUNT(*) FROM information_schema.columns
        WHERE table_name = 'students' 
          AND column_name IN ('self_week_completed', 'money_week_completed', 'relationship_week_completed', 'money_unlocked', 'relationship_unlocked')) AS existing_count;

-- 2. 新增欄位
ALTER TABLE students
  ADD COLUMN IF NOT EXISTS self_week_completed INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS money_week_completed INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS relationship_week_completed INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS money_unlocked BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS relationship_unlocked BOOLEAN NOT NULL DEFAULT FALSE;

-- 3. 跑後驗證
SELECT 'AFTER' AS stage,
       column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_name = 'students' 
  AND column_name IN ('self_week_completed', 'money_week_completed', 'relationship_week_completed', 'money_unlocked', 'relationship_unlocked')
ORDER BY column_name;
```

---

## 5️⃣ Claude Code 執行順序

```
Step 1: 讀 docs/v3.4/00-工具二_v3.2b.txt + 三本 Cathy docx + 本 spec

Step 2: 跑 migration/009_completion_tracking.sql 在 Neon Console（用 npm run migrate）

Step 3: 改寫 api/chat.js v30 → v34
  ├── WEEK_GOALS 全部重寫（self W1-3 + money W1-3 + relationship W1-3）
  │   依 Cathy 三本手冊 + 工具二 v3.2b 結構
  ├── 加 getAvailableTool2Pools() 函數
  ├── buildSystemPrompt 加 tool2Section 注入
  ├── 加 Week 3 Day 5 微證據邊界 case
  ├── advanceStudentDay 加跨模組推進邏輯
  ├── 寫 stub: onTrialComplete() / onSelfWeek3CompleteForPlanA() / onPlanBComplete()
  ├── DAMON_CORE 補觸發 #5 完整 5 句 + #6 Step1-Step4 完整原文
  ├── DAMON_CORE 補觸發 #3 走到節點後的 4 訊號分叉路
  └── generateDamonNote prompt 加來源標籤邏輯

Step 4: index.html 不動

Step 5: 不要 push、改完跟 Vivi 說「v34 寫好了、要 review 嗎？」
```

---

## 6️⃣ 驗證 Checklist（Vivi staging 親測時看）

### 6.1 Week 1 行為
- [ ] Day 1-2: AI 拋工具二只用 2A（5 句）、不用 2B / 2C
- [ ] Day 3-4: AI 可以拋 2A 或 2B（混用）、不拋 2C
- [ ] Day 5-6: AI 拋工具二只用 2A（整合用）、不拋 2B / 2C
- [ ] 2A 填完 → AI 做 confirm（「這句話不管誰問什麼時候問答案都一樣嗎？……那就是你的」）→ 觸發 #3 鏈式追問
- [ ] 2B 填完 → AI 直接問「這個模式——它是想保護你什麼嗎？」→ 不 confirm
- [ ] 觸發 #3 走到節點後、AI 依訊號選分叉路（不按順序全問）

### 6.2 Week 2 行為
- [ ] AI 拋工具二只用 2C
- [ ] 2C 填完 → AI 做觸發 #6 Step1（回收）+ Step2（問來源）
- [ ] Step3（反例提問）通常在 Week 2 第 3-4 天才做、不是 2C 填完就立刻做

### 6.3 Week 3 行為
- [ ] AI 不主動使用工具二
- [ ] Day 5 微證據掃描：學員找不到時、AI 回收 Week 1 2A 詞做身體確認

### 6.4 Damon Note 行為
- [ ] 學員選 2A 並 confirm → 那個詞進【關鍵句】候選
- [ ] 學員選 2B → 那個詞進【SC 觀察】、標註「反應模式」
- [ ] 學員選 2C → 那個詞進【還沒碰到的】、標註「Week 2 信念入口」

### 6.5 跨模組推進
- [ ] trial 學員 self week 3 day 6 完成 → 觸發 Day 7 Email、不推進到 money
- [ ] plan_a 學員 self week 3 day 6 完成 → 觸發升級邀請、不推進到 money
- [ ] plan_b 學員 self week 3 day 6 完成 → 自動推進到 money week 1 day 1
- [ ] plan_b 學員 money week 3 day 6 完成 → 自動推進到 relationship week 1 day 1
- [ ] plan_b 學員 relationship week 3 day 6 完成 → 觸發 9 週 Journal Report

### 6.6 Schema
- [ ] migration_009 跑成功、students 表新增 5 個欄位
- [ ] 既有 A001 / A002 等學員資料完整保留（NOT NULL DEFAULT 0/FALSE 不會破壞）

---

## 7️⃣ 風險 + 緩解

| 風險 | 可能性 | 緩解 |
|---|---|---|
| AI 不會切換 2A/2B/2C 池、混用 | 中 | prompt 寫嚴格「today 可用 X 池」+「其他池學員看不到」、Vivi staging 看跟調 |
| AI 把 2B 反應詞誤寫成 SC 觀察 | 中 | Damon Note prompt 加明確分流標籤、Patrick 每天 Prompt review 抽 10 個檢查 |
| plan_b 跨模組推進邏輯有 bug、學員卡某模組 | 中 | 上線前 Vivi 親測 plan_b 假學員、跑 Week 3 Day 6 觸發點看推進對 |
| Week 3 Day 5 邊界 case 拉不到 Week 1 2A 詞 | 中 | 從 Damon Note 【關鍵句】parse、不加新 schema、try-catch 包好失敗 fallback 給通用問句 |
| Cathy 三模組手冊 + v3.2b + Damon Note 內容堆疊、prompt 變超長 | 高 | 預估 system prompt 從 5500 → 7500 tokens、用 prompt caching（v30 spec Layer 1 工程優化已建議過）、cache hit 約 10x 成本降幅 |
| AI 在 Week 1 Day 5-6 整合用 2A 時、跟 Day 1-2 採集 2A 表現混亂 | 中 | direction 明寫「Day 5-6 用 2A 是回收 Week 1 學員填過的詞、不是新採集」 |

---

## 📋 跟其他文件的對齊

本文件對齊：
- `/00-PRODUCT-TRUTH.md` v1.3 Part 2.2（9 週進程、3 模組 × 3 週）+ Part 2.6（雙方案 + 升級補差）
- `/employees/patrick/prompt-design/v3.4/00-工具二_v3.2b.txt`（工具二定稿）
- `/employees/patrick/prompt-design/v3.4/01-Cathy_自我模組三週手冊.docx`
- `/employees/patrick/prompt-design/v3.4/02-Cathy_金錢事業模組三週手冊.docx`
- `/employees/patrick/prompt-design/v3.4/03-Cathy_關係模組三週手冊.docx`
- `/employees/patrick/prompt-design/v3.3/06-chat_v30_spec.md`（v3.0 baseline reference）

下游觸發：
- `/todos/patrick-todo-v3.0.md` Block 1 落地完成、Block 4-7（Brevo / LINE / Stripe）下一波
- `/todos/mike-todo-v1.1.md` 完整 9 週版有具體三模組脈絡可寫文案

---

## 📝 附錄 A｜為什麼不在這份 spec 重寫完整 WEEK_GOALS prompt 文字

**理由**：
1. 完整 prompt 文字會超 500 行、難維護
2. Cathy 手冊 + 工具二 v3.2b 是 single source of truth、不該在 spec 重複
3. Claude Code 落地時直接讀 reference 4 份檔案、依 spec 結構整合、比 spec 預先寫好更靈活

**Claude Code 該做的**：
- 讀 Cathy 三本手冊 + v3.2b
- 對齊本 spec Part 2.1 結構
- 寫 chat.js WEEK_GOALS（self.1-3 + money.1-3 + relationship.1-3）
- 必要時 ping Vivi 確認模糊處（不要硬猜）

---

## 📝 附錄 B｜Damon optional 細節（Vivi 沒採納、不動）

Vivi 確認 Cathy v3.2b 直接落地、Damon 提的 2 個 optional 細節**不動**：

1. ❌ 自我 2A「我是一個感動時很___的人」改「我是一個容易___的人」（Cathy 想留就留、Vivi OK）
2. ❌ 自我 2C 加 2 條家族語錄入口句（Cathy 想留就留、Vivi OK）

未來 Vivi 跟 Cathy 討論修、再排 v3.5。

---

*— Chat.js v34 工程規格 v1.0 ｜ 2026-05-10 —*
*Cathy + Damon + Vivi 三方確認 v3.2b 工具二 + 三模組手冊全部到位*
*等 A001 親測 v30 Day 1-6 穩定、再推 v34*
