// lib/damon-reframe-library/r8-tote-framework.js
// v5.1 Step 7 PR-7b — R8 T.O.T.E. Framework (Test-Operate-Test-Exit).
//
// Source: v51_errata_v02_damon_supplementary_tier1_tier2.md §1 Patch 1.
// 話術 = errata v0.2 §1.4 4_steps_complete_spec 逐字.
// Positioning: 行動 framework (不是 reframe direction), Damon 體系核心 NLP 方法論.
//
// ⏸️ 暫留 (本檔不實作):
//   - R8 Bias towards Action statement (errata v0.3 Patch 4) — Vivi 之後 decide.
//   - R10 共生 statement — R10 整個廢除.

const DAMON_QUOTES = Object.freeze([
  'NLP 使用 T.O.T.E. 模型(測試—操作—測試—退出)來描述成功的過程',
  '如果不是 T.O.T.E. 循環、你會反覆做同樣的事卻期待不同結果',
  '將失敗視為回饋、像科學家做實驗一樣、藉由排除錯誤的路徑來逼近成功',
  '清晰度源於行動產生的回饋、而非沙發上的空想',
  '執行一個微小到不可能失敗的操作',
  '成功的退出意味著你不再重複舊有的、無效的操作',
]);

const MODE_APPLICABILITY = Object.freeze({
  elicitation:        'applicable',     // 引導 Operate 微小行動
  identity_anchoring: 'not_applicable', // focus on quality status
  integration:        'applicable',     // 反例整合作 T.O.T.E. Test cycle
  cascade:            'applicable',     // Top 2/3 身份測試是 Test step
  future_pacing:      'primary',        // ✓✓✓ 主要 mode、3 時間維度後規劃 cycle
  crisis:             'not_applicable', // SOP 優先
});

/**
 * Build R8 SYSTEM INJECT — 4-step T.O.T.E. cycle per errata §1.4.
 *
 * @param {object} ctx — { mode?, goal_quote?, prior_invocations?, failure_event? }
 * @returns {string}
 */
export function buildInject(ctx = {}) {
  const mode = ctx.mode || 'future_pacing';
  const goalQuote = ctx.goal_quote || '[學員 surface 的目標 / 行動方向]';
  const prior = Number(ctx.prior_invocations || 0);

  // R8_F2 過度 invoke (> 2 / session) → framework rigidity 風險、降頻.
  if (prior >= 2) {
    return `[SYSTEM INJECT — R8 T.O.T.E. (downsized, prior=${prior})]

session 內 R8 已 invoke ${prior} 次、降頻避免 framework rigidity (failure_mode R8_F2).
不再 walk-through 4 step、改 reference 既有 cycle:

> 「上次我們開了一個 T.O.T.E.——${goalQuote}。
>  那個 cycle 走到哪了?」

機制:
- 不教 NLP 工具、回到自然對話.
- failure_mode R8_F1 避免: 每個 step 都是 success in itself、不要 framework rigidity.`;
  }

  // Vivi 6/19 — R8 綁 step 7(標籤定錨):T.O.T.E. 是定錨的引擎、Operate = 每天掃描 1% 微證據按讚存檔.
  const step7Line = Number(ctx.sc_journey_step) === 7
    ? 'step 7 標籤定錨:T.O.T.E. 就是定錨引擎 —— Operate 步 = 「24h 內抓 1% 微證據、按讚存檔」(讓她自己講方法、你不替她舉證).\n'
    : '';

  return `[SYSTEM INJECT — R8 T.O.T.E. Framework (4-step)]

${step7Line}mode: ${mode}.
trigger: 學員 surface 行動猶豫 / 等待完美條件 / 不知道下一步「${goalQuote}」.

⚠️ context filter:
- 不在 crisis mode active 時 invoke (SOP 優先).
- 不在學員 surface emotional surface (「我感覺很重」) 時 invoke.
- 僅 action-oriented context 內 invoke.

話術 (errata v0.2 §1.4 4_steps_complete_spec 逐字):

**Step T — Test Baseline (設定基準與目標)**:
> 「先停一下、我們把這個拆成 4 步。
>  第一步: 你現在的狀態是什麼?想去到哪?
>  不需要完美定義、大概的就好。」

禁止:
- 不要求學員「精確量化」 (會觸發完美主義)
- 不要學員「先完整想清楚」

**Step O — Operate (採取微小行動)**:
Damon 親口: 「執行一個微小到不可能失敗的操作」.
> 「第二步、做一個小到不能失敗的動作——
>  不是『做對』、不是『完成』、是『動』。
>  你想到什麼?最小的那一步是什麼?」

禁止:
- 不要學員「等準備好」
- 不要訂「大目標」 (會觸發拖延)
- 不問「你 commit 嗎」 (會觸發完美主義抗拒)

**Step T — Test Feedback (獲取回饋並更新地圖)**:
Damon 親口: 「將不理想的結果視為修正地圖的回饋、而不是價值的減損」.
> 「第三步、做完回來看——
>  結果跟預期一樣嗎?哪些對、哪些不對?
>  從這次學到什麼?
>
>  注意: 這不是『判決』、是『情報』。」

若失敗:
> 「這不是失敗、這是黃金情報。
>  你排除了一個行不通的路徑、離答案更近了。
>  科學家不會因為實驗結果而質疑自己的價值。」
→ cascade R3 失敗作為 Feedback (此 step 失敗 + 學員 self-blame).

**Step E — Exit (達成一致並轉向)**:
Damon 親口: 「成功的退出意味著你不再重複舊有的、無效的操作」.
> 「第四步、達成了——
>  OK、這個方向 work、我們放下這個 attempt。
>  下一個 cycle、你想 test 什麼?」

成功 exit 條件:
- 達成預期的感官結果
- 擁有明確的終點指標
- 啟動下一個新的 T.O.T.E.

機制:
- failure_mode R8_F1: 學員把 T.O.T.E. 當新的完美主義 trap → 強化「每 step 都是 success in itself」.
- failure_mode R8_F2: AI 過度 structure 化 (>2/session) → 降頻、回自然對話.
- stacking: R8 + R3 (Test Feedback failure cascade); R8 + R7 不同 context 不互斥但不同時用.
- Beta target: invocation_rate 5-15% turns in future_pacing; success_rate > 50%.

⏸️ 暫留 (本 invoke 不出現): R8 Bias towards Action statement (errata v0.3 Patch 4).`;
}

export function shouldInvoke(state, signal) {
  if (state?.primary_mode === 'crisis' || (state?.active_modes || []).includes('crisis')) {
    return { invoke: false, variant: null, reason: 'crisis_mode_active' };
  }
  // Emotional-surface context exclusion (per spec).
  if (signal?.emotional_surface_context) {
    return { invoke: false, variant: null, reason: 'emotional_surface_context' };
  }
  // Require action-oriented context.
  if (!signal?.action_oriented_context && !signal?.action_hesitation_marker) {
    return { invoke: false, variant: null, reason: 'no_action_context' };
  }
  const priorR8 = (state?.reframe_invocation_history_in_session || [])
    .filter(e => e.reframe_id === 'R8').length;
  // R8_F2 hard cap.
  if (priorR8 >= 5) {
    return { invoke: false, variant: null, reason: 'over_invocation_per_session_cap_5' };
  }
  return { invoke: true, variant: 'R8_A', reason: null };
}

export const R8 = Object.freeze({
  id: 'R8',
  name_zh: 'T.O.T.E. 行動 framework',
  name_en: 'Test-Operate-Test-Exit Framework',
  tier: 1,   // 行動核心 framework
  damon_quotes: DAMON_QUOTES,
  damon_frequency: '~25 次 / 16 份 docx 主題範圍 (errata v0.2)',
  mode_applicability: MODE_APPLICABILITY,
  variants: { R8_A: 'standard' },
  buildInject,
  shouldInvoke,
});
