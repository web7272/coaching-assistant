# Patrick Changelog Patch（補丁）
**版本**：v2.7 → v2.7.1
**日期**：2026-05-08（晚）
**前一版本**：PATRICK-CHANGELOG-v2.7.md

---

## 🆕 為什麼出這個 patch

組織架構 v1.1 → v1.2 重組職責：

```
從 Daniel 搬過來給你（Patrick）：
└── Prompt 品質抽樣 review（技術層）

從 Daniel 搬走（給 Mike）：
└── 產品數據分析、監督排程、異常警報
   （這些不影響你的工作）
```

這個 patch 只新增**一個職責**：Prompt 品質抽樣 review（技術層）。

其他 v2.7 的工作都不變。

---

## 🆕 新增職責：Prompt 品質抽樣 review（技術層）

### 為什麼是你做？

```
Daniel 原本要做 Prompt review、但：
─→ Daniel 是客服角色、看「對話品質」要的是「品牌口吻」
─→「品牌口吻」是 Vivi 自己最準的判斷
─→ Daniel 接客服已經夠忙

你（Patrick）做技術層：
─→ 你最懂 chat_v22.js 的演算法邏輯
─→ 你能判斷「Stage 升階對不對」「Day 6 七步驟跑對不對」
─→ 這是技術判斷、不是品牌判斷

分工：
─→ Patrick：技術層（Stage / Flow / Algorithm 對不對）
─→ Vivi：品牌層（語氣 / 哲學 / 紅線對不對）
```

### 你要做的具體工作

```
頻率：每天 21:00（自動跑）
取樣：隨機抽 10 個對話

對照規格書檢查（技術層）：
─────────
□ Stage 升階是否符合演算法？
   - Stage 1-5 切換時機對嗎
   - 沒有跳級或卡住

□ 三步循環是否完整？
   - Reflection（回聲）
   - Micro-Validation（輕確認）
   - Probe（往下問）

□ 五個關鍵機制是否觸發？
   - 停頓模擬
   - 深度偵測（「我覺得」「我一直」）
   - 逃避偵測（「不知道」「還好」）
   - 停頓感偵測
   - 模組切換偵測

□ Day 6 七步驟是否正確跑？
   - 鏡像 → 認領 → 神級一題 → 關鍵一刀
   - Open Loop → 張力 → 給方向

□ Damon Note 演算法是否準確？
   - 關鍵句抽取
   - value_words 累積
   - SC 觀察
   - 「明天的入口」

□ Safety 機制是否觸發？
   - 高風險訊息（自殺、健康）
   - 紅線觸發（不誇大療效等）

不是你判斷的（給 Vivi 看）：
─────────
- 像不像 Vivi 的語氣
- 哲學深度夠不夠
- 品牌口吻一致性
```

### 寫的報告

```
存到：/employees/patrick/prompt-reviews/2026-MM-DD.md

格式：
---
日期：2026-MM-DD
抽樣：10 個對話 ID

技術層問題（Patrick 看）：
─────────
- 對話 #1：Stage 1 → 3 跳級、缺少 Stage 2 鋪陳
- 對話 #4：Day 6 第 4 步「關鍵一刀」沒觸發、跳到第 5 步
- 對話 #7：Damon Note 「明天的入口」字串為空
- 對話 #9：模組切換偵測沒觸發、用戶談金錢時 AI 還在自我關係

品牌層樣本（給 Vivi 看）：
─────────
- 對話 #1, #4, #7, #9 抽出「不確定像不像 Vivi」的段落
- Vivi 看完判斷「漂移」與否

技術層問題比例：
─────────
4/10 = 40%（高、需要立刻修演算法）
或
1/10 = 10%（可接受、繼續觀察）

→ 高於 20% → 立刻 ping Vivi
---
```

### 異常處理

```
比例 > 20% → 立刻 ping Vivi + Mike
─────────
- 可能是程式碼有 bug
- 可能是 Prompt 設計有漏洞
- 需要修 chat_v22.js 或調 system prompt

比例 < 20% → 寫日報、不打擾
─────────
- Vivi 早上 daily briefing 看到摘要
- 自己判斷要不要深入看
```

---

## 📁 新增資料夾

```
/See Yourself/
└── /employees/patrick/
    └── /prompt-reviews/        ⭐ v2.7.1 新增
        └── 2026-MM-DD.md       ← 每天一份報告
```

---

## 📋 工作量評估

```
每天 21:00：自動跑、5-10 分鐘系統時間
週報整合：每週日加 5 分鐘
總計：每天 < 10 分鐘額外負擔

不影響 v2.7 既有工作：
─→ chat_v22.js 改動還是優先
─→ schema migrations 還是優先
─→ 雙方案 + 升級邏輯還是優先
```

---

## 📋 跟其他文件的對齊

```
/00-PRODUCT-TRUTH.md v1.2（會在另一份文件更新）
└── Part 6.6 Patrick 影響清單會加：
    「⭐ v1.2 新增：Prompt 品質抽樣 review（技術層）」

/todos/daniel-todo-v1.1.md
└── 已經拿掉「Prompt 品質 review」職責
```

---

## ⚠️ 給 Patrick 的提醒

```
1. 這個 review 是「抽樣」、不是「全部對話」
   ─→ 不要試圖看每一個對話
   ─→ 隨機抽 10 個就好、樣本夠看趨勢

2. 你看的是「技術層」、不是「像不像 Vivi」
   ─→ 演算法、Flow、Stage、機制觸發
   ─→ 「像不像 Vivi」抽出樣本給她自己判斷

3. 高比例異常 = 系統問題、不是 Prompt 文字問題
   ─→ Stage 升階錯 = chat_v22.js 邏輯 bug
   ─→ Day 6 跳步 = 程式碼錯
   ─→ Damon Note 空 = API 整合問題
   ─→ 你修系統、不是你改 Prompt

4. Prompt 文字問題（語氣、口吻）給 Vivi
   ─→ 不要自己改 Prompt
   ─→ 拿樣本給 Vivi、她決定怎麼調
```

---

*— Patrick Changelog v2.7.1 Patch ｜ 2026-05-08 —*
*只新增 Prompt 品質 review（技術層）、其他 v2.7 內容不變*
