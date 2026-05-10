# Patrick Changelog v2.6 → v2.7

**See Yourself ｜ SC Coaching System**
**版本變更日期**：2026-05-07
**前一版本**：v2.6（2026-05-03）
**通知對象**：Patrick + Claude Code

---

## 🚨 為什麼需要這份 changelog

從 v2.6 → v2.7、產品做了**三個重大決策變動**：

```
1. 第一階段拿掉影片（純 App）
2. 12 週 → 9 週（每模組從 4 週縮為 3 週）
3. 雙方案 + Up-sale 設計（NT$3,000 / NT$4,500 + 限時升級補差額）
```

**這影響你 v2.6 已部署的程式碼**——chat_v22.js 跟 index_v18.html 都要改。

**這份文件目的**：
- 列清楚要改什麼
- 解釋為什麼（避免你改一半發現邏輯衝突）
- 給優先序（什麼先做、什麼可以等）

**所有改動的「真相依據」**：
- `/See Yourself/00-PRODUCT-TRUTH.md` v1.0
- 跟我前面所有規格書衝突 → 以 PRODUCT-TRUTH 為準

---

## 📊 影響範圍總覽

| 檔案 | v2.6 狀態 | v2.7 要做的事 | 工作量 |
|---|---|---|---|
| **chat_v22.js** | ✅ 9 觸發、Ready Gate、yesterdayNote、入口問句抽取 | 拿掉影片邏輯、9 週進程、新增前台 Damon Note reveal、雙方案邏輯 | 🔴 大改 |
| **index_v18.html** | ✅ 影片嵌入、UI 置中、規則前置 | 拿掉影片相關 UI、雙方案購買頁、升級限時倒數 | 🔴 大改 |
| **api/students.js** | ✅ v3.3 登入驗證 + PATCH | 新增雙方案欄位、升級狀態追蹤、限時 7 天倒數 | 🟡 中改 |
| **api/setup.js** | ✅ v6 schema | 改 plan 欄位定義（雙方案）、新增 upgrade_deadline 欄位 | 🟡 schema migration |
| **api/sessions.js** | ✅ v4 用戶本地時間 | 不變 | 🟢 |
| **api/notes.js** | ✅ v1 | 新增前台 reveal 用的 GET endpoint | 🟡 中改 |
| **migrations/** | ✅ 001 sessions unique | 新增 002 plan 重定義、003 upgrade tracking | 🔴 必做 |

---

## Part 1 ｜ 核心變動 1：拿掉影片邏輯

### 為什麼

第一階段策略性拿掉影片：
- 24 支影片要錄、卡 Vivi 時間、影響 8-10 週上線
- 純 App 訴求要先驗證、再投資影片產能
- 第二階段才加回來

### 你要改的程式碼

#### 1.1 chat_v22.js

```javascript
// ❌ 拿掉的邏輯：

// (1) Ready Gate 完整段落
//     v2.6 在影片日（Day 1, Day 2）攔截「ok」這類短訊息
//     ─→ 整段拿掉（純問答不需要 Ready Gate）

// (2) 影片日的特殊 prompt 處理
//     v2.6 第一回合會在 prompt 加「請先確認用戶看完影片」
//     ─→ 拿掉

// (3) Ready signal regex
//     /準備好|看完|看好|可以開始|可以了|ready/i
//     ─→ 拿掉（不再需要）

// (4) 第一句長度判斷（< 5 字 hardcode 提示）
//     ─→ 拿掉

// ✅ 保留的邏輯（重要、不要動）：
// - 9 個觸發條件
// - 觸發 #7 三段式
// - yesterdayNote 用 (week, day) 比較
// - 後端從 Damon Note 抽出「明天的入口」字串
// - Day 6 七步驟整合日邏輯
// - Safety 機制
```

#### 1.2 index_v18.html

```javascript
// ❌ 拿掉的：

// (1) YouTube iframe 嵌入區塊
//     ─→ 整段移除

// (2) VIDEO_URLS mapping 表（24 個 video ID）
//     ─→ 整個變數移除

// (3) Day 1 / Day 2 影片載入邏輯
//     ─→ 移除

// (4) 影片 placeholder（「影片準備中」）
//     ─→ 不需要了

// (5) scrollTop = 0 的影片載入後處理
//     ─→ 拿掉、改回標準 chat scroll 行為

// ✅ 保留：
// - Welcome 頁置中
// - 對話區桌面置中限寬 720px
// - 開場訊息規則前置（但內容要改、見下面）
```

#### 1.3 開場訊息要改

v2.6 開場訊息：
> 「這週前兩天有影片、看完回覆『看完』」

v2.7 改成：
> 「這個系統不是課程、是對話。
>  AI 會問你問題、像有人坐在你對面。
>  每天 5-10 分鐘、不要急著回答、慢慢來。」

具體文案 Mike 會給、你先預留結構。

---

## Part 2 ｜ 核心變動 2：12 週 → 9 週（每模組 3 週）

### 為什麼

業界線上課程完成率僅 5-20%、12 週對中年女性受眾太長。
縮短為 9 週（每模組 3 週）、保留 Damon SC 七步驟核心、提高完成率。

### 你要改的程式碼

#### 2.1 模組進度邏輯

```javascript
// v2.6 邏輯：
// self_week_completed: 0-4
// 每模組 4 週

// v2.7 改成：
// self_week_completed: 0-3
// 每模組 3 週

// 解鎖邏輯：
// - self Week 3 完成 → 解鎖 money（NT$4,500 用戶）
// - money Week 3 完成（總 Week 6）→ 解鎖 relationship
// - relationship Week 3 完成（總 Week 9）→ 完成、產 Starter Kit
```

#### 2.2 current_week 邏輯

```javascript
// v2.6：current_week 1-4 後切模組
// v2.7：current_week 1-3 後切模組

// 自動推進邏輯：
// week 3 day 6 完成 → 
//   if module === 'self' && plan === 'B': switch to money week 1
//   if module === 'self' && plan === 'A': end + show upgrade
//   if module === 'money': switch to relationship week 1
//   if module === 'relationship': end + generate full starter kit
```

#### 2.3 Damon Note 累積週數

```javascript
// 原本累積 12 週 Damon Notes
// 改成累積 9 週

// 注意：Day 7 整合 Email 需要本週 Notes 整合
// 9 週 × 6 天 = 54 個 Daily Notes
// + 9 個 Weekly 整合 Notes
```

---

## Part 3 ｜ 核心變動 3：雙方案 + Up-sale 設計

### 為什麼

完成率焦慮 + 商業 up-sale 心理戰：
- NT$3,000 = 自我關係版（觀望者、入門）
- NT$4,500 = 完整 9 週（主推、含 Starter Kit）
- 限時 7 天升級補差額機制

### 3.1 plan 欄位 schema migration

```sql
-- v2.6 plan 欄位：
-- trial / self_only / self_money / self_relationship / all

-- v2.7 plan 欄位（重新定義）：
-- trial          → 免費試用（自我關係第一週）
-- plan_a         → NT$3,000 自我關係版（3 週）
-- plan_b         → NT$4,500 完整版（9 週）

-- migration_002_plan_redefine.sql 範例：
-- 步驟 1：把舊資料對應到新 plan
--   self_only → plan_a
--   all → plan_b
--   trial → trial
-- 步驟 2：drop 舊欄位、add 新欄位
-- 步驟 3：新增約束（plan IN ('trial', 'plan_a', 'plan_b'))
```

### 3.2 新增 students 表欄位

```sql
ALTER TABLE students ADD COLUMN:
  - upgrade_deadline TIMESTAMP   -- NT$3,000 用戶 Week 3 完成後 +7 天
  - upgraded_at TIMESTAMP         -- 升級時間（NULL = 沒升級）
  - upgrade_amount INT            -- 升級補差額（1500 / 2000）

-- 用途：
-- upgrade_deadline 設定：plan_a 用戶 Week 3 Day 6 完成時 = NOW() + 7 days
-- 升級流程檢查：
--   if upgraded_at IS NOT NULL → 已升級
--   elif NOW() < upgrade_deadline → 限時內、補 NT$1,500
--   else → 過期、補 NT$2,000
```

### 3.3 升級邏輯（關鍵）

```javascript
// 觸發點：Week 3 Day 6 整合日完成（plan_a 用戶）

async function onSelfWeek3Complete(student) {
  if (student.plan !== 'plan_a') return; // plan_b 直接進金錢、不觸發

  // 設定 7 天倒數
  const deadline = new Date();
  deadline.setDate(deadline.getDate() + 7);

  await db.update('students', student.id, {
    upgrade_deadline: deadline,
    current_module: 'self_completed', // 暫停、等用戶決定
  });

  // 觸發 Day 7 升級邀請 Email（透過 Brevo）
  await brevo.triggerEmail('upgrade_invitation', {
    student_id: student.id,
    deadline: deadline,
    amount: 1500,
  });

  // LINE 通知（如果用戶選 LINE）
  if (student.notification_preference === 'line') {
    await line.push(student.id, '升級邀請訊息（Mike 會給文案）');
  }
}

// Stripe webhook：升級付款成功
async function onUpgradePayment(student_id, amount) {
  const student = await db.get('students', student_id);
  
  // 驗證金額
  const expectedAmount = 
    new Date() < student.upgrade_deadline ? 1500 : 2000;
  
  if (amount !== expectedAmount) {
    throw new Error(`Wrong upgrade amount: ${amount}, expected: ${expectedAmount}`);
  }

  // 升級
  await db.update('students', student_id, {
    plan: 'plan_b',
    upgraded_at: new Date(),
    upgrade_amount: amount,
    current_module: 'money',
    current_week: 1,
    current_day: 1,
    money_unlocked: true,
  });

  // 通知用戶（Mike 會給文案）
  await sendUpgradeConfirmation(student_id);
}
```

### 3.4 進度延續設計（關鍵 UX）

```
業界研究警告：
─────────────
"Learners should NEVER lose their progress or achievements when upgrading"

→ 升級後直接進金錢 Week 1 Day 1
→ 之前自我關係的 Damon Note + 軌跡都保留
→ 用戶感受：「我升級就接著走、沒重來」
```

實作要點：
- 不要清空 sessions / messages / notes
- current_module 直接從 'self_completed' → 'money'
- current_week / current_day 重置為 money week 1 day 1
- 但 self_week_completed 保持 3（已完成）

---

## Part 4 ｜ 新功能 1：前台 Damon Note Reveal ⭐

### 為什麼這是試用期最關鍵 hook

```
傳統試用：給「教程預覽」、用戶聳肩
See Yourself 試用：給「Vivi 看見的我」、用戶震驚
→ 第一天就讓用戶覺得「這個 AI 真的看見我」
→ 試用即廣告、體驗即口碑
```

### ⚠️ 這是 D2 待解決問題、細節未定

具體 reveal 哪部分、什麼時機、什麼形式——**還沒設計**。

需要 Vivi + Patrick 30-60 分鐘討論。

### 但你可以先預留架構

```javascript
// api/notes.js 新增 endpoint
GET /api/notes/today/:student_id
返回：
{
  date: "2026-05-15",
  module: "self",
  week: 1,
  day: 3,
  reveal: {
    // ⏳ 內容結構待設計
    quote: "...",          // 用戶今天的金句
    sc_observation: "...", // SC 觀察精簡版
    // 可能還有別的、設計時定
  },
  full_note_for_admin: { 
    // 後台用的完整版（已有）
  }
}

// Damon Note 產生時、要分兩塊存：
// - 完整版（後台用）
// - 精簡版（前台 reveal 用）
//   - 從完整版抽取部分欄位
//   - 用 prompt 改寫成「給用戶看的語氣」
```

### 顯示位置（待 UX 確認）

可能的方案：
1. 對話結束後彈跳卡片
2. 嵌入對話流（最後一則）
3. 另開「軌跡頁」

→ 跟 Vivi 討論後再實作

---

## Part 5 ｜ 新功能 2：Day 7 整合報告 Email

### 為什麼

每週 Day 6 結束後、第 7 天透過 Email 給用戶整合報告。
這是商業核心觸發點（升級 / 推進 / 留存）。

### 觸發機制

```javascript
// chat_v22.js 在 Day 6 完成時：

async function onDay6Complete(student) {
  // 既有邏輯（保留）
  await generateWeeklyDamonNote(student);
  await advanceToNextWeek(student);
  
  // v2.7 新增：
  await brevo.scheduleEmail({
    student_id: student.id,
    template: getEmailTemplate(student),
    delay: '24 hours',  // Day 7 = Day 6 完成後 24 小時
  });
}

function getEmailTemplate(student) {
  // 9 種 Email 模板（每週主題不同）
  // Mike 會給文案、你接 Brevo
  
  if (student.plan === 'trial' && student.current_week === 1) {
    return 'trial_end_purchase_invitation'; // 試用週、推雙方案
  }
  if (student.plan === 'plan_a' && student.current_week === 3) {
    return 'plan_a_upgrade_invitation'; // 自我 Week 3、限時升級
  }
  return `weekly_report_${student.current_module}_${student.current_week}`;
}
```

### Brevo 整合需求

```
你已有 Brevo 帳號（v2.6 待辦清單第二優先）
v2.7 需要：
- 9 種 Email 模板上架
- Trigger API 整合
- DNS 設定（seeyourself.now → Brevo SMTP）

Mike 會給文案、你接系統
```

---

## Part 6 ｜ 新功能 3：通知策略（LINE / Email 二選一）

### 為什麼

不同用戶習慣不同：
- 中年女性偏好 Email（儀式感）
- 年輕一點的偏好 LINE（即時感）
- 不要兩邊轟炸

### 註冊時的選擇 UI

```
免費試用註冊 / 付款購買時：
─────────────
「你希望每天透過哪個收到提醒？」
○ LINE 每天推播（推薦、即時）
○ Email 每天推播（儀式感、適合慢節奏）

→ 用戶二選一、可以隨時切換
→ Day 7 整合報告 Email 強制不可關（共 9 封）
```

### students 表新增欄位

```sql
ALTER TABLE students ADD COLUMN:
  - notification_preference VARCHAR(10) DEFAULT 'line'
    CHECK (notification_preference IN ('line', 'email'))
```

### 推播分流邏輯

```javascript
async function sendDailyReminder(student_id) {
  const student = await db.get('students', student_id);
  
  if (student.notification_preference === 'line') {
    await line.push(student_id, dailyMessage);
  } else {
    await brevo.sendEmail(student_id, 'daily_reminder', dailyMessage);
  }
}
```

---

## Part 7 ｜ 9 週完整 Journal Report → Starter Kit ⭐

### 兩個版本

```
精簡版（plan_a 完成自我關係 Week 3）：
─────────────
- 自我關係 3 週 Journal
- 自我關係專屬 prompt 範本
- 簡單使用指南

完整版（plan_b 完成 9 週）⭐
─────────────
- 9 週完整 Journal（自我 + 金錢 + 伴侶）
- 完整 prompt 範本（含三模組決策邏輯）
- 進階使用指南
- 「我的 AI 教練」設定教學
```

### ⚠️ 這是 D3 待解決問題、Week 7-8 才設計

```
為什麼不急：
- 9 週後才兌現給用戶
- 第一批 9 週畢業生 = 上線後 2-3 個月
- 那之前還有時間迭代

但你可以先預留架構：
- 設計 Journal export 格式（Markdown / PDF）
- 設計 Prompt 範本的 metadata
- 之後填內容
```

---

## Part 8 ｜ Schema Migrations 整合

### Migration 002：plan 欄位重定義

```sql
-- migrations/002_redefine_plan.sql

-- 步驟 1：暫存舊資料
CREATE TABLE plan_migration_backup AS 
SELECT id, plan FROM students;

-- 步驟 2：對應新 plan
UPDATE students SET plan = 
  CASE 
    WHEN plan = 'trial' THEN 'trial'
    WHEN plan = 'self_only' THEN 'plan_a'
    WHEN plan IN ('all', 'self_money', 'self_relationship') THEN 'plan_b'
    ELSE 'trial'
  END;

-- 步驟 3：加約束
ALTER TABLE students DROP CONSTRAINT IF EXISTS plan_check;
ALTER TABLE students ADD CONSTRAINT plan_check 
  CHECK (plan IN ('trial', 'plan_a', 'plan_b'));
```

### Migration 003：升級追蹤欄位

```sql
-- migrations/003_upgrade_tracking.sql

ALTER TABLE students 
  ADD COLUMN upgrade_deadline TIMESTAMP NULL,
  ADD COLUMN upgraded_at TIMESTAMP NULL,
  ADD COLUMN upgrade_amount INT NULL;
```

### Migration 004：通知偏好

```sql
-- migrations/004_notification_preference.sql

ALTER TABLE students
  ADD COLUMN notification_preference VARCHAR(10) DEFAULT 'line'
    CHECK (notification_preference IN ('line', 'email'));
```

### Migration 005：每模組改 3 週

```sql
-- migrations/005_module_3weeks.sql

-- 沒有結構改動、但邏輯上：
-- self_week_completed 0-3（不是 0-4）
-- 在 application code 處理、DB 不需要改

-- 但要清理舊 self_week_completed = 4 的資料
UPDATE students 
SET self_week_completed = 3,
    money_unlocked = true
WHERE self_week_completed >= 3 AND plan = 'plan_b';
```

---

## Part 9 ｜ 部署順序建議

```
Day 1：Schema migrations（最基礎、其他依賴它）
  ├── 002 plan 重定義
  ├── 003 升級追蹤
  └── 004 通知偏好

Day 2-3：chat_v22.js 改動
  ├── 拿掉影片邏輯（簡單、先做）
  ├── 9 週進程邏輯（中等）
  └── 雙方案解鎖邏輯（複雜）

Day 4-5：index_v18.html 改動
  ├── 拿掉影片 UI
  ├── 雙方案購買頁（新做、Mike 會給文案）
  └── 升級限時倒數 UI（新做）

Day 6：api/students.js 改動
  └── 升級流程 endpoint

Day 7：api/notes.js 新增
  └── 前台 reveal endpoint（架構先做、內容等 D2 設計）

Day 8-10：Brevo + LINE 整合
  ├── Day 7 Email 觸發
  └── 通知偏好分流

之後：
  ├── 等 Mike 給 Email/LINE 文案、上架
  ├── 等 Vivi 給 Damon Note reveal 設計、實作
  └── E2E 測試
```

---

## Part 10 ｜ 你 v2.6 待測試項目重新對齊

v2.6 還沒測試的事項中、有些已經被 v2.7 取代：

| v2.6 待測試 | v2.7 狀態 |
|---|---|
| Day 6 整合日七步驟 | ✅ 還是要測（不變）|
| Week 切換 Week 1 → 2 | ✅ 還是要測（不變）|
| 模組切換 self → money | 🟡 改動了、要重新測（plan_a/plan_b 邏輯）|
| 影片 placeholder | ❌ 不再需要、拿掉了 |
| 真實 1對1 教練示範 | ✅ 還是要做、但用 v2.7 流程 |

新增 v2.7 要測試的：
- [ ] plan_a 用戶 Week 3 Day 6 完成 → 觸發 7 天倒數
- [ ] 7 天內升級 → 補 NT$1,500、進度延續到 money week 1
- [ ] 7 天後升級 → 補 NT$2,000、進度延續到 money week 1
- [ ] 不升級 → 系統暫停、發放自我關係 starter kit
- [ ] plan_b 用戶 Week 3 Day 6 → 自動進 money week 1（不觸發升級）
- [ ] LINE / Email 通知偏好切換
- [ ] Day 7 整合 Email 是否準時觸發（每週 9 種模板）
- [ ] 前台 Damon Note reveal（D2 設計後）
- [ ] 9 週完成 → 自動產 Starter Kit（D3 設計後）

---

## 📋 給 Patrick 的優先序建議

```
🔴 必做、卡上線（這週/下週）：
─────────────
1. Schema migrations 002-005
2. chat_v22.js 拿掉影片邏輯（簡單）
3. chat_v22.js 改 9 週進程邏輯
4. chat_v22.js 雙方案解鎖邏輯
5. api/students.js 升級流程

🟡 重要、可以稍等（2-3 週內）：
─────────────
1. index_v18.html 雙方案購買頁（等 Mike 文案）
2. Brevo Day 7 Email 整合（等 Mike 文案）
3. LINE Bot 整合（等 LINE Official Account 申請）
4. 升級限時倒數 UI

🟢 預留架構、等設計（之後）：
─────────────
1. 前台 Damon Note reveal endpoint（架構可做、內容等 D2）
2. Journal Report Export 機制（架構可做、內容等 D3）
3. AI 教練 Starter Kit 產生器（內容等 D3）

⚪ 未來、第二階段：
─────────────
1. 影片功能（拿掉的、第二階段加回）
2. 陪跑版、1對1 方案
```

---

## ⚠️ 特別提醒

### 1. 不要急著做 D2 / D3

```
D2（Damon Note 前台 reveal）：
  - 細節 Vivi 還沒設計
  - 你先預留架構就好
  - 等 Vivi + Patrick 30-60 分鐘討論後實作

D3（AI 教練 Starter Kit）：
  - 9 週後才兌現給用戶
  - Week 7-8 設計都來得及
  - 現在不急
```

### 2. 進度延續是 UX 命門

```
NT$3,000 用戶升級時、絕對不能讓他「重來」
→ Damon Note 累積保留
→ 軌跡頁保留
→ self_week_completed = 3 保留
→ 直接從 money week 1 day 1 開始

業界研究：升級時失去進度 = 升級率崩
```

### 3. plan 欄位的 migration 要小心

```
v2.6 已有真實學員 A001 / A002
他們的 plan 欄位資料要正確對應到新 plan
建議：
- migration 之前 backup
- 上 production 前在 staging 跑
- 確認 A001 / A002 對應正確
```

### 4. Damon Note 系統的雙版本要早點規劃

```
v2.7 開始：
- 完整版（後台用、已有）
- 精簡版（前台 reveal、新做）

兩個版本如何分離：
A. 一次產生完整版、需要時改寫精簡版
B. 兩個版本獨立產生
C. 完整版 + 精簡版欄位

我建議 A：
- 一個完整版 source of truth
- 前台 reveal 時用 prompt 改寫成精簡版
- 改寫過程可控（避免精簡版洩漏太多）
```

---

## 📁 跟 v2.6 待辦清單的對齊

### v2.6 已完成、v2.7 沿用的（不要動）

```
✅ 學員登入雙重驗證
✅ 後台管理（學員列表、對話記錄、Damon Note）
✅ chat_v22.js 9 觸發、Day 6 七步驟、Safety
✅ yesterdayNote (week, day) 比較
✅ 入口問句後端抽取
✅ Welcome 頁置中
✅ 對話區桌面置中限寬 720px
✅ 開場訊息規則前置（內容換掉、結構不變）
```

### v2.6 還沒做、v2.7 要重新對應的

```
🟠 第二優先（v2.6）：Landing Page + 自動發編號
  → v2.7 改成：雙方案 Landing Page（Mike 寫文案、你接系統）

🟡 第三優先（v2.6）：Day 6 Report 系統
  → v2.7 改成：Day 7 整合 Email（透過 Brevo）

🟡 第四優先（v2.6）：Stripe 付款
  → v2.7 改成：雙方案付款 + 升級補差額付款（兩種付款連結）

🔵 第五優先（v2.6）：影片系統
  → v2.7 移除（第二階段才做）

⚪ 之後（v2.6）：Line Bot
  → v2.7 提前到本階段（接通知偏好）
```

---

## 📋 v2.7 完整待辦清單

```
🔴 必做、卡上線：
─────────────
□ Migration 002 plan 重定義（含 backup）
□ Migration 003 升級追蹤
□ Migration 004 通知偏好  
□ Migration 005 模組 3 週調整
□ chat_v22.js 拿掉影片邏輯
□ chat_v22.js 改 9 週進程
□ chat_v22.js 雙方案解鎖邏輯
□ api/students.js 升級流程 endpoint
□ Stripe 雙方案付款連結
□ Stripe 升級補差額連結（NT$1,500 / NT$2,000）

🟡 重要、可以稍等：
─────────────
□ index_v18.html 雙方案購買頁
□ index_v18.html 升級限時倒數 UI
□ Brevo Day 7 Email 整合（9 種模板）
□ LINE Bot 申請 + 整合
□ 通知偏好切換 UI

🟢 預留架構：
─────────────
□ api/notes.js 前台 reveal endpoint
□ Journal Report Export 架構
□ AI 教練 Starter Kit 產生器架構

⚪ 之後：
─────────────
□ 影片功能（第二階段）
□ 陪跑版、1對1 方案（之後再議）
```

---

## 🔗 跟 PRODUCT-TRUTH.md 的對應

每個改動的「真相依據」：

| v2.7 改動 | PRODUCT-TRUTH 段落 |
|---|---|
| 拿掉影片 | Part 2.1, Part 5.1 |
| 9 週進程 | Part 2.2 |
| 雙方案 | Part 2.6, 2.7 |
| 升級限時邏輯 | Part 2.6 |
| Damon Note 前台 | Part 2.4 |
| Day 7 Email | Part 2.10 |
| 通知偏好 | Part 2.10 |
| Starter Kit | Part 2.9 |

如果你看到衝突、PRODUCT-TRUTH 是真相、這份是執行細節。

---

## 💬 任何問題

執行過程有任何疑問：
1. 先看 `/See Yourself/00-PRODUCT-TRUTH.md`
2. 還不確定 → ping Vivi
3. 不要自己猜（v2.6 → v2.7 太多變動、別憑記憶寫）

---

*— Patrick Changelog v2.6 → v2.7 結束 —*

**See Yourself ｜ 2026-05-07**
