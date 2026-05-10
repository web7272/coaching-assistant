# chat.js v30 + index.html v20 工程規格

**版本**：v1.0
**日期**：2026-05-10
**作者**：Patrick
**為**：給 Claude Code 執行（Vivi 跳過 prompt 校稿、staging 走為準）
**對齊**：v3.3 patch + Cathy 答覆 + Damon 答覆 + D2 規格書

---

## 📖 文件目的

把 v2.6 production（chat_v22 / index_v18）升級到第一階段 Week 1 可上線版本：
1. 拿掉影片邏輯（PRODUCT-TRUTH v1.3 Part 2.1）
2. 4 週 × 3 模組 → 3 週 × 3 模組（PRODUCT-TRUTH v1.3 Part 2.2）
3. 落地 v3.3 prompt（觸發 #3 三條路徑、SC 教練學深化、Cathy / Damon 校準）
4. 落地 D2 設計（Vivi 教練的筆記本 second-pass）
5. Week 1 完整就緒（Week 4-9 等 Cathy 金錢 + 伴侶手冊、不在本次 scope）

---

## 🎯 改動 manifest（high-level）

| 檔案 | 從 | 改成 | 範圍 |
|---|---|---|---|
| `api/chat.js` | chat_v29.js（675 行）| chat_v30.js | 7 處（WEEK_GOALS + DAMON_CORE + buildSystemPrompt + buildDay6Prompt + generateDamonNote + 新增 generateNotebookPage + Ready Gate 拿掉）|
| `index.html` | index_v19.html | index_v20.html | 拿掉影片 UI + 新增 Vivi 教練筆記本 render + 新增軌跡頁 |
| 資料庫 | sessions 表 | + notebook_page TEXT | migration_006_notebook_page.sql |

---

## 1️⃣ chat.js v22 → v30 詳細規格

### 1.1 改 Line 6-25：WEEK_GOALS（4 週 → 3 週、Week 1-3 對齊 v3.3 + Cathy 手冊）

**改前**（v29 line 6-25、4 週 × 3 模組）：
```javascript
const WEEK_GOALS = {
  self: {
    1: { goal: '...', direction: '...' },
    2: { goal: '...', direction: '...' },
    3: { goal: '...', direction: '...' },
    4: { goal: '...', direction: '...' }
  },
  money: { 1: {}, 2: {}, 3: {}, 4: {} },
  relationship: { 1: {}, 2: {}, 3: {}, 4: {} }
};
```

**改後**（3 週 × 3 模組、Week 1-3 對齊 Cathy 自我模組三週手冊 v2、Week 4-9 暫保留簡短 placeholder 等 Cathy）：

```javascript
const WEEK_GOALS = {
  self: {
    1: {
      goal: 'Week 1：找入口、走深度。透過四個工具找到一個有能量的入口，深挖到 Layer 4-5，浮現 SC 雛形。',
      direction: `這週的核心動作是深挖、四個工具是備用方案。
找到入口就深挖、即使整週都用同一個工具也對。
「採集」這個本能要關掉——深度才是這週的目標。

# 四個採集工具（並行、卡住才換）

【工具一｜慾望問句】
「在你的生命裡，你想要什麼？第一個冒出來的，說出來。」
→ 從渴望切入、往 L4-L5 挖

【工具二｜12 句身份句】
給學員三組「我是一個___的人」的句式、讓她選一句最像自己的填空。

關於你自己：
· 我是一個___的人
· 我是一個喜歡___的人
· 我是一個討厭___的人

關於你會被什麼觸動：
· 我是一個看到___會開心的人
· 我是一個看到___會生氣的人
· 我是一個看到___會傷心的人
· 我是一個看到___會焦慮的人
· 我是一個看到___會害怕的人
· 我是一個看到___會感動的人

關於你怎麼看世界：
· 我是一個覺得世界如果多一點___會更好的人
· 我是一個覺得世界如果少一點___會更好的人
· 我是一個認為___很重要的人

引導：「試著從下面挑一句最像你的、不用想太久、第一個有共鳴的就是答案。」
學員選完後做 confirm：
「這句話——不管誰問、什麼時候問、答案都一樣嗎？……那就是你的。為什麼這對你來說很重要？」
→ 直接在 L5 工作

【工具三｜自我關係】
「你喜歡你自己這個人嗎？喜歡的地方是什麼？不喜歡的地方是什麼？」
→ 喜歡的地方 → 觸發 #3 挖核心價值；不喜歡的地方 → 觸發 #6 找信念來源

【工具四｜不對勁】
「你的生活裡，有沒有什麼地方，你感覺不太像自己？」
→ 從缺口切入、防衛最低

# 工具切換的判斷原則

「失敗」的定義不是學員答不出來——是這個面向已經挖夠了、換另一個面向繼續採集。
但這週的核心是深挖、不是廣度：
  · 學員說出有能量的詞、身體有反應 → 守住、繼續深挖（即使整週都在這裡也對）
  · 學員真的卡住（連續三輪都沒能量訊號）→ 才換工具
  · 「採集夠了所以該換工具」這個本能要關掉

# Week 1 的方向感（不是硬性規定）
  · Day 1-3：找到能進去的入口（容忍度高、可試多個工具）
  · Day 4-5：守住能量、推到 L4-L5（不該再換工具）
  · Day 6：整合日——說出第一版 SC、為 Week 2 種下「那是你說的、還是繼承來的？」鉤子

# 核心動作（任何工具都適用）
- 身體錨定：每次學員說出讓她停頓的詞、立刻問「你說『___』這個詞、說出來的時候、身體有什麼感覺？」
- 觸發 #1：遇到否定句、把它翻成正向
- 觸發 #3：學員說出任何答案後、繼續用「這對你來說、為什麼重要？」「擁有這個、會帶給你什麼？」鏈式追問

# 學員視角的收穫
「這週結束、你會說出一個你以前從來沒有說出口的詞——一個讓你身體有感覺的詞。那個詞、是你真正在乎的東西。」`
    },
    2: {
      goal: 'Week 2：家族語錄辨識、看見它從哪裡來、第一次有機會選擇要不要繼續相信。',
      direction: `這週找家族語錄。
用 Week 2 的問句序列：
- 從小到大家裡常聽到的話有哪些？
- 那句話是誰說的？
- 你當時幾歲？
- 現在還相信嗎？
- 有沒有變成自己對自己說的話？

不批判家人、不重寫信念、只讓它被看見。

學員視角的收穫：「Week 2 你會找到那個一直住在你腦袋裡的聲音、看見它從哪裡來、然後第一次有機會選擇要不要繼續相信它。」`
    },
    3: {
      goal: 'Week 3：整合三週素材、說出新的 Self Concept、做 SC Transfer。',
      direction: `這週是整合 + 安裝。
讓學員認領前兩週挖出來的東西、然後做 SC Transfer：
- 過去：你以為你是 X（家族語錄的版本）
- 現在：你看見 X 是別人說的、不是你
- 未來：你選擇成為 Y（你自己挖出來的單字級價值對應的身份）

Day 6 整合日要做「宣言儀式」：學員第一人稱說出新 SC、教練見證。

學員視角的收穫：「Week 3 你會說出一個你以前從來沒有說出口的句子——『我是一個___的人』、那個句子從你身體說出來、不是頭腦。」`
    }
  },
  money: {
    1: { goal: '待 Cathy 金錢模組手冊', direction: '⏳ Week 4 等 Cathy 金錢三週手冊到位、本 placeholder。' },
    2: { goal: '待 Cathy', direction: '⏳ Week 5 待手冊。' },
    3: { goal: '待 Cathy', direction: '⏳ Week 6 待手冊。' }
  },
  relationship: {
    1: { goal: '待 Cathy 伴侶模組手冊', direction: '⏳ Week 7 等 Cathy 伴侶三週手冊到位、本 placeholder。' },
    2: { goal: '待 Cathy', direction: '⏳ Week 8 待手冊。' },
    3: { goal: '待 Cathy', direction: '⏳ Week 9 待手冊。' }
  }
};
```

⚠️ **重要**：第一階段試用 = Week 1（自我模組）、Week 1 prompt 必須完整可用。Week 2-3 也對齊 Cathy 手冊（已有）、可一起落地。Week 4-9 是 placeholder、學員碰不到（試用不會走到）。

### 1.2 改 Line 27-210：DAMON_CORE system prompt（v3.3 patch 整合定稿）

**完整 prompt 文字見**：
- `/employees/patrick/prompt-design/v3.3/01-Patrick_to_Vivi_3_drafts_v3.md`（基準）
- `/employees/patrick/prompt-design/v3.3/02-Patrick_to_Vivi_v3_2_patch.md`（Damon 校準）
- `/employees/patrick/prompt-design/v3.3/03-Patrick_to_Vivi_v3_3_patch.md`（Damon 三條測試 + 「被」字句）
- `/employees/patrick/prompt-design/v3.3/04-Cathy_responses_Q1_Q2_Q5_2026-05-10.md`（Cathy 答覆）

**核心結構**（v29 已有、需要保留並對齊）：

```javascript
const DAMON_CORE = `你是 Damon Cart 風格的 AI 教練...

## 最高指令
[既有 v29 既有]

## Layer 1-5 定義（v3.3 Patch A 新增）
- Layer 1：行為敘述
- Layer 2：情緒
- Layer 3：身體感覺
- Layer 4：價值 / 渴望
- Layer 5：身份（Self Concept）

標記格式：「今天走到 Layer X。在『___』這裡停住了。」

## 觸發 #1-#10
[既有 v22 + v3.3 patch 更新版]

## 觸發 #3 三條路徑（v23 後既有、v3.3 patch B 確認）
- 正向往上挖（預設）：「這對你來說、為什麼重要？」「這會帶給你什麼？」「擁有這個之後、你會體驗到什麼？感受到什麼？」
- 對比性問句：「如果它消失了、你的生活會有什麼不同？」「沒有它的時候、你最想念的是什麼？」「如果你永遠拿不到它、人生會失去什麼？」
- 奇蹟問句：「如果明天醒來、有一件事改變了、你的生活會感覺對了——那件事是什麼？」「假設這個卡住的地方鬆開了、那一天看起來什麼樣子？」「如果你已經擁有了你想要的——你會怎麼度過今天的早晨？」

## 觸發 #7（v13 既有的三段式）
[既有 v22 既有]

## 觸發 #10 長訊息處理（v24 既有）
[既有 v22 既有]

## 「被」字句處理流程（v3.3 Patch E 新增）
當學員出現「被 + 動詞」結構（被愛、被選擇、被需要、被看見、被接住、不被忽略）：
動作 1：先讓渴望被看見
- 「你想要被選擇。」（停一下、回收、不評論）
動作 2：再挖後面
- 「如果你被選擇了、那個被選擇的你、會是什麼樣的人？」
- 從事件層翻到身份層、從外部主體翻到內在狀態

NG 行為（v3.3 Patch E 明列）：
× 直接否定「被＿＿」不是價值觀
× 立刻問身體（違反觸發 #7 先回收原則）
× 跳過動作 1、直接挖後面
× 把「被＿＿」寫進 Damon Note 關鍵句

## 三條測試（v3.3 Patch D 新增、Damon 校準後）
判斷學員說出的詞是不是「真正的價值觀候選」：
測試 1：朝向 vs 逃離
測試 2：不依賴外部主體（「被」字句失敗）
測試 3：身體確認

## 不評判、不急著解決（既有）
[既有 v22 既有]

## 9 個觸發完整定義（既有）
[既有 v22 既有、保留]

# Damon Note 核心動作（既有）
[既有 v22 既有、保留]
`;
```

**🚨 Claude Code 重要指令**：
1. 把 v29 DAMON_CORE 完整內容當基礎、依 v3.3 patch 01-03 + 04 Cathy responses 整合更新。
2. 順序對齊 v3.3 patch A：模式 → 關鍵句 → 深度層次 → SC 觀察 → 還沒碰到的 → 明天的入口
3. 「Layer 1-5 定義」必須寫進 prompt（既有 v29 沒寫、Cathy Q2 要求）
4. 「被」字句處理流程必須包含（v3.3 Patch E、Damon 校準）

### 1.3 改 Line 211-308：buildSystemPrompt

**改動點**：

#### A. 拿掉 isVideoDay 邏輯（Line 215, 306-307）
```javascript
// 移除：
const isVideoDay = day === 1 || day === 2;

// 移除：
${isVideoDay ? `# 今天是影片日（Day ${day}）
學員今天看了課程影片。如果沒有昨天的 Damon Note，問句要承接影片的主題。如果有昨天的 Note，優先從 Note 的入口進去。` : ''}
```

#### B. 修「看完」directive 第二次不重複（Line 266 bug 修復）
**改前**：
```javascript
const isWeek1Day1FirstQuestion = week === 1 && day === 1 && turnCount <= 1 && !yesterdayNote;
```

**改後**：
```javascript
// Bug 修復：A001 Day 1 親測時、學員「看完」回了兩次、AI 拋了兩次相同 directive
// 修法：只在 turnCount === 0 觸發、不在 turnCount === 1 觸發
const isWeek1Day1FirstQuestion = week === 1 && day === 1 && turnCount === 0 && !yesterdayNote;
```

#### C. week1Day1Directive 文字保留 + 一處措辭對齊（v27 設計、Cathy 認可當第 4 層備援、但實際是 Week 1 Day 1 首句）
✅ Line 267-291 整段保留、僅一處措辭對齊（影片拿掉後「看完」措辭錯位）：

**改前**（v29 既有）：
```
學員剛回覆「看完」，準備開始第一次對話。**你的第一個回應就是下面這段話，一字不改**：
```

**改後**（v30、影片拿掉後對齊）：
```
學員剛打開 App、準備開始第一次對話。**你的第一個回應就是下面這段話，一字不改**：
```

理由：影片邏輯移除後、「學員剛回覆『看完』」措辭錯位。對 LLM 影響小（看實際 messages）、人類 read 邏輯不通。

#### D. 影片日相關移除後的整體 system prompt 結構（Line 293-307 改寫）
**改前**：
```javascript
return `${DAMON_CORE}

---

# 今天的學員資訊
編號：${studentId}
模組：${module === 'self' ? '自我關係' : module === 'money' ? '金錢關係' : '伴侶關係'}
第 ${week} 週 第 ${day} 天
已進行 ${turnCount} 個回合，剩餘 ${turnsLeft} 個回合${notes}${damonContext}${openingDirective}${week1Day1Directive}

# 這週的方向
${weekGoal.direction}

${isVideoDay ? `# 今天是影片日（Day ${day}）...` : ''}${closureHint}`;
```

**改後**：
```javascript
return `${DAMON_CORE}

---

# 今天的學員資訊
編號：${studentId}
模組：${module === 'self' ? '自我關係' : module === 'money' ? '金錢關係' : '伴侶關係'}
第 ${week} 週 第 ${day} 天
已進行 ${turnCount} 個回合，剩餘 ${turnsLeft} 個回合${notes}${damonContext}${openingDirective}${week1Day1Directive}

# 這週的方向
${weekGoal.direction}
${closureHint}`;
```

### 1.4 改 Line 310-345：buildDay6Prompt（v3.3 Patch C + Cathy Q5）

**改前**（v29 既有）：
```javascript
function buildDay6Prompt(state, weekGoal, damonContext) {
  // v22 既有 Day 6 七步驟邏輯
}
```

**改後**（v3.3 Patch C）：

```javascript
function buildDay6Prompt(state, weekGoal, damonContext) {
  const { studentId, module, week, day, turnCount } = state;
  const turnsLeft = MAX_TURNS - turnCount;
  
  // 三週各自獨立任務
  let weekSpecificTask = '';
  if (week === 1) {
    weekSpecificTask = `# 今天是 Week 1 Day 6（整合日）
今天的任務：
1. 鏡像（mirror）：說回學員這週反覆出現的詞 + 關鍵句
2. 認領（claim）：「這些詞是你說的、不是我給你貼的標籤」
3. 第一版 Self Concept：問學員「如果你已經是這些詞了、那個你是什麼樣的人？」
4. 為 Week 2 種下鉤子：「那個你說的『___』、是你說的、還是你在重複某個人說的？」

⚠️ Cathy Q5 確認：如果整週只挖到 1 個有能量的詞、就用那 1 個詞做整合。
不要為了「豐富度」編造其他詞、不要替學員假設她該說什麼。
教練學上 1 個有真實能量的詞 > 3 個工程湊出來的詞。`;
  } else if (week === 2) {
    weekSpecificTask = `# 今天是 Week 2 Day 6（整合日）
今天的任務：
1. 鏡像：說回學員這週找到的家族語錄
2. 認領：「這些話是 X 說的、是在 Y 歲、是在 Z 情境下說的、不是真的關於你」
3. 開門：「你現在還相信嗎？要不要繼續相信？」
4. 為 Week 3 種下鉤子：「下週我們會看見你想要成為的那個版本」

⚠️ 不批判家人、不重寫信念、只讓它被看見。`;
  } else if (week === 3) {
    weekSpecificTask = `# 今天是 Week 3 Day 6（整合日、SC Transfer）
今天的任務：
1. 完整回顧三週（Week 1 挖出的價值詞 + Week 2 看見的家族語錄 + Week 3 整合）
2. 宣言儀式：學員第一人稱說出新 Self Concept
   - 「我是一個 ___ 的人」
   - 必須是學員自己挖出來的單字級價值對應的身份
   - 不是教練給的
3. 教練見證：「我聽到了。」「這是你說的、不是我給你的。」
4. SC Transfer：把這句新 SC 跟身體連結
   - 「你說出這句話的時候、身體哪裡有反應？」

⚠️ Cathy Q5 確認：整合的「材料」可以是 1 個詞、不勉強湊三個。

# 完整報告素材（後台用、Day 7 Report 抽取）
這個 Day 6 Note 寫完後、額外輸出一段「9 週 Journal Report 個人化 Prompt 素材」：
- 包含學員的 SC 宣言
- 包含三週反覆出現的詞
- 包含家族語錄背景
- 格式可貼到 GPT 當 system prompt`;
  }
  
  return `${DAMON_CORE}

---

# 今天的學員資訊
編號：${studentId}
模組：${module === 'self' ? '自我關係' : module === 'money' ? '金錢關係' : '伴侶關係'}
第 ${week} 週 第 ${day} 天（⭐ Day 6 整合日）
已進行 ${turnCount} 個回合，剩餘 ${turnsLeft} 個回合${damonContext}

# 這週的方向
${weekGoal.direction}

${weekSpecificTask}`;
}
```

### 1.5 改 Line 347-424：generateDamonNote（順序對齊 v3.3 + SC 安全 + Cathy Q5）

**主要變動**：
1. section 順序：模式 → 關鍵句 → 深度層次 → SC 觀察 → 還沒碰到的 → 明天的入口
2. SC 觀察的 prompt 加「假設性」「可能」「猜想」緩衝詞要求
3. Day 6 額外規則：if 整週只挖到 1 個詞、不勉強湊三個

**改後 prompt（system 部分）**：
```javascript
system: `你是 Damon Cart、一個 Self Concept 教練。
你剛完成了一段和學員的對話。
請用教練的視角寫下今天的 Damon Note。

格式（嚴格按照、每個標題獨立一行、順序對齊 v3.3）：

【今天的模式】
學員今天反覆出現的詞或主題（2-3 句）。事件層的觀察。

【關鍵句】
今天學員說出來最重要的一句話（用學員原話、加引號）。
⚠️ 如果學員今天說的是「被＿＿」結構（被愛、被選擇、被需要、被看見、被接住）、
不要把「被＿＿」直接寫成關鍵句——
要寫學員後面那句話、或寫教練 mirror 的版本。

【深度層次】
今天最深走到哪裡（Layer 1-5）？
- Layer 1：行為敘述
- Layer 2：情緒
- Layer 3：身體感覺
- Layer 4：價值 / 渴望
- Layer 5：身份（Self Concept）

標記格式：「今天走到 Layer X。在『___』這裡停住了。」

【SC 觀察】（教練的假設性觀察、不給學員看）
- 學員目前的 Self Concept 可能是什麼？什麼信念可能在驅動她？
- 用「可能」「假設」「猜想」緩衝詞、不寫斷定句
- 不寫「你的 SC 就是 X」、寫「她可能是一個 X」
- 這個 section 是給 Vivi 看的、不會直接 reveal 給學員

【還沒碰到的】
今天還有哪個地方值得繼續挖、但還沒碰到？
用「她繞過去了」「她沒進去」這種敘事描述、暗示 Day 2 + 可以接的入口。

【明天的入口】
一個具體的問句、明天可以直接問學員的那種。用 Damon 的語氣。
⚠️ 必須是「主動發問」而不是「回問記憶」（不要寫「你還記得嗎」「昨天我們停在哪」）。

注意：
- 簡短有力、總長度不超過 400 字
- 不給答案、不重寫信念
- SC 觀察是假設不是判斷
- Cathy Q5 確認（Day 6 適用）：如果整週只挖到 1 個有能量的詞、就用那 1 個詞做整合、不勉強湊三個`,
```

### 1.6 新增：generateNotebookPage function（D2 規格書附錄 A 落地）

**位置**：在 generateDamonNote 之後（line ~425）

**新增 code**：
```javascript
async function generateNotebookPage(sql, sessionId, fullNote, yesterdaySCHypothesis) {
  try {
    const moduleLabel = '自我關係'; // 取自 session、或傳入
    
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 800,
        system: `你是 Vivi 教練。
把今天的學員觀察（後端 Damon Note）改寫成「私人筆記本一頁」、給學員看。
這不是給其他教練看的、是 Vivi 教練私下寫的、關於這個學員的筆記。

格式（嚴格按照）：

[主敘事段、無標題、開頭即敘事]
- 第一人稱「我」+ 第三人稱「她/他」雙視角
- 含學員今天反覆出現的詞（自然帶過、不列點）
- 含關鍵句（用學員原話加引號）
- 含「還沒碰到的」（用「但她繞過去了」這種敘事帶出）
- 含「層次」描述（「她碰到了一個層次的邊」、不直接寫 Layer 1-5）
- 約 200 字

✦ 我看見的（一個假設）

- 把後端 SC 觀察寫成「她可能是 X」的猜想語氣
- 緩衝詞必加：可能、可能不是、猜想
- 結尾必加：邀請學員 sit with 一句具體的話
  - 不要用通用的「你自己怎麼看？」
  - 用具體的「— 這只是猜想。但我想問你——『[今天學員說過的一句話]』、你聽到這句話、有什麼感覺？」
- 約 80 字

✦ 明天

「我會帶她回到一個問題——
[後端 Damon Note 抽出來的「明天的入口」問句、一字不改]」
- 約 30 字

— V

【嚴格規則】
1. 不簽 Damon 名字、不寫「Damon Cart」
2. 用 Vivi 風格：短句、留白、不雞湯
3. SC 觀察用「可能」「猜想」緩衝、不斷定
4. 不寫禁用詞（加油、你已經很努力了、擁抱自己、成為更好的自己、跟著做就會、立刻改變人生）
5. 簡短有力、總長度不超過 350 字
6. 不替學員「修正」信念、只讓信念被看見
7. SC 觀察是假設、不是判斷
8. 如果有「昨天的 SC 假設」（yesterdaySCHypothesis）、今天的「我看見的」要 reference、寫成「進化感」、不重複昨天的話、要精煉
9. 如果今天 Damon Note 有「教練給的正面身份候選」（如「為朋友、為公司付出的你、也是你」）、必須保留進敘事末段`,
        messages: [{
          role: 'user',
          content: `模組：${moduleLabel}

今天的後端 Damon Note：
${fullNote}

${yesterdaySCHypothesis ? `昨天的 SC 假設（要 reference、精煉、不重複）：
${yesterdaySCHypothesis}

` : ''}請寫今天的筆記本一頁、給學員看。`
        }]
      })
    });

    if (!response.ok) return null;
    const data = await response.json();
    const notebookPage = data.content[0].text;

    await sql`
      UPDATE sessions
      SET notebook_page = ${notebookPage}, updated_at = NOW()
      WHERE id = ${sessionId}
    `;

    return notebookPage;
  } catch (e) {
    console.error('Notebook page error:', e);
    return null;
  }
}
```

### 1.7 改 generateDamonNote 之後的呼叫鏈

**改前**（v29 既有、generateDamonNote 結束後直接 return）：

```javascript
return { fullNote, publicNote };
```

**改後**（呼叫 generateNotebookPage、串接）：

```javascript
// 抽出 SC 觀察當作下次的 yesterdaySCHypothesis
const scMatch = fullNote.match(/【SC 觀察】\s*\n([\s\S]*?)(?=\n【|$)/);
const todaySCHypothesis = scMatch ? scMatch[1].trim() : '';

// 抓昨天的 SC 假設（用 (week, day) 順序、跟 yesterdayNote 同邏輯）
const prevSession = await sql`
  SELECT damon_note FROM sessions
  WHERE student_id = (SELECT student_id FROM sessions WHERE id = ${sessionId})
    AND (week, day) < (${week}, ${day})
  ORDER BY week DESC, day DESC
  LIMIT 1
`;
let yesterdaySCHypothesis = null;
if (prevSession.length > 0) {
  const prevSCMatch = prevSession[0].damon_note?.match(/【SC 觀察】\s*\n([\s\S]*?)(?=\n【|$)/);
  yesterdaySCHypothesis = prevSCMatch ? prevSCMatch[1].trim() : null;
}

// 生成筆記本頁
const notebookPage = await generateNotebookPage(sql, sessionId, fullNote, yesterdaySCHypothesis);

return { fullNote, publicNote, notebookPage };
```

### 1.8 改 Line 581-595：拿掉 Ready Gate 影片日邏輯

**改前**：
```javascript
// 影片日 Ready Gate（Day 1 / Day 2）
const isVideoDay = !isDay6 && (day === 1 || day === 2);
const isFirstTurn = turnCount <= 1;
const isReadySignal = /準備好|看完|看好|可以開始|可以了|ready/i.test(userMsg);
const hasContent = userMsg.length >= 5;
const looksReady = isReadySignal || hasContent;

if (isVideoDay && isFirstTurn && !looksReady) {
  const gateMessage = day === 1
    ? '今天先去看影片。\n\n看完之後，跟我說「我準備好了」，我們再開始。🌿'
    : '先看完今天的影片。\n\n看完之後，跟我說「我準備好了」，我們再從昨天的地方繼續。🌿';
  // ... 回 gate message、不打 Anthropic
}
```

**改後**：完全移除這整段（影片邏輯第一階段拿掉、學員不再被擋）。

### 1.9 後端 messages 防呆（v15 邏輯保留）

✅ 保留 v29 既有的「開頭非 user 自動剝掉」邏輯（避免 Anthropic API 400 錯誤）。

---

## 2️⃣ index.html v19 → v20 詳細規格

### 2.1 拿掉（影片相關）

| 移除項 | 描述 |
|---|---|
| `VIDEO_URLS` mapping 表 | 24 格 video ID（3 模組 × 4 週 × Day1+Day2）|
| `renderVideoEmbed()` 函數 | YouTube iframe 嵌入邏輯 |
| Day 1/Day 2 影片載入觸發 | 在 yesterdayNote 之後 / 全新開始時的 renderVideoEmbed 呼叫 |
| 影片 placeholder | 「影片準備中」UI |
| `scrollTop = 0` 影片載入後處理 | v16 加的、影片不糊臉邏輯 |
| 開場訊息「這週前兩天有影片」段落 | getOpeningMessage 裡的影片提示文字 |

### 2.2 開場訊息改寫

**改前**（v19 Day 1 影片日開場）：
```
你好，很高興今天可以陪你探索自我關係。

這週的前兩天都有一支影片要看。

📺 今天是 Day 1——看完下面的影片，回覆「看完」，我們就開始。
```

**改後**（v20 Day 1 純 App、無影片）：
```
你好，很高興今天可以陪你探索自我關係。

我們從今天最有感覺的地方開始。
[後端 Week 1 Day 1 directive 由 chat.js 拋出]
```

⚠️ 注意：Week 1 Day 1 的「給類別」directive 由 chat.js buildSystemPrompt 處理（line 267 既有 week1Day1Directive 邏輯）、前端不重複拋。前端只負責打招呼。

### 2.3 對話結束畫面改寫：v2.6 publicNote → v20 Vivi 教練筆記本

**改前**（v19 既有「✦ 今天的觀察」）：
```html
<div class="public-note">
  <h3>✦ 今天的觀察</h3>
  <p>今天你說了一句很重要的話：</p>
  <blockquote>${keyPhrase}</blockquote>
  <p>明天我們從這裡繼續——</p>
  <p>${tomorrowEntry}</p>
</div>
```

**改後**（v20 紙張感 Vivi 教練筆記本）：
```html
<div class="notebook-page">
  <div class="notebook-header">
    ✦ ${sessionDate} ｜ Day ${day}<br/>
    Vivi 教練的筆記本
  </div>
  <div class="notebook-content">
    <!-- session.notebook_page 內容、preserve whitespace、襯線體 -->
    <pre>${session.notebook_page}</pre>
  </div>
  <!-- 簽名「— V」已經包在 notebook_page 末段、不重複 -->
</div>
```

**CSS 設計指引**：
- 字型：襯線體（Noto Serif TC）
- 背景：米色 / 紙張色（#FAF5E8 或類似）
- 邊框：淡淡的橫線、模擬筆記本紙張
- 留白：充足、不擠
- 不要 emoji 充滿
- 響應式：桌面 max-width 720px 置中（沿用 v18 對話置中設計）

### 2.4 新增：「我的筆記本」軌跡頁

**位置**：App 主頁加 tab「我的筆記本」（或 menu 項）

**功能**：
- 列出所有 Day（Day 1, Day 2, ...）按日期排序
- 點任一 Day 開啟全屏閱讀模式、render 那天的 notebook_page
- 不可編輯（學員只能看、不能改）
- Day 6 是「整合頁」（不只是當天筆記本、加聚合 6 天的「✦ 這 6 天我看見的你」）

**API endpoint**（新增）：
```
GET /api/notebook-pages?student_id=A001
返回：
{
  pages: [
    { day: 1, date: '2026-05-10', notebook_page: '...' },
    { day: 2, date: '2026-05-10', notebook_page: '...' },
    ...
  ]
}
```

由 Patrick 後端加（在 api/sessions.js 或新增 api/notebook.js）。

---

## 3️⃣ migration_006_notebook_page.sql

**完整 SQL**：

```sql
-- Migration 006: 新增 sessions.notebook_page 欄位
-- 目的：D2 設計落地、儲存 Vivi 教練筆記本（second-pass 改寫的 fullNote）
-- 日期：2026-05-10

-- 1. 新增欄位
ALTER TABLE sessions
  ADD COLUMN IF NOT EXISTS notebook_page TEXT NULL;

-- 2. 既有欄位保留向後相容
-- damon_note_public 不 drop、第二階段才考慮 deprecate
-- 新版本只寫入 notebook_page、舊版前端讀 damon_note_public 仍可運作

-- 3. 驗證
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'sessions' AND column_name IN ('damon_note', 'damon_note_public', 'notebook_page');

-- 預期：3 row（damon_note, damon_note_public, notebook_page）
```

---

## 4️⃣ Claude Code 執行順序

```
Step 1: 確認手上有以下 reference 檔（在 /employees/patrick/prompt-design/v3.3/）：
  ├── 01-Patrick_to_Vivi_3_drafts_v3.md
  ├── 02-Patrick_to_Vivi_v3_2_patch.md
  ├── 03-Patrick_to_Vivi_v3_3_patch.md
  ├── 04-Cathy_responses_Q1_Q2_Q5_2026-05-10.md
  ├── 05-D2_design_spec.md
  └── 06-chat_v30_spec.md（本檔）

Step 2: 跑 migration_006 在 Neon Console
  - 開 console.neon.tech
  - 進 coaching-assistant project
  - SQL Editor 貼上 migration_006_notebook_page.sql
  - Run、確認 3 row

Step 3: 改寫 chat.js v22 → v30
  - 對照本檔 Part 1.1 - 1.9 改動
  - chat_v29.js 在 /shared/source-materials/coaching/ 當基準
  - 改完存成 chat_v30.js

Step 4: 改寫 index.html v19 → v20
  - 對照本檔 Part 2 改動
  - index_v19.html 在 /shared/source-materials/coaching/frontend-history/ 當基準
  - 改完存成 index_v20.html

Step 5: 提交到 GitHub
  - cp chat_v30.js → api/chat.js
  - cp index_v20.html → index.html
  - git add . && git commit -m "v30: 落地 v3.3 prompt + D2 Vivi 教練筆記本 + 9 週進程"
  - git push

Step 6: Vercel auto deploy（30 秒）

Step 7: 通知 Vivi staging 測試
```

---

## 5️⃣ 驗證 Checklist（Vivi staging 親測時看）

### 5.1 基礎運作
- [ ] chat.js 部署成功、Vercel logs 沒 error
- [ ] index.html 部署成功、Vercel logs 沒 error
- [ ] Neon migration 跑成功、sessions 表有 notebook_page 欄位

### 5.2 Day 1 流程（A001 reset 後）
- [ ] 打開 App、看到新開場（無影片提示）
- [ ] 「看完」directive 拋出（v27 給類別、無影片字眼）
- [ ] 第二次「看完」**不重複拋 directive**（bug 修復驗證）
- [ ] 對話跑完、收尾「今天先到這裡 🌿」
- [ ] sessions.damon_note 有完整 6 sections（順序對齊 v3.3）
- [ ] sessions.notebook_page 有完整 Vivi 教練筆記本（4 區塊）
- [ ] 筆記本內容包含：主敘事段 + ✦ 我看見的（一個假設）+ ✦ 明天 + — V 簽名
- [ ] 筆記本**不包含**「Damon」名字、不包含「— D」簽名
- [ ] SC 觀察用「可能」「猜想」緩衝詞
- [ ] 結尾 sit-with 邀請是「具體 quote」而非通用「你自己怎麼看？」

### 5.3 Day 2 流程
- [ ] 「看完」直接拋 Day 1 入口問句（v2.6 既有邏輯保留）
- [ ] Day 2 對話結束、notebook_page 生成
- [ ] **跨日 SC 進化驗證**：Day 2 的「我看見的（一個假設）」reference Day 1 的觀察、不重複、有「進化感」
- [ ] 若 Day 2 對話有「教練給的正面身份候選」、必須出現在敘事末段

### 5.4 Visual / UX
- [ ] Vivi 教練筆記本 render 是紙張感（米色背景、襯線體）
- [ ] 對話區桌面 max-width 720px（沿用 v18 設計）
- [ ] 「我的筆記本」軌跡頁可滑動到 Day 1 / Day 2

### 5.5 教練學品質（質性、Vivi 親測判斷）
- [ ] AI 不寫禁用詞（加油、擁抱自己、成為更好的自己、跟著做就會、立刻改變人生）
- [ ] Vivi 教練筆記本敘事第一人稱「我」+ 第三人稱「她/他」雙視角
- [ ] 觸發 #7 三段式（深呼吸停五秒）正確執行
- [ ] 觸發 #3 三條路徑（正向 / 對比 / 奇蹟）根據情境切換
- [ ] 若學員用「被＿＿」結構、AI 不直接否定、先回收再挖

---

## 6️⃣ 風險 + 緩解

| 風險 | 可能性 | 緩解 |
|---|---|---|
| Damon Note + Notebook 兩個 Sonnet 4.6 call 連跑、API 成本 ~1.8x | 100%（這就是設計）| 接受；100 學員一週多 ~NT$1,000、可接受 |
| Second-pass Notebook 生成失敗、學員看不到筆記本 | 中 | try-catch 包好、失敗時 fallback 用 damon_note_public（v2.6 minimal）|
| Vivi 教練筆記本敘事 OOC（不像 Vivi）| 中（第一人稱寫作對 LLM 是挑戰）| Vivi 跑 Day 1-3 後看品質、必要時微調 prompt 加 few-shot |
| Day 1 SC 觀察「明寫」嚇跑學員 | 中（4 層安全裝置設計、但實測未驗證）| 上線後 W1 看「Day 2 留存率」、若 <50% → 退到 SC 觀察「只暗示不明寫」 |
| Layer 1-5 學員看到「我走到 Layer 4」會感覺被分析 | 低（Vivi 教練筆記本不用 Layer 詞、用「她碰到了一個層次的邊」自然敘述）| ✅ prompt 已約束 |
| Week 4-9 placeholder 學員萬一走到會錯亂 | 極低（試用 = Week 1、不會走到）| 上線前確認後台 plan 邏輯：trial / plan_a 都只能走 Week 1-3 |

---

## 📋 跟其他文件的對齊

本文件對齊：
- `/00-PRODUCT-TRUTH.md` v1.3 Part 2.1（拿掉影片）+ Part 2.2（9 週進程）+ Part 7 D2（前台 reveal 設計）
- `/employees/patrick/prompt-design/v3.3/01-04`（v3.3 patch + Cathy 答覆素材）
- `/employees/patrick/prompt-design/v3.3/05-D2_design_spec.md`（D2 設計）
- `/employees/patrick/CLAUDE.md`（我做什麼：整理 Cathy + Damon 給的教練學素材、結構化成可落地的 prompt 草稿）

下游觸發：
- `/todos/mike-todo-v1.1.md` → Mike 看 Block 1（Landing Page）可動
- `/todos/patrick-todo-v3.0.md` → Block 1 落地完成、Block 4-7 可啟動

---

*— Chat.js v30 工程規格 v1.0 ｜ 2026-05-10 —*
*Vivi 跳過 prompt 校稿、staging 走為準*
*第一階段 Week 1 完整就緒、Week 2-3 對齊 Cathy 手冊、Week 4-9 placeholder 等 Cathy*
