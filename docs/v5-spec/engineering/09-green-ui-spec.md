# 看見自己 v2.1-green · UI 規格（交付物 9）⭐ Patrick 接手設計師

**作者**：Patrick（接手設計師）｜ 2026-05-23
**用途**：給 Claude Code 落地的完整綠色版 UI 規格。**supersedes 所有先前 UI 版本**（v1 霧綠格子、設計師 v2.1 金棕、水彩地圖皆作廢）。
**定調來源**：品牌 logo（綠色望遠鏡「看見自己」）+ Vivi 5/23 逐頁定案 + 21 天植物成長插畫。

---

## 0. 哲學定調

- **品牌綠、溫暖、有插畫、有包裝**——從 logo（綠 + 望遠鏡 + ✦）長出來。不是金棕、不是冷極簡、不是滿版水彩。
- **手機優先**：所有學員頁 = 置中單欄（手機 / 桌面共用同一版、見 §3）。
- **完成驅力來自內在滿足**：路會亮起來（走過的點被連起來 + 打勾）、**植物一天天長大**（插畫揭開）、寶藏解鎖。**不做** streak 焦慮、loss aversion、X/21 計數、社交炫耀、虛假徽章（不走 Duolingo 操控）。
- **教練不是諮商**：成人、付費走深、語氣暖但成熟。

---

## 1. 色彩系統（定案）

```css
:root {
  --bg-mint:        #D7EBD1;  /* 主背景（學員頁）*/
  --green-walked:   #5DA873;  /* 走過的日子（格子填色）*/
  --green-forest:   #2C5238;  /* 深森林綠：標題/深色 */
  --peach-today:    #F4C9A0;  /* 今天的格子（暖色對比）*/
  --gold-accent:    #E3B340;  /* 勾 / ✦ / 寶藏 / 光暈 */
  --tile-future:    #EAF4E6;  /* 未到的格子 */
  --neutral-step:   #B9A88C;  /* 腳印 / 中性 icon（非綠）*/
  --paper-card:     #FBF6EC;  /* 卡片：筆記 / 報告 */
  --brand-green:    #3E9D5C;  /* 主按鈕（建置時取 logo 精確綠）*/
  --text-primary:   #2C3A2C;
  --text-secondary: #6E8A6E;
  --text-faint:     #A7BCA4;
}
```

**禁用**：金棕系（作廢）、霧綠 sage（作廢）、純黑純白、紅綠 status、霓虹。
**建置註**：`--brand-green` / `--green-walked` 上線前由 Vivi 提供 logo 精確色值校準。

---

## 2. 字體

```css
--font-serif: 'Noto Serif TC','Songti SC','Songti TC',serif;  /* 產品在說話：標題/對話/筆記/報告/按鈕 */
--font-sans:  'Noto Sans TC','PingFang TC',sans-serif;         /* 數字/輸入：圓圈數字、輸入框、英文代號 */
```
靠**字級對比**拉重量、**不用 bold**（中文加粗破壞紙感）。

---

## 3. 響應式策略 ⭐

- **學員 app = 手機優先「置中單欄」**：桌面上 render 成置中 **440–480px** 寬的欄，左右是 `--bg-mint` 紙感底填滿螢幕。**一套設計、不做第二套桌面版。** 旅程那條路也是直的、置中、手機桌面共用（**不需要橫向桌面地圖**）。
- **教練後台 `/coach` = 桌面寬**（管理工具、學員清單/進度表，另案、套綠即可）。

---

## 4. 元件

### 4.1 DayTile（日子格子）

每天一格、共 21 個、3 欄棋盤（蛇行排列、見 §5.2）。圓角方塊（rx 14、約 76px）。

| State | 填色 | 內容 | 連線 | 可點 |
|---|---|---|---|---|
| `completed`（走過）| `--green-walked` | 當天**植物插畫** + 數字(左上,白) + ✓(右上,`--gold-accent`金圈白勾) | ✅ 被點點線連上 | ✅ → 該天教練卡 |
| `active`（今天）| `--peach-today` | 當天**植物插畫** + 數字 + 「開始」綠 pill | ✅ 線連到此為止 | ✅ → 對話頁 |
| `future`（未到）| `--tile-future` | **腳印** icon(`--neutral-step`) + 數字(faint)、**不顯示插畫** | ❌ 無線 | ❌ |

- **植物插畫**：21 張水彩成長圖（day1 種子 → day21 美麗粉花），day N = 第 N 階。**只在 completed / active 顯示**（走到才揭開、像看自己長大）；future 用腳印。
- **active 金色光暈**：格子後一圈柔和 `--gold-accent` 光暈（radial、約 2.5× 半徑），**極微呼吸** opacity 1.0↔0.85、3s loop。
- **數字** sans、completed/active 用白、future 用 `--text-faint`。

### 4.2 連線（點點路徑）⭐

- 蛇行 dotted 線（`--brand-green`、`stroke-dasharray:"1 9"`、round cap = 點點）。
- **只連「已對話（completed）+ 今天（active）」的日子**；future 之間**沒有線**。線隨完成一天天長出來——這是完成驅力本身。

### 4.3 TreasureBox（寶藏）

底部「你的寶藏」架、一排 5 個（= 5 phase）。

| State | 視覺 | 可點 |
|---|---|---|
| `locked` | 中性灰棕箱（`--neutral-step` 系）| ❌ |
| `unlocked` | 金色箱（`--gold-accent`）+ 微金光 | ✅ → 該 phase report |

- 解鎖時機由後端 phase 完成 milestone 決定（不綁特定天）。

### 4.4 按鈕

```css
.btn-green { background:var(--brand-green); color:#FFF; font:serif 15px; letter-spacing:4px; padding:14px 36px; border-radius:10px; }  /* 主：開始/送出 */
.btn-gold  { background:var(--gold-accent); color:#3A2E10; ... }  /* 強調往前（備用）*/
.btn-paper { background:var(--paper-card); color:var(--text-primary); border:0.5px solid var(--green-walked); ... }  /* 卡片雙選 */
```

### 4.5 其他
- **輸入框**：`--paper-card` 底、`--green-walked` focus border、placeholder serif italic `--text-faint`。
- **Pace 卡（radio）**：選中 = `--paper-card` 底 + `--green-walked` 邊 + 深綠圓點。
- **卡片**：`--paper-card`、0.5px border、rx10、無 shadow/gradient。

---

## 5. 頁面 Layout

### 5.1 Entry（首頁）— 定案
- 上：**logo hero**（綠望遠鏡「看見自己」插畫、Vivi 提供）+ 產品名「看見自己」。
- 表單（同頁 3 樣）：① email ②「我可以怎麼稱呼你？」placeholder「名字或暱稱、隨你」③ 步調二選一：
  - 「**一天一輪對話**」（預設）副字「每天沉澱一晚，隔天再繼續。」
  - 「**依自己的步調**」副字「想連著多走幾天，也可以。」
- CTA：「**開始**」`.btn-green`。
- 校驗失敗：input border 變 `--green-walked` + 下方 serif italic 小字。
- 送出 → init 學員 → Map。

### 5.2 Journey（旅程 / 主頁）— 定案
- 標題「**{name} 的看見自己之旅**」serif 19、`--green-forest`；副標「**一步一步，走進自己**」serif italic。**無進度條、無 X/21 計數。**
- **3 欄棋盤、蛇行排列**（row1 左→右、row2 右→左…），21 格 + 點點連線（§4.2）+ active 金光（§4.1）+ 植物插畫。
- 底部「**你的寶藏**」架：5 寶藏（§4.3）。
- 點 active → 對話；點 completed → 該天教練卡；點 unlocked 寶藏 → phase report。

### 5.3 對話頁 — 沿用結構 + 換綠
- 標題「{name} · 第 N 天」。
- **AI 開場先出現**（kickoff、起手式「在你的生命裡，你想要什麼?」、後端已建）。
- AI 訊息 serif **17**（從 19 調小、不要太快捲頁）、`--text-primary`；使用者泡泡 sans 15、`--green-walked` 淺底（如 `#C8E4C2`）。
- ✦ / ambient = `--gold-accent`。
- 輸入框 + 「**送出**」`.btn-green`（Enter 也送、Shift+Enter 換行）；下方提示「**慢慢來，我等你**」。
- 收尾（§7 時序）：輸入框退場 → 「**教練在寫今天的字**」**帶動態**（trailing dots「…」循環 或 ✦ 呼吸、**不要 SaaS spinner**）→ fade 進教練卡。

### 5.4 教練卡（單張日卡）— 沿用 + 換綠
- 「教練筆記」serif 11 lts4 `--green-walked` + divider（`--gold-accent`）。
- body：**warm 第二人稱「你」版**（後端 `sessions.notebook_page`、已 B1 修；**絕不**顯示 SC 觀察/Layer/工具/採集追蹤）。serif 14.5、`--text-primary`。
- 「— 教練」serif italic `--text-secondary` 右。
- 「**✦ 已收進你的旅程**」（金 ✦）。
- 雙選 `.btn-paper`：從對話進來 = 「回到旅程」/「明天見」；從格子點進來 = 「回到旅程」單顆。

### 5.5 Phase Report（你的寶藏）— 新頁 ⭐
- 標題「**{name} · 你的寶藏**」（不是「你的旅程」）。
- 卡片（`--paper-card`、**較長、可捲——里程碑份量、不是日卡**）：
  - 「PHASE N」sans 10 lts4 `--gold-accent` + 「{phase 名稱}」serif 17 + divider。
  - **上半「短教學」**：該 phase 的自我概念課（§8 的 5 篇蒸餾教學之一、固定、約 6–8 行）。
  - **中間 ✦** 分隔（`--gold-accent`）。
  - **下半「你的突破」**：橫跨整個 phase 的突破彙整（從該 phase 累積的 Damon Note 生成、含學員關鍵原話、用「你」、約 6–8 行）+ 一句往前。
  - 「— 教練見證」+「**✦ 已收進你的寶藏**」+「回到旅程」`.btn-paper`。
- **5 phase 名稱（定案）**：① 找到你真正要的 ② 你是誰 ③ 擴大地圖 ④ 串連起來 ⑤ 放手帶著走。

### 5.6 結業頁（Day 21）— 沿用 + 換綠（內文待打磨）
- 「結業」serif 12 lts5 `--gold-accent` + divider。
- 教練見證信（你）+ 21 句詩（3 行、· 分隔、來自 daily_takeaways）+ 宣言（置中大字、「我是一個___的人」）。
- 「— 教練見證」+「✦ 已收進你的旅程」。
- 一行「**你完整的旅程報告，已經寄到你的信箱了。**」（深度 PDF 通知、見交付物 08）。
- 按鈕：「**回到旅程**」**單顆**（拿掉「先這樣」）。
- ⚠️ 見證信 / 21 句 / 宣言內文 Vivi 之後打磨；此頁先鎖版面。

---

## 6. 互動 Map

| Tap | 結果 |
|---|---|
| future 格 / locked 寶藏 / 腳印 | 無反應 |
| active 格（今天）| → 對話頁 |
| completed 格 | → 該天教練卡 |
| unlocked 寶藏 | → 該 phase report |
| 學員名標題 | 無反應 |

---

## 7. 動畫 / 轉場

| 觸發 | 動畫 | 時長 |
|---|---|---|
| 頁載入 | fade-in | 400ms |
| active 金光 | opacity 1.0↔0.85 呼吸 | 3s loop |
| 完成當天回 map | 該天插畫揭開（fade）+ 線多連一段 | ~600ms |
| 寶藏首次解鎖 | locked→unlocked + 金光 fade-in | 800ms |
| 對話收尾 | 輸入框退(250ms)→「教練在寫」動態 hold→fade 進卡片(§5.3) | 依 finalize |

**禁用**：confetti、彈跳、爆炸、音效、震動、SaaS spinner、自動 scroll（學員自己捲）。

---

## 8. 5 Phase 短教學核心（蒸餾、給 Phase Report 上半）

來源：Damon 自我概念方法（Vivi 5/23 影片對應）。**學員版、文字、短**：

1. **找到你真正要的**：你以為要的（成功/錢/目標）多半是別人貼的標籤；真正要的藏在底下、是一種感覺/狀態。一層層往下挖（「擁有這個對你有什麼重要」）到最純粹的那個。
2. **你是誰**：身份只是你對過去經驗的「歸納」——你可以重組它。把最高價值觀變成你堅定的特質；不用否定句定義自己（大腦聽不懂「我不要…」）。
3. **擴大地圖**：地圖≠疆域；你卡住是因為手上的地圖太貧乏（刪減/扭曲）。用「反例」軟化舊信念、加入更多選擇與證據，限制就鬆動。
4. **串連起來**：阻力不是敵人、是過時的保護程式。找出它的「正向意圖」、邀請那個被你壓下的部分回家，內在從分裂走向同頻。
5. **放手帶著走**：不靠意志力（那是把自己切兩半、跟自己開戰）；放下罪惡感（它只是提醒你違背了某個價值、補救即可）；與價值對齊後順流而行。

> 實作：每 phase 上半用對應這篇教學（固定）、下半用該 phase 的 Damon Note 生成突破彙整。Phase Report 生成 prompt = 交付物 09b（待寫）。

---

## 9. Assets

| Asset | 來源 | 備註 |
|---|---|---|
| 21 張植物成長插畫（day1 種子 → day21 粉花）| **Vivi 已提供** | 嵌 DayTile（completed/active）、day N = 第 N 階 |
| logo hero（綠望遠鏡）| Vivi 提供 | Entry 頁 |
| 腳印 / 寶藏 / 點點線 / 金光 | **SVG/CSS 自畫** | 不需美術 asset |
| 紙張紋理（可選）| 極微 PNG 或 CSS noise | 10–15% opacity、極微 |

→ **這版幾乎零美術依賴**（除了 Vivi 已給的 21 插畫 + logo）。

---

## 10. 跟後端 / 既有的關係

- `/api/journey` 要回：`learner{name,pace}`、`days[{day,state}]`（state: completed/active/future、插畫用 day 序號對應）、`phases[{phaseId,name,state}]`（**weeks[] → phases[]**、取代舊週報）。
- 每日卡 = `notebook_page`（warm、已建）；教練分析 = `damon_notes`（/coach）。
- **Phase Report = 新生成**（§8 教學 + 該 phase Damon Note 突破彙整）、phase-advance milestone 觸發。**取代舊週報（is_week_summary, Day 7/14）**——週報概念正式收掉、改 phase report。
- 深度 PDF（Day 21 email）= 交付物 08。
- kickoff 開場 / pace / 個人化 / daily_takeaways = PR-4c 已建。

---

## 11. 落地序（給 Claude Code）

```
P0 design system：定案色票 token + 字體 + 3 按鈕 + 卡片/輸入/pace radio
P1 Entry（logo hero + 3 表單 + 開始）— 換綠
P2 Journey：DayTile（4 state + 植物插畫 + ✓/腳印）+ 點點連線（只連 completed）+ active 金光呼吸 + 寶藏架
P3 對話頁 / 教練卡 / 結業頁：沿用結構換綠 + 文案（送出 / 慢慢來我等你 / 已收進你的旅程 / 結業拿掉先這樣）
P4 Phase Report（新頁、你的寶藏、短教學 + 突破彙整、里程碑長度）+ weeks→phases endpoint
P5 桌面置中單欄 + /coach 套綠
```

---

*— 綠色版 UI spec v1 ｜ Patrick 接手設計師 ｜ 2026-05-23 ｜ 設計全定案、等 Vivi 過目 → 交 Claude Code —*
