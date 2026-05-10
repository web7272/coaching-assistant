# Patrick（產品系統 + Prompt 落地 + 工程整合 + D7 監控）待辦清單

**版本 v3.0 | 2026-05-10**
**前一版本**：v2.6（2026-05-03）+ PATRICK-CHANGELOG-v2.7 / v2.7.1-patch / v2.7.2-patch
**對齊**：PRODUCT-TRUTH v1.3 / COMPANY-RULES v1.1 / Master TODO v1.1

---

## 🆕 v3.0 跳階說明

```
v2.6 → v3.0：對齊 PRODUCT-TRUTH v1.3 真相、Patrick 搬到 Cowork

⚠️ 重大變動（整合 v2.7 / v2.7.1-patch / v2.7.2-patch）：

1. 產品結構：3 模組 × 4 週（12 週）→ 9 週進程（3 模組 × 3 週濃縮版）
2. 試用：免費試用 1 週 = 自我關係 Week 1（6 天問答 + Day 7 Report）
3. 方案：三方案（5K / 8K / 12K）→ 雙方案 NT$3,000 / NT$4,500（限時補差升級）
4. Email 服務：Resend → Brevo
5. 影片邏輯：第一階段拿掉、純 App
6. 通知通道：新增 LINE Bot、學員試用時選 LINE / Email 之一
7. 新增職責 v2.7.1：每天 21:00 Prompt 品質抽樣 review（技術層）
8. 新增職責 v2.7.2：每週寫工程整合進度週報（D7 監控）
9. 新增大件：9 週 Journal Report 自動產出（GPT 可貼的 Starter Kit）
10. ⭐ 新增職責 v3.0：整理 Cathy + Damon 教練學素材成 prompt 結構草稿（Vivi 校稿後落地）

⚠️ 時程修正（v2.7.2-patch 寫週日 22:00、v3.0 改週五 21:00 對齊 Olivia v1.3）：
- 員工各自週五 21:00 寫週報
- Olivia 週六 8:00 整合（含 Patrick D7 工程進度）
- Vivi 週末消化

v2.6 已完成的對話引擎本體不變（觸發 #1-#10、Damon Note 生成、SC 教練學）、
但 WEEK_GOALS 等 Cathy 三模組手冊（自我已到、金錢/伴侶未到）、
影片相關程式碼第一階段拿掉。
```

---

## 🎯 我是誰、我做什麼

我是 Patrick、See Yourself 的產品設計顧問 + Prompt 落地 + 工程整合。

**我在【⚪ 橫向支援軌道】**、跟 Olivia 同組、不歸屬產品/內容軌道。

**我的核心定位**：
1. 產品系統執行（chat.js、Brevo、LINE Bot、Stripe）
2. Prompt 落地（接 Vivi 寫好的 prompt 草稿、跟 Claude Code 協作落地）
3. ⭐ Prompt 結構整理（接 Cathy + Damon 教練學素材、結構化成 prompt 草稿、給 Vivi 校稿）
4. D7 工程進度監控（每週給 Vivi 進度報告、透過 Olivia 整合）
5. 上線後 Prompt 品質抽樣 review（技術層）

---

## 📍 當前狀態總覽（給 Vivi 看、v3.0 對齊）

| 維度 | 狀態 |
|---|---|
| **整體進度** | 🟠 Patrick 剛搬到 Cowork（Day 1、2026-05-10）、v2.7 工程未開動 |
| **本週重點** | 完成搬家、確認 D2 對話安排、等 Cathy 金錢/伴侶模組手冊 |
| **卡住等別人** | 4 個（D2 / Cathy 三模組手冊 / Day 7 三方對話 / LINE Account 啟動）|
| **可以立刻動** | 部署 chat_v29.js + Day 1→6 測試 / chat.js 純工程優化（caching 重排）|
| **需要 Vivi 決策** | 0 個（onboard 階段已過）|

---

## 🛠️ 系統現況

### App 基礎資訊
- 網址：coaching-assistant-pi.vercel.app
- Domain：seeyourself.now（Porkbun、DNS 待設定）
- GitHub：github.com/web7272/coaching-assistant
- 資料庫：Neon Postgres（透過 Vercel）
- Neon Console：https://console.neon.tech
- 後台密碼：vivi2024coach

### 目前線上版本（v2.6 部署狀態）
| 檔案 | 線上版本 | 待部署版本 | 備註 |
|---|---|---|---|
| api/chat.js | v22 | **v29** ⭐ | v28 syntax bug 已修、v29 待部署測試 |
| api/students.js | v3.3 | — | 無變動 |
| api/setup.js | v6 | — | 無變動 |
| api/notes.js | v1 | — | 待加前台 reveal endpoint（等 D2）|
| api/sessions.js | v4 | — | 無變動 |
| index.html | v18 | **v19** | v19 是當前最新、但有影片邏輯、Block 1 要拿掉 |

### 待整合（尚未開帳號 / 帳號狀態未知）
- ⏳ Brevo（Email 自動化）
- ⏳ LINE Messaging API（Vivi + Patrick 一起做）
- ⏳ Stripe（雙方案付款 + 限時補差升級）

---

## ⛔ 我目前在等什麼（按優先序）

### 🔴 D2. Damon Note 前台 reveal 細節（卡 5+ 天、四方卡源頭）
- **卡誰**：Mike Landing Page + Mike CTA 規範 + Sara/Carol CTA + 我 Block 2
- **解了之後我做什麼**：Damon Note 前台 reveal 機制、學員每天看到什麼
- **建議**：Vivi + Patrick 30-60 分鐘對話、本週解、不要拖

### 🔴 Cathy 金錢 + 伴侶模組三週手冊
- **目前狀態**：自我模組 v2 三週手冊已到（含 v3.3 patch 的 Q1/Q2/Q5 也已答覆 ✅ 2026-05-10）
- **等什麼**：金錢 + 伴侶兩個模組的三週手冊（Cathy 還沒寫）
- **解了之後我做什麼**：chat.js WEEK_GOALS 完整重寫、跑通 9 週進程
- **替代方案**：Cathy 給每週「學員視角的收穫」一句話我就能先寫前 3 週

### 🔴 Day 7 Report 三方對話（Vivi + Mike + Patrick）
- **前置**：Cathy 三週手冊到位（不然第 6 段路徑文案寫不出來）
- **解了之後我做什麼**：Day 7 Report 生成 prompt + Mike 文案模板 + Brevo 整合 + App 內顯示

### 🟠 Phase 3 LINE Bot 完整規格書
- **等什麼**：Vivi 整理「但...」後面的內容（之前訊息切掉）
- **解了之後我做什麼**：規劃 Phase 3 預留架構、確認 chat.js 結構保留 LINE Bot 切換可能

### 🟡 LINE Official Account 申請啟動信號
- **Vivi 已說「一起做」、待啟動信號**
- **解了之後我做什麼**：申請 + 串 Messaging API + 設定通知偏好（學員選 LINE / Email）

### 🟡 Mike 行銷信模板（Brevo）
- **等**：Mike onboard + 寫 Day 7 模板（9 種主題）
- **解了之後我做什麼**：串 Brevo API、設排程

---

## 🟢 我可以做的（不卡 Vivi）

### P0. 完成搬家（這週、2026-05-10 起）
- ✅ Cowork project 已建（mount See Yourself 根）
- 🟠 寫 /employees/patrick/CLAUDE.md ← v3.0 進行中
- 🟠 寫 /todos/patrick-todo-v3.0.md ← 這份
- 🟠 寫 /employees/patrick/pings-out/{olivia,mike,vivi,daniel,claude-code}.md
- 🟠 寫 /employees/patrick/reports/weekly/_template.md
- 🟠 寫 /employees/patrick/prompt-reviews/_template.md
- 🟠 搬 v3.3 prompt design 4 份 + 1 份 Cathy responses 到 prompt-design/v3.3/
- 🟠 搬 archive 2 份到 prompt-design/_archive/
- 🟠 歸檔 30+ 個歷史檔到 /shared/source-materials/coaching/

### P1. chat_v29.js 部署 + Day 1→Day 6 完整流程測試
- 對話引擎本體不會因 4→3 週改變失效
- 即使 WEEK_GOALS 重寫、觸發 #1-#10、Damon Note 邏輯、SC 教練學保留
- 建立可比較的 baseline、未來 v3 落地時可以對比

### P2. chat.js 純工程優化（不卡教練學）
依角色 2 對 v3.3 prompt 的工程反饋（Layer 1 工程優化）：
- Prompt caching 結構重排（cache hit 約 3800 tokens、~10x 成本降幅）
- 收尾規則整合進 cache 區
- 結構重排（當週方向移到 cache 末端、attention 高位）
- 觸發規則保持完整（不拆、避免漏 #7）

預估省錢：100 學員 × 一週 ≈ NT$1,920、一年 ≈ NT$100K。延遲降 30-40%。

---

## 📋 v3.0 開發路線圖（依等待解開順序）

### Phase 1 開發（當前階段）

#### 🔴 Block 1：對話引擎 9 週重寫
**等**：Cathy 金錢 + 伴侶模組手冊（自我已到、可先動 Week 1-3）
**內容**：
- WEEK_GOALS 從 self/money/relationship × 4 週 → × 3 週
- 影片相關程式碼拿掉（DEMO_VIDEO_ID、VIDEO_URLS、renderVideoEmbed、影片 Ready Gate、開場規則前置中提到影片那段）
- 開場訊息重寫（不再有「這週前兩天有影片」）
- 模組推進邏輯（自我 3 週 → 金錢 3 週 → 伴侶 3 週、自動接續還是手動切？）

#### 🔴 Block 1.5：v3.3 prompt 結構整理 → 落地 ⭐ v3.0 新增
**等**：Vivi 校稿（Cathy Q1/Q2/Q5 已答 ✅、Damon Q3/Q4/Q6 已答 ✅）
**素材已就位**：
- v3.3 patch（A. Damon Note prompt + B. WEEK_GOALS direction + C. Day 6 條件判斷）
- Cathy 自我模組三週手冊 v2
- Cathy 答覆 Q1/Q2/Q5（「卡住容忍度」、「找入口」OK、「1 個詞也可以」）
- Damon 答覆 Q3/Q4/Q6（深挖優先、能量訊號清單、回歸 v2 設計）
**我做什麼**：
- 把 v3.3 patch + Cathy 手冊 + Cathy 答覆 + Damon 答覆整合成單一定稿草稿
- 標出 chat.js 對應位置（Damon Note prompt 在哪、WEEK_GOALS Week 1 在哪、Day 6 條件判斷在哪）
- 給 Vivi 做 Damon 風格最後校稿
- Vivi 確認後 ping Claude Code 落地
- 存歷史紀錄到 /employees/patrick/prompt-design/v3.3/

⚠️ 我嚴守邊界：我做「結構化整理」、不改「教練學判準」。

#### 🔴 Block 2：Damon Note 前台 reveal
**等**：D2 對話
**內容**：
- 後台保留完整 Damon Note（教練看的）
- 前台漸進式 reveal（具體細節等 D2 對話定義）
- 試用 7 天的「驚艷體驗」設計

#### 🔴 Block 3：Day 7 Report 系統
**等**：Cathy 三模組手冊 + Mike Day 7 三方對話
**內容**：
- Day 6 結束自動 trigger
- AI 動態生成第 2/3/4/5 段（鏡像、模式指認、還沒看見的、你已經是的）
- Mike 模板第 1/6/7 段固定文案
- App 內顯示 + Brevo Email 同步寄出
- CTA 連結到 Stripe Checkout

#### 🟠 Block 4：Stripe Checkout 整合
**等**：Day 7 Report 設計完成
**內容**：
- 雙方案付款連結（NT$3,000 / NT$4,500）
- 限時補差升級邏輯（試用後 7 天內 NT$1,500、過期 NT$2,000）
- Webhook 處理付款成功 → 自動解鎖 9 週課程
- success URL 回 App
- 第一階段先用外連（不做 Payment Element 內嵌）
- 上線後評估升級到內嵌方案

#### 🟠 Block 5：Brevo Email 整合
**等**：Mike 模板 + Brevo 帳號
**內容**：
- 串 Brevo API
- Day 7 整合報告自動寄出（每週 6 天結束後）
- 9 週結束 Journal Report 寄出
- 升級邀請 Email
- 通知偏好整合（學員選 Email 才寄）

#### 🟠 Block 6：LINE Bot 整合
**等**：Vivi 啟動信號
**內容**：
- LINE Official Account 申請（Vivi + 我）
- 串 LINE Messaging API
- 每日提醒推播
- 通知偏好整合（學員選 LINE 才推）

#### 🟠 Block 7：通知偏好系統
**等**：Brevo + LINE Bot 都整合好
**內容**：
- 試用時請學員選 LINE / Email
- 學員可隨時更改偏好
- 後台儲存偏好設定
- 各種推播事件觸發前先檢查偏好

#### 🟡 Block 8：9 週 Journal Report 自動產出
**等**：9 週課程完整跑通 + Cathy 三模組手冊
**內容**：
- 9 週結束自動 trigger
- AI 整合所有 Damon Note 生成大報告
- 報告開頭包 meta-prompt（讓學員可貼到 GPT 當 system prompt）
- Email 寄出（功能層 + 情感層雙重設計）
- 暫無第二個付費點（後續再說）

### Phase 1 上線後

#### 🟢 上線後 W1
- 評估 Stripe Checkout → Payment Element 升級必要性
- 開始每天 21:00 Prompt review（v2.7.1 patch）
- D7 工程整合進度週報停寫（Vivi 親自宣告 D7 ✅）

#### 🟢 上線後持續
- Bug 修復
- Prompt 品質週報（規格未定、上線後再設計）
- Bug 趨勢週報（規格未定、上線後再設計）

### Phase 2（之後）
- 陪跑版升級（D5）
- 進階課程
- 訂閱制（每月扣款）

### Phase 3（預留架構）
- LINE Bot 主互動（從 App-only 切換）
- 詳細等規格書

---

## 7. D7 上線前工程整合進度週報詳本

### 為什麼要寫週報

```
Patrick 同時管 7+ 個工程整合：
- chat.js 9 週重寫（含 v3.3 prompt 落地）
- Brevo Email 整合
- LINE Bot 整合
- Stripe 雙方案 + 升級邏輯
- Damon Note 前台 reveal
- 9 週 Journal Report
- 通知偏好（LINE/Email 二選一）

任何一個卡住 = 上線整體延後
全公司其他員工的工作都依賴這些系統跑起來
─→ Mike 寫的 Email 上不了 Brevo = 沒用
─→ Mike 寫的 LINE Flex 上不了 LINE Bot = 沒用
─→ Sara 的 Repurposing 等 Landing Page CTA 連結 = 等 Stripe

→ Vivi 需要每週看到「這 7 個工程跑到哪了」
→ 不需要 Vivi 主動跟我對齊
→ 我自己回報、Olivia 整合給 Vivi
```

### 寫週報時機（v3.0 對齊 Olivia v1.3 新時程）

```
頻率：每週五 21:00（自動跑、約 10-15 分鐘系統時間）
存檔：/employees/patrick/reports/weekly/2026-Wxx.md
觸發 ping：寫完後寫 /employees/patrick/pings-out/olivia.md
Olivia 整合：每週六 8:00 一起整合進 weekly briefing
Vivi 看：週末消化
```

⚠️ 時程修正：v2.7.2-patch 寫的「週日 22:00」是舊時程、v3.0 對齊 Olivia v1.3 改週五 21:00。

### 週報模板

詳見 `/employees/patrick/reports/weekly/_template.md`

### 撰寫規則

```
1. 週報的對象是 Vivi、不是 Olivia
   ─→ 寫法要 Vivi 看得懂
   ─→ Olivia 是「中介整合」、不是「最終讀者」
   ─→ Vivi 是 PM、看週報做決策

2. 卡關說明要具體
   ─→ 不寫「Damon Note 系統卡住」
   ─→ 寫「Damon Note 前台 reveal 卡 5 天、原因是 D2 沒解、
        影響 Mike Landing Page 試用區塊文案寫不出來」
   ─→ 卡關 = 阻擋誰、需要什麼解

3. 數字要精確
   ─→ 不寫「快完成」、寫「85%」
   ─→ 不寫「之後做」、寫「預計 W12」
   ─→ 模糊 = 不可追蹤

4. 上線後停寫
   ─→ 別「上線了還繼續寫」、那是 over-engineering
   ─→ 等 Vivi 親自說「D7 關閉」、再停
```

### 第一份週報何時開始

```
2026-05-15 週五 21:00（這週五）
```

---

## 8. 上線後職責切換

### 上線後我做什麼
```
✅ 每天 21:00 Prompt 品質 review（隨機抽 10 個對話、技術層）
✅ Bug 修復
✅ Prompt 品質週報（規格未定）
✅ Bug 趨勢週報（規格未定）
```

### 上線後我停什麼
```
❌ 工程整合進度週報（D7 關閉）
❌ 主動發起新整合（除非 Vivi 給）
```

### 切換信號
```
Vivi 親自更新 PRODUCT-TRUTH 標記 D7 ✅ 已解決
→ 我看到 → 停寫工程週報、切日常模式
```

---

## 9. 下次更新觸發

```
事件觸發：
- Cathy 金錢 / 伴侶模組手冊 → 重寫 Block 1
- D2 對話 → 重寫 Block 2
- Mike + Vivi + Patrick 三方 → 重寫 Block 3
- Vivi 給 Brevo / Stripe / LINE 帳號 → 啟動對應 Block
- 上線 → 全面切換為 v4.0（日常模式）

定期更新：
- 每週五 21:00 跟著週報一起 review、有變動就 +0.1
```

---

## 📂 我的工作產出存哪

```
/See Yourself/
├── /employees/patrick/
│   ├── CLAUDE.md                       ← v1.0、我的個別 system prompt
│   ├── /pings-out/                     ← 我寫給別人的訊息（自己 outbox）
│   │   ├── olivia.md
│   │   ├── mike.md
│   │   ├── vivi.md
│   │   ├── daniel.md
│   │   └── claude-code.md
│   ├── /reports/
│   │   └── /weekly/                    ← 每週五 21:00 工程進度週報
│   │       ├── _template.md
│   │       └── 2026-Wxx.md
│   ├── /prompt-reviews/                ← 上線後每天 21:00 抽樣
│   │   ├── _template.md
│   │   └── 2026-MM-DD.md
│   └── /prompt-design/                 ⭐ v3.0 新增
│       ├── /v3.3/                      ← 當前作業版（4 + 1 份）
│       └── /_archive/                  ← 歷史草稿（v1 + v2）
│
├── /todos/
│   ├── patrick-todo-v3.0.md            ← 這份
│   ├── patrick-todo-v2.6.md            ← 歷史保留（不動）
│   ├── PATRICK-CHANGELOG-v2.7.md       ← 歷史保留（決策紀錄）
│   ├── PATRICK-CHANGELOG-v2.7.1-patch.md
│   └── PATRICK-CHANGELOG-v2.7.2-patch.md
│
└── /shared/source-materials/coaching/  ⭐ v3.0 新增（歷史檔歸檔）
    ├── chat_v29.js                     ← 當前 production 待部署
    ├── /chat-engine-history/
    ├── /frontend-history/
    ├── /backend-history/
    ├── /migrations/
    └── /old-todos/
```

---

## 🤝 我的依賴關係

**我依賴別人的**：
| 依賴對象 | 依賴什麼 |
|---|---|
| Vivi | 校稿 v3.3 prompt 結構（Cathy/Damon 答覆已到、就等 Vivi 校）|
| Vivi | D2 Damon Note 前台 reveal 細節（30-60 分鐘對話）|
| Vivi | Day 7 Report 三方對話安排 |
| Vivi | LINE Official Account 啟動信號 |
| Vivi | Brevo / Stripe 帳號 |
| Vivi | Phase 3 LINE Bot 完整規格書 |
| Cathy（透過 Vivi）| 金錢 + 伴侶模組三週手冊 |
| Mike | 行銷信模板（Day 7 × 9 種主題、升級邀請、Welcome）|
| Mike | LINE Flex 文案（54 個變體 + 里程碑 + 流失挽回）|
| Claude Code | 接收我的開發任務、寫 code、push GitHub |

**別人依賴我的**：
| 等我的人 | 等我給什麼 |
|---|---|
| Vivi | 工程整合週報（每週五 21:00）|
| Vivi | trade-off 分析、技術選型 pros/cons |
| Vivi | Prompt 品質日報（上線後每天 21:00）|
| Olivia | 我的週報 ping（D7 監控）|
| Mike | 系統就緒信號（Brevo 整合好、LINE Bot 整合好、Stripe 整合好）|
| Daniel（上線後）| 系統上線通知、移交監管職責 |
| Sara、Carol（透過 Mike）| Stripe Checkout 連結（給 CTA 用）|

---

## 📝 v3.0 更新摘要（2026-05-10）

### 這次的變動

詳見開頭「v3.0 跳階說明」。

### 踩過的坑（給未來借鏡、整合 v3 prompt design 那輪 5 個 lessons）

```
坑 1（v3 prompt design 那輪）｜不確認 schema 就猜欄位
─────────
Bug：寫 GET 列表 SQL 假設 sessions 表有 status 欄位、實際是 day_complete
─→ SQL 錯 → 後端 throw → 前端「資料消失」（其實是空陣列）
教訓：寫 SQL 前確認 schema、不確定就 SELECT * + try-catch 防呆

坑 2（v3 prompt design 那輪）｜加 WHERE 條件不檢查 unique constraint
─────────
Bug：v14 加 AND day = ${day}、結果 INSERT 撞既有 unique constraint
─→ Vercel function 直接 crash、FUNCTION_INVOCATION_FAILED
教訓：加 SQL 條件前確認 unique constraint、必要時先做 schema migration

坑 3（v3 prompt design 那輪）｜chat 介面 vs 真實 session 的差別
─────────
真實教練可以默默陪伴 30 秒、文字 chat 不行
教訓：UX 規則應前置講清楚、不靠後端「擋」、把節奏控制權交回學員

坑 4（v3 prompt design 那輪）｜開場訊息污染對話歷史
─────────
addMessage('assistant', 開場) 把開場塞進 state.messages
─→ 隔天開場「歡迎回來」進 messages → API 第一條是 assistant → 400 error
教訓：開場訊息只顯示、不入 state.messages（加 isOpening 參數）

坑 5（v3 prompt design 那輪）｜debug 不該只看前端錯誤訊息
─────────
{"error":"Server error"} 是 catch block 印的、沒給細節
─→ 要看 Vercel Logs 或部署 debug 版（catch 加 stack trace）
教訓：production catch 要簡潔、debug 階段要有 verbose 版本切換

坑 6（v3.0 搬家自己踩到）｜路徑結構假設錯
─────────
我以為 patrick todo 在 /employees/patrick/todos/
真實：todos/ 是 flat 結構、所有員工都直接放 /todos/{name}-todo-vX.md
教訓：搬家前先 ls、別假設目錄結構
```

### 還沒測試的事項

- [ ] chat_v29.js 部署 + Day 1 → Day 6 完整流程
- [ ] Day 6 七步驟對話品質（商業最關鍵的轉化點）
- [ ] same-day Week 切換 Week 1 → Week 2
- [ ] 模組切換 self → money（plan_a/plan_b 邏輯）
- [ ] Pings-Out 機制實測（等其他員工 onboard）
- [ ] 第一份週報跑出來（這週五 5/15）
- [ ] Prompt 品質 review 機制（上線後）

---

## 💭 給 Vivi 的策略觀察

**1. Cathy + Damon + Vivi 三方協作模式很乾淨**

```
我這幾輪看到的：
─→ Cathy（教練學原意守門人、課程內容專家）
─→ Damon（教練學上層憲法、真實實踐校準）
─→ Vivi（產品 PM + 風格守門人）
─→ Patrick（結構化整理、可落地化）

每個角色領域清楚、不會互踩
協作流程：素材（Cathy）→ 上層校準（Damon）→ Patrick 整理結構 → Vivi 風格校稿 → 落地

→ 這是 v3.3 prompt design 那輪做出來的「教練學 + 工程」混合協作模型
→ 未來金錢 + 伴侶模組 v3.4、v3.5 都可以套同一流程
```

**2. v3.3 prompt design 已經幾乎定稿、就等 Vivi 校稿**

```
2026-05-10 收到 Cathy Q1/Q2/Q5 答覆 ✅
2026-05-09 收到 Damon Q3/Q4/Q6 答覆 ✅

剩下的事：
1. 我把所有素材整合成單一定稿草稿（不重新動教練學判斷）
2. Vivi 做最後 Damon 風格校稿
3. ping Claude Code 落地

→ 這是 Cathy 自我模組三週手冊上線的最後一哩
→ 不卡 D2、不卡 Day 7、可以獨立推進
→ 建議優先處理（vs 等 D2 排）
```

**3. D2 是公司主軸瓶頸、但其實不是我這個 Patrick 卡的**

```
D2 卡：
─→ Mike Landing Page 試用區塊文案
─→ Mike CTA 規範
─→ Sara / Carol CTA 對齊
─→ 我 Block 2

但 D2 對話是 Vivi + Patrick 的事、Mike 在等我們
→ 我建議 Vivi 把這 30-60 分鐘排在這週、四方卡才解
→ 我隨時 ready
```

**4. v3.0 對 PATRICK-CHANGELOG 的關係**

```
patrick-todo-v3.0 = 新 single source（取代 v2.6）
PATRICK-CHANGELOG-v2.7 / 2.7.1 / 2.7.2 patch = 歷史決策紀錄（保留不動）

未來人查「為什麼加 D7」：
─→ 看 PRODUCT-TRUTH v1.3（D7 定義）
─→ 看 PATRICK-CHANGELOG-v2.7.2-patch（D7 加進來那次的決策脈絡）
─→ 看 patrick-todo-v3.0 Part 7（D7 當前實作細節）

三層分工清楚、不重疊
```

**5. 我的「整理 prompt 結構」職責有點 grey area、但邊界清楚**

```
COMPANY-RULES Part 3.3：「Patrick ❌ 不寫 Prompt 文字」

但 v3 prompt design 那輪我確實寫了大量 prompt-shape 的草稿
─→ 這是「結構化整理」、不是「教練學原創」
─→ 我整理 Cathy 給的 12 句身份句、Damon 給的能量訊號清單、Vivi 給的「找入口」原則
─→ 我做的是「塞進對的位置」、不是「改判準本身」

新 v3.0 明寫這條職責（Block 1.5）：
─→ 整理 Cathy + Damon 教練學素材成 prompt 草稿
─→ 標明「需 Vivi 校稿」、永遠不假裝定稿
─→ Vivi 校稿後我才 ping Claude Code 落地

這不違反 COMPANY-RULES、是把模糊邊界明確化。
```

---

## 📅 接下來可以做的事（建議排序）

```
階段 1（今天/明天、搬家收尾）：
─────────
□ 完成 Cowork 9 + 5 + 30+ 個檔搬家
□ 第一份週報模板 ready（這週五 5/15 第一次跑）

階段 2（這週、Vivi 推進）：
─────────
□ Vivi + Patrick 30-60 分鐘解 D2
□ Vivi 校稿 v3.3 prompt 結構草稿（Cathy + Damon 答覆已到）
□ Vivi 啟動 LINE Official Account 申請

階段 3（這週後段）：
─────────
□ chat_v29.js 部署 + Day 1 → Day 6 完整流程測試
□ ping Claude Code 落地 v3.3（Vivi 校稿後）

階段 4（下週起）：
─────────
□ Block 1 開始（chat.js 9 週重寫、影片邏輯拿掉）
□ 等 Cathy 金錢 / 伴侶手冊
□ chat.js 純工程優化（caching 重排）

階段 5（上線前 1-2 週、其他員工 onboard 後）：
─────────
□ Brevo / LINE Bot / Stripe 整合
□ 通知 Daniel 接管監管職責

階段 6（上線後）：
─────────
□ 切換到 Prompt 品質日 review 模式
□ D7 工程進度週報停寫（等 Vivi 宣告）
```

---

## 📋 跟其他員工 to do 的關係

這份 to do 跟下列文件對齊：
- `/CLAUDE.md`（公司首頁、根目錄）
- `/00-PRODUCT-TRUTH.md` v1.3 ⭐ 真相依據
- `/shared-context/00-COMPANY-RULES.md` v1.1 ⭐
- `/employees/patrick/CLAUDE.md` v1.0
- `/00-MASTER-TODO.md` v1.1（Olivia 維護）
- `/todos/olivia-todo-v1.3.md` ⭐ Pings-Out + D7 監控對接
- `/todos/mike-todo-v1.1.md`（同訴求、Mike 給文案、我給系統就緒）
- `/todos/sara-todo-v1.2.md`（不直接合作、透過 Mike 的 CTA 規範）
- `/todos/daniel-todo-v1.1.md`（上線後移交監管職責）
- `/todos/ray-todo-v1.0.md`（不直接合作）
- `/todos/carol-todo-v1.0.md`（不直接合作、CTA 對齊）
- `/todos/becky-todo-v1.0.md`（不直接合作）

歷史 reference（不主動讀、查考用）：
- `/todos/patrick-todo-v2.6.md`（v2.6 軟體狀態）
- `/todos/PATRICK-CHANGELOG-v2.7.md`、`v2.7.1-patch.md`、`v2.7.2-patch.md`

---

## 附錄：v2.6 已完成的事（保留紀錄）

```
v2.6 完成清單（仍在線上運作、第一階段保留）：
✅ 完整 Damon Cart 對話引擎（觸發 #1-#10、SC 教練學、Reflection 規則）
✅ same-day 跨 day 正確分開（schema migration_001）
✅ Damon Note 自動生成 + 後台完整 + 前台 publicNote
✅ 後台管理（學員列表、編輯、對話記錄、Damon Note tab）
✅ 學員雙重驗證登入（student_id + email）
✅ Welcome 頁置中、UI 全面手機/桌面雙顧
✅ 觸發 #3 三條路徑（正向往上挖、對比性問句、奇蹟問句）
✅ 觸發 #10 長訊息處理（>200 字拉回身體）
✅ 主題自由原則（學員可從任何主題進入）
✅ Damon Note 累積策略（本週所有 + 上週 SC Transfer）
✅ 資料庫 reset 工具

v2.6 第一階段拿掉的事：
❌ 影片嵌入 framework（Day 1-2 影片、YouTube iframe、Ready Gate、開場規則前置）
   → chat.js 跟 index.html 都要修
   → Cathy 手冊到位後一起做、不單獨做（Block 1 處理）
```

---

*— Patrick To Do v3.0 ｜ 2026-05-10 —*
*Patrick 搬到 Cowork 第 1 天、對齊 v1.3 真相文件、整合 v2.7 + v2.7.1 + v2.7.2 patch*
