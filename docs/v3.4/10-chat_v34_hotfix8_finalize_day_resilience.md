# v34 Hotfix 8 — finalize-day resilience（retry + lazy recovery + admin 重生）

**版本**：v34 hotfix 8
**寫於**：2026-05-11 晚
**作者**：Patrick
**狀態**：spec 寫完、**等 Vivi 給綠燈**
**前置**：Option C async（commit `11aa8bd`）已 production、本 patch 是補它的 safety net

---

## 🎯 問題（A001 Day 3 → Day 4 verified）

**現象**：A001 Day 4 開場 yesterdayNote 抓到 Day 2 的「付出讓我感到滿足」、不是 Day 3 的「我想要被愛」。

**Vivi verify 結果**：A001 後台 Damon Note tab 確認 Day 3 沒有 Damon Note。

**Root cause**（時序還原）：
1. Day 3 chat 過程中 + 收尾共 9 次連線錯誤
2. 最終一次 chat 成功 → backend set dayComplete=TRUE、回 notesGenerating: true
3. Frontend 收到、顯示「筆記本正在整理中」placeholder + fire POST /api/finalize-day
4. /api/finalize-day call Anthropic 跑 generateDamonNote → 失敗（Anthropic API 不穩或 timeout）
5. Frontend retry 1 次（5 秒後）→ 又失敗
6. Frontend 顯示「筆記本生成失敗。**下次打開 App 會自動補上。**」（這句是 swapPlaceholderWithNotebook 的 graceful failure 文字）
7. **這個「下次打開 App 會自動補上」是假的承諾**——目前 code 沒任何地方實作 lazy recovery
8. Day 4 開、yesterdayNote query → Day 3 damon_note IS NULL → fallback Day 2

→ Option C 第一次真實 failure、缺三層防護：
- L1 frontend retry 只 2 次太少
- L2 沒 lazy recovery（學員回來 App 不會自動 backfill）
- L3 沒 admin 手動觸發按鈕（Vivi 看到問題沒辦法修）

---

## 🔧 修法（三層、優先序由高到低）

### Layer 2 ⭐ 最重要 — yesterdayNote query lazy recovery

**檔案**：`api/chat.js` 裡 yesterdayNote query 函數（或 sessions.js 載入 Day N 流程）

**邏輯**：
```js
// Day N 打開 App 時、frontend 載入「昨天 Damon Note」
// 對應 backend query: 找 student 最近的 day_complete=TRUE session

const yesterdaySession = await sql`
  SELECT id, damon_note, day, module
  FROM sessions
  WHERE student_id = ${studentId}
    AND day_complete = TRUE
    AND (module, week, day) < (${currentModule}, ${currentWeek}, ${currentDay})  -- 嚴格在今天之前
  ORDER BY (module, week, day) DESC
  LIMIT 1
`;

if (yesterdaySession.length > 0) {
  const last = yesterdaySession[0];

  // ⭐ Lazy recovery：last day complete 但 damon_note 不存在 → 觸發 backfill
  if (!last.damon_note) {
    console.log(`[lazy-recovery] Day ${last.day} damon_note missing, triggering backfill`);
    // Fire-and-forget POST 到 finalize-day（不阻塞當前 query）
    fetch(`${BASE_URL}/api/finalize-day`, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({
        sessionId: last.id,
        module: last.module,
        week: yesterdayWeek,
        day: last.day,
      })
    }).catch(e => console.error('lazy-recovery failed:', e.message));

    // 返回時 yesterdayNote 仍 null（這次學員 Day N 開場用 fallback）
    // 但下次學員打開 App 時、damon_note 已 backfill、會正確顯示
    return null;
  }

  return last.damon_note;
}
```

**好處**：
- 學員不需要知道發生過 failure、第二次打開 App 就好了
- 不阻塞當前 query、學員體驗 0 影響
- finalize-day 是冪等的、重複觸發安全

### Layer 1 — Frontend retry 從 2 次拉到 3 次 + 加 visual signal

**檔案**：`index.html` 裡 `triggerFinalize` 函數

**改動**：
```js
async function triggerFinalize(sessionId, placeholderId, attempt = 1) {
  if (!sessionId) return;
  try {
    const res = await fetch('/api/finalize-day', { ... });
    if (!res.ok) throw new Error('finalize HTTP ' + res.status);
    const data = await res.json();
    swapPlaceholderWithNotebook(placeholderId, data.notebookPage, data.damonNotePublic);
  } catch(e) {
    console.warn('finalize attempt', attempt, 'failed:', e.message);
    // v34 hotfix 8：retry 從 2 次 → 3 次、backoff 5s → 10s → 20s
    if (attempt < 3) {
      const backoff = attempt === 1 ? 5000 : 10000;
      setTimeout(() => triggerFinalize(sessionId, placeholderId, attempt + 1), backoff);
    } else {
      // 仍然失敗、graceful 顯示
      // ⭐ 文字改成更真實：「Vivi 教練的筆記本明天會自動為你補齊」
      //    這時候 Layer 2 lazy recovery 會接手、學員明天打開就好
      swapPlaceholderWithNotebook(placeholderId, null, null);
    }
  }
}
```

**graceful failure 文字也要改**（在 `swapPlaceholderWithNotebook`）：
```html
<span style="color:var(--mid);">
  筆記本還在整理。Vivi 教練的筆記本明天會自動為你補齊。
</span>
```

### Layer 3 — Admin UI「重新生成」按鈕

**檔案**：admin Damon Note tab 頁面

**改動**：每個 session 旁加「重新生成」按鈕、按下 POST /api/finalize-day。Vivi 看到 missing 可以 1-click 補。

**好處**：Layer 2 沒接到的邊界 case（學員 churn 沒回來）Vivi 仍可手動補。

---

## 📊 三層防護表

| Layer | 觸發 | 涵蓋 case |
|---|---|---|
| L1 frontend retry 3 次 | 學員 Day N 收尾當下、connection error | Anthropic 短暫波動（90% 救回）|
| L2 yesterdayNote lazy recovery | 學員 Day N+1 打開 App | L1 沒救到的 case（學員下次打開自動補）|
| L3 admin 重生按鈕 | Vivi 後台看到 | L2 沒救到（學員 churn 不回來、或多日同時 missing）|

A001 Day 3 case：L1 失敗（API 真的掛了 7 次）→ L2 接手（Day 4 開啟時 backfill）→ L3 不需要動。

---

## ✅ 驗證 checklist

- [ ] **L2**：手動刪除某 student 某 Day 的 damon_note + notebook_page、然後打開下一 Day → 看 console log「[lazy-recovery] triggering backfill」→ 30 秒後再 query DB 確認 damon_note 已生成
- [ ] **L2**：lazy-recovery 不阻塞 yesterdayNote 返回（學員不會等）
- [ ] **L1**：finalize-day endpoint 模擬 fail（暫時改成回 500）、看 frontend retry 3 次後 graceful 顯示
- [ ] **L3**：admin 按「重新生成」、看 endpoint 被 call、damon_note 寫進 DB

---

## 🚀 落地動作（給 Claude Code 的 prompt）

```
讀 docs/v3.4/10-chat_v34_hotfix8_finalize_day_resilience.md

任務（按順序）：
1. api/chat.js（或 sessions.js）：yesterdayNote query 加 lazy recovery 邏輯（spec Layer 2）
2. index.html triggerFinalize：retry 2 → 3、backoff 5s → 10s → 20s（spec Layer 1）
3. index.html swapPlaceholderWithNotebook graceful failure 文字改成「明天會自動為你補齊」
4. admin Damon Note tab：每個 session 加「重新生成」按鈕 + POST 到 /api/finalize-day（spec Layer 3）

不動:
- api/finalize-day.js endpoint 本身（已經是冪等的、直接重用）
- chat.js DAMON_CORE prompt 主體
- migration_009 schema

完成後 commit message：「v34 hotfix 8: finalize-day resilience (L1 retry + L2 lazy recovery + L3 admin 重生)」
推 main、自動 deploy Vercel。

⚠️ 重要 process：本 patch 含 backend lazy-recovery（fire-and-forget 新增 internal API call）+ admin UI 改、建議推前先 ping Patrick / Vivi confirm、不要自推。
```

---

## 📌 Backfill A001 Day 3（hotfix 8 之前的手動修補）

Hotfix 8 寫完落地前、A001 Day 3 已經 missing 了、要先手動 backfill 讓 Day 5+ yesterdayNote 鏈接得回去。

**步驟**（Vivi 操作）：
1. 開 production App → 登入 admin（coach-login.html）
2. 找 A001 → Damon Note tab
3. 找到 Day 3 那一筆（damon_note 應該空白）→ 記下 sessionId
4. Browser DevTools → Console → 貼：

```js
fetch('/api/finalize-day', {
  method: 'POST',
  headers: {'Content-Type': 'application/json'},
  body: JSON.stringify({
    sessionId: <貼 Day 3 sessionId>,
    module: 'self',
    week: 1,
    day: 3,
  })
}).then(r => r.json()).then(console.log);
```

5. 等 30 秒、看 console 輸出 `{ok: true, alreadyDone: false, damonNotePublic: "...", notebookPage: "..."}`
6. 後台 refresh → Day 3 Damon Note 應該已生成
7. ✅ A001 Day 5 開、yesterdayNote 會抓 Day 4 的、Day 4 的會抓 Day 3 的（鏈接修好）

---

## 🔗 Tasks

- Task #36 ✅ Verify Day 3 Damon Note 是否寫進 DB（已確認沒生成）
- Task #38 ⏳ Backfill A001 Day 3 Damon Note（手動 curl/DevTools、Vivi 操作）
- Task #39 ⏳ Hotfix 8 落地（本 spec）

---

*— Patrick ｜ v34 hotfix 8 ｜ 2026-05-11 —*
