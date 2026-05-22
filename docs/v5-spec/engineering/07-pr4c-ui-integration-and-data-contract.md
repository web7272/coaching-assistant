# v5.0 PR-4c：UI 整合 + 前後端 Data Contract（交付物 7/6）

**作者**：Patrick ｜ 2026-05-22
**用途**：把設計師 UI 規格（看見自己-21天-UI設計規格.md + your_journey_storyboard_v2.html）對齊 v5.0 後端真實 schema，產出 Claude Code 能直接照做的 PR-4c 落地規格。
**前置**：交付物 1-6 + 設計師 UI 2 文件 + A001 v5.0 Day 1 親測（對話品質驗收通過）

> 本檔三個硬傷由 Patrick 直接拍板（Vivi 指示不回設計師喬）。決策可被 Vivi 推翻、但 Claude Code 以本檔為準。

---

## 0. 先講清楚：PR-4c 不是從零做

讀 origin code verify 後的事實（不是假設）：

| 元件 | 現況 | PR-4c 要做的事 |
|---|---|---|
| v5 對話引擎 | `claude/v5-p2-chatjs` 分支（領先 main 1 commit、**未 merge**）。A001「無敵」那場跑在這分支 preview | merge 前接好收尾 + 補 endpoint |
| `dayComplete` / `notesGenerating` | v5 chat.js **寫死 false**（檔頭明文「PR-4c api/finalize-day.js 接手」）| 把 v4 的 session_end 偵測接回 v5 |
| `api/finalize-day.js` | 存在、但走 v4 的 `module/week/day` + **「Day 6 一週」** | 改成 v5 的 21 天 / 7 天一週（Day 7/14/21）|
| Damon Note 生成 | `generateDamonNote` / `generateNotebookPage` 存在（chat.js export、finalize-day 依賴）| 不重寫、接線 |
| 週報 | `damon_notes.is_week_summary=true` 已存在、`generateWeekSummary` 已存在 | 觸發點從 `day===6` 改 `day∈{7,14,21}` |
| export 個人教練 prompt | `engine-4/export-personal-coach-prompt.js` + `user_profile_evolution.export_prompt_generated_at` 已存在 | 結業時生成 + 寄出 |
| cell 短句 / 21 句 | `last_session_day_summary.last_takeaway_term`（takeaway-planter 每天 session_end 種下）| **需新增每日 takeaway 持久化**（見 §3-C）|
| 旅程 / 教練卡 / 週報 / 結業 前端 | 無（v4 是 index.html 單頁）| 照 UI 規格新建 |
| email 登入（無 ID）| 無 | 新增（封閉測試用）|

**結論**：「結尾出不去、後端沒 Damon Note、沒有每日教練卡」= v5 團隊**刻意 defer 到 PR-4c 的計畫範圍**，不是 bug。PR-4c = 接線 + 6天週改7天週 + 前端 9 畫面 + email 登入。

---

## 1. 三個硬傷的決策（Patrick 拍板）

### 硬傷 1：UI 規格 §4.2 殘留「金錢事業」module 標籤 → 移除

UI 規格寫 header「Day 1『看見自己』、Day 2+『金錢事業·第N天』」。這是舊 9 週三模組的殘骸。

**決策**：v5.0 是 **3 週自我 only**。Day 1-21 整段 header 都是「**看見自己 · 第N天**」。
後端 `module='self'`（內部 moduleLabel='自我關係'、僅供 Damon Note prompt 用）→ 前端顯示名一律「看見自己」。Claude Code 不實作任何 module 切換。

### 硬傷 2：export 按鈕跟「紙感不向外展示」直接打架 → export 走 App 外（email）

UI 規格 §六 明文禁「Share / Copy / Screenshot / Download」按鈕、§4.7 結業頁只有「回到你的旅程 / 先這樣」。但 Founder bonus 是「個人教練 prompt 帶走」。設計師（紙感）vs 商業需求（要能帶走）衝突。

**決策**：21 天旅程**維持紙感、零 export 按鈕**。個人教練 prompt 走 **App 外交付**：
- 結業（Day 21 finalize）後端跑 `export-personal-coach-prompt.js` 生成 → 透過 **email（Brevo）寄給學員**（封閉測試用 email 登入、本來就有 email）。
- 結業頁加**一行平靜文字**告知（宋體、米色、符合 §4.7 語法）：例「你的教練、已經寄到你的信箱了。」**不放 download 按鈕**。
- `user_profile_evolution.export_prompt_generated_at` 記時間戳（已存在）。

> 這保住設計師意圖 + 商業需求兩邊。**若 Vivi 要 beta 方便、想要 app 內一顆「複製」鈕**，告訴我、我再加一個破例（只在結業頁、不進旅程）。

### 硬傷 3：UI 是「21 天 / 7 天一週」、後端是「6 天一週 + phase 制」 → 統一到 21 天日曆制

UI 假設 8×3 格（每列 7 daily + 1 weekly）、週報在 Day 7/14/21。後端 v4 finalize-day 在 `day===6` 出週報、且 v5 推進是 phase 制（非日曆 7 天）。

**決策**：
1. **旅程格子 = 日曆天驅動、跟 phase 脫鉤**。active cell = `session_day_count`（1-21）；phase 在對話內自己推進、不影響格子。
2. **週報 + weekly cell 在 `session_day_count ∈ {7, 14, 21}` 觸發**（7 天一週），finalize-day 的 `day===6` 改成這個邊界；`week = ceil(day/7)`。
3. **Day 21 同時生：daily note + 週報 III + 結業內容**（忠於 storyboard「週報 D7·D14·D21 三次」+「結業 D21」）。主轉場進**結業頁**（高潮）；週報 III 掛在 Week III cell 後面可回讀。
4. weekly cell I/II/III 點擊 → 開該週週報頁（§4.6）；結業全寬卡點擊 → 開結業頁（§4.7）。

---

## 2. 9 畫面 → 後端資料來源 → Claude Code 任務

| UI 畫面（規格 §）| 後端資料來源（verified）| Claude Code 任務 |
|---|---|---|
| §4.1 Email 入口 | 新 email 登入（無 ID）| 新 `POST /api/auth/email-login` + 前端 entry 頁 |
| §4.2 你的旅程（核心）| 新 `GET /api/journey`（讀 sessions + UPE）| 新 endpoint + 前端 grid（cell 元件 §三）|
| §4.3 對話頁 | `POST /api/chat`（v5 已有）| 前端對話 UI；callback 卡讀 `last_session_day_summary` |
| §4.4 收尾（教練在寫）| chat.js `dayComplete:true`（PR-4c 接）| chat.js 接 session_end → 前端 §5.2 轉場 |
| §4.5 教練筆記頁 | `POST /api/finalize-day` → `damonNotePublic`（damon_notes daily）| finalize-day 接線 + 前端筆記卡 |
| §4.6 週報頁 | `damon_notes is_week_summary=true`（新 `GET /api/week-report`）| 觸發改 7/14/21 + 新 endpoint + 前端 |
| §4.7 結業頁 | 新 `GET /api/graduation`（coach letter + 21句詩 + 宣言）| Day 21 生成 + endpoint + 前端 + email export |
| storyboard D2-D20 循環 | 同 §4.2-4.5 一套版型重用 | 一套 cell + 一套對話/筆記流程 |
| storyboard 結業宣言 | 21 句 = `daily_takeaways`（新增、§3-C）| 累積 takeaway → 結業詩 |

---

## 3. 前後端 DATA CONTRACT（Claude Code 照此實作）

### 3-A. `POST /api/chat`（v5 已有、PR-4c 補收尾欄位）

Request（v5 ignore `week`/`day`、但相容接收）：
```json
{ "studentId": "A001", "module": "self", "messages": [...], "today": "2026-05-22" }
```
Response（**PR-4c 把 dayComplete/notesGenerating 寫活**）：
```json
{
  "content": "...AI 回覆...",
  "turnCount": 12,
  "sessionId": 123,
  "phase": "phase_2",
  "routerPhase": "values_elicitation",
  "phaseAdvanced": false,
  "dayComplete": true,          // PR-4c：session_end 偵測（takeaway-planter / soft 25 / hard 40 turn）
  "notesGenerating": true,      // PR-4c：dayComplete 時 true、前端據此 fire finalize-day
  "turnsLeft": 28
}
```
收尾偵測接 v4 邏輯：assistant 回覆含收尾 marker（「明天從這裡繼續」等）或 hard limit → `day_complete=TRUE` + 回 `notesGenerating:true`。

### 3-B. `POST /api/finalize-day`（v4 shape、PR-4c 改 v5 numbering）

Request（**PR-4c：用 session_day_count、week 由後端 ceil(day/7) 算、前端不傳 week**）：
```json
{ "sessionId": 123, "studentId": "A001", "module": "self", "sessionDay": 7 }
```
後端流程：
```
1. generateDamonNote → damon_notes (is_week_summary=false)  [每天]
2. if sessionDay ∈ {7,14,21}: generateWeekSummary(week=ceil(day/7)) → damon_notes (is_week_summary=true)
3. if sessionDay === 21: 生結業內容 + export-personal-coach-prompt → email + set export_prompt_generated_at
4. 持久化當天 takeaway_term 到 daily_takeaways（§3-C）
```
Response：
```json
{ "ok": true, "alreadyDone": false, "damonNotePublic": "...教練筆記全文...", "isWeekBoundary": true, "isGraduation": false }
```

### 3-C. `GET /api/journey?studentId=A001&module=self`（**新建**、§4.2 旅程）

> 短句來源問題：`last_session_day_summary.last_takeaway_term` 只存「最後一天」一筆。21 格 + 21 句詩需要**每天一筆**。
> **PR-4c 新增**：finalize-day 時把當天 `{day, term}` append 進 `user_profile_evolution.daily_takeaways`（JSONB array、ON CONFLICT day 更新）。需一支小 migration（接現有最後一個 migration 之後）。Claude Code verify 現有 migration 號碼再開新號。

Response：
```json
{
  "module": "self",
  "moduleLabel": "看見自己",
  "currentDay": 7,
  "days": [
    { "day": 1, "state": "revealed", "phrase": "可以決定" },
    { "day": 7, "state": "active",   "phrase": null },
    { "day": 8, "state": "future",   "phrase": null }
  ],
  "weeks": [
    { "week": 1, "state": "active" },
    { "week": 2, "state": "future" },
    { "week": 3, "state": "future" }
  ],
  "graduation": { "state": "future" }
}
```
state 規則（對齊 cell 規格 §三）：
- `day < currentDay` 且有 takeaway → `revealed`（短句填中央）
- `day === currentDay`：今天還沒收尾 → `active-empty`（顯示「今天」）；已收尾 → `active-filled`（短句）
- `day > currentDay` → `future`
- weekly cell：該週最後一天已過 + 週報已生 → `revealed`；當週進行中 → `active`；未到 → `future`
- graduation：Day 21 收尾後 → `revealed/active`；否則 `future`

### 3-D. `GET /api/note?studentId=A001&module=self&day=3`（§4.5 重讀教練筆記）

回 `damon_notes`（is_week_summary=false）該天 note_text。revealed cell 點擊用。
```json
{ "day": 3, "noteText": "...教練筆記全文...", "exists": true }
```

### 3-E. `GET /api/week-report?studentId=A001&module=self&week=1`（§4.6 週報）

回 `damon_notes`（is_week_summary=true）該週 summary。
```json
{ "week": 1, "title": "從不能停，到可以決定", "body": "...週報全文...", "exists": true }
```
> `title`（主題短句）：若 generateWeekSummary 沒輸出標題、PR-4c 在 summary prompt 加一行「第一行給一個 ≤12 字主題短句」。

### 3-F. `GET /api/graduation?studentId=A001&module=self`（§4.7 結業）

```json
{
  "coachLetter": "...教練見證信 4 段...",
  "poem21": ["可以決定", "是繼承的", "我不能停", "..."],   // daily_takeaways 21 句
  "declaration": "我是一個可以決定的人。",
  "exportedToEmail": true,
  "exists": true
}
```

### 3-G. `POST /api/auth/email-login`（§4.1 無 ID 登入、封閉測試）

Request `{ "email": "x@y.com" }` → 後端用 email 找 / 建 student（無密碼、無 ID 認證）→ 回 `{ studentId, module, currentDay }`。
> 測試期：email = 唯一身分。正式版認證另議（UI 設計階段再談、Vivi 已交代先記下）。

---

## 4. dayComplete → 收尾 → 教練筆記 時序（對接 UI §5.2）

```
前端對話頁
  └─ POST /api/chat
        └─ resp.dayComplete=true & notesGenerating=true
              └─ 前端跑 §5.2 轉場（input 退場 → 「教練在寫今天的字」hold ~2.8s）
                    └─ 同時 fire POST /api/finalize-day
                          └─ resp.damonNotePublic
                                └─ fade 進 §4.5 教練筆記頁（render damonNotePublic）
                                      └─ 「✦ 已收下」+ [回到你的旅程][明天見]
```
**關鍵**：收尾由 **AI 判斷**（UI §六：NO「結束今天」學員按鈕）。前端不提供結束鍵、只監聽 `dayComplete`。

---

## 5. 落地優先序

```
P0 — 後端接線（前端全依賴）
  1. chat.js 接 session_end → dayComplete/notesGenerating 寫活（接 v4 marker 偵測）
  2. finalize-day v5 化：sessionDay 入參、week=ceil(day/7)、週報觸發改 7/14/21
  3. 小 migration：user_profile_evolution.daily_takeaways JSONB（verify 現有號碼開新號）
  4. finalize-day 寫 daily_takeaways；Day 21 生結業 + export email

P1 — 新 endpoint
  5. GET /api/journey、GET /api/note、GET /api/week-report、GET /api/graduation
  6. POST /api/auth/email-login

P2 — 前端（照 UI 規格、嚴格遵守紙感 + 互動禁區 §六）
  7. cell 元件（4 state、§三）+ 你的旅程頁（§4.2）
  8. 對話頁（§4.3）+ 收尾轉場（§4.4 + §5.2）
  9. 教練筆記頁（§4.5）/ 週報頁（§4.6）/ 結業頁（§4.7）
  10. Email 入口（§4.1）

P3 — 整合 + 驗收
  11. merge v5-p2-chatjs → main（接好收尾後）
  12. A001 v5.0 完整重走（Day 1 → 結業 + Damon Note + 跨日 + 週報 + 結業 email）
```

---

## 6. 風險 + 注意

| 風險 | 緩解 |
|---|---|
| 前端做成 chatbot / SaaS 感（破壞紙感）| UI 規格 §六 + §九 是硬約束、code review 逐條對 |
| 自動 scroll / typing dots / loading spinner | §5.4 禁用清單、明確 NO |
| daily_takeaways 沒在每天寫 → 21 句詩缺格 | finalize-day 每天必寫、A001 重走逐天 verify |
| 週報觸發還停在 day===6 | grep finalize-day 確認改成 7/14/21、單測 |
| Day 21 三生成（note+週報+結業）超時 | finalize-day maxDuration 60s、結業 export 可 fail-soft 後補 |
| email 登入無認證被當正式版 | 明標「測試期專用」、正式版認證 UI 階段再做 |
| merge v5-p2-chatjs 前沒接收尾 → main 仍 dayComplete:false | P0-1 先做完才 merge（守則：不假設）|

---

## 7. 給 Claude Code 起手指示

```
1. 先讀本檔 + UI 規格（看見自己-21天-UI設計規格.md）+ storyboard
2. 確認分支：v5 對話在 claude/v5-p2-chatjs（未 merge）、所有 PR-4c 後端接線基於此分支
3. 嚴格按 P0 → P3 優先序（前端全依賴後端 endpoint）
4. data contract（§3）是合約、endpoint 回傳 shape 不自己改；要改先 ping Patrick
5. 前端嚴守 UI §六互動禁區 + §九常見錯誤（無 download / 無 streak / 無 typing dots / 無紅色錯誤 / 無自動 scroll）
6. 每個 endpoint 寫 unit test（特別 journey state 規則 + 週報 7/14/21 邊界 + daily_takeaways 累積）
7. 收尾接好「才」merge v5-p2-chatjs（不假設 dayComplete 已通）
8. 卡住 / contract 不夠 → ping Patrick、不自己猜 UI 或方法論
```

---

*— PR-4c UI 整合 + data contract v0.1 ｜ Patrick ｜ 2026-05-22 ｜ 三硬傷已拍板、等 Vivi 過目後給 Claude Code —*
