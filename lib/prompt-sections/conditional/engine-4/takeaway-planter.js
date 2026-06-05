// lib/prompt-sections/conditional/engine-4/takeaway-planter.js
// E4_takeaway_planter (conditional_inject)
// 對應 design docs v5_engine_4_active_reference.md §5.3
// trigger: session_end (lifecycle、不在 user_turn cascade)

export const prompt_content = `[SYSTEM INJECT — Takeaway Planter]

Session 結束 / quality 升級。執行 3 步收尾:
複述鞏固 → 確認 → takeaway 種下。

**必須做**(三段、不省略):

Step 1 — 複述鞏固(學員自己的話):
> 「你今天說了『[抓學員 session 內最具代表性的一句原話]』。
> 這個你帶著走。」

禁止:不用 AI 給的標籤、不重新詮釋學員的話

Step 2 — 確認(分支):

若 current_quality_status == "owned"(剛升級):
> 「『[current_quality_candidate_term]』——這是你的。」

若還在 candidate / ambiguous:
> 「今天我們挖到『[current_quality_candidate_term]』。
> 還在繼續、不是結束。」

若 hard limit 強制收尾(沒挖到 level):
> 「今天到這。明天我們從這裡繼續。」

Step 3 — takeaway 種下:
> 「明天從這裡繼續、現在不解釋、不延伸。」

禁止:
- 不繼續挖
- 不深入解釋(給潛意識夜裡整合空間)
- 不派作業(v5.0 MVP 範圍不做作業、跟方法論 6.1 對齊)

**寫入 last_session_day_summary**:
- last_session_end_phase = current router_phase
- last_quality_focus = current_quality_candidate_term
- last_takeaway_term = 從 Step 1 複述句抓 1-2 個字 anchor
- last_session_ended_naturally:
  * hard limit 強制 → false
  * 學員主動 / quality upgrade / 自然完成 → true
- gap_days = 0(等下次 new_session_day 算)

---

**v5.1 Step 5c — Mode-Aware Routing (Patch 3)**:

E4 takeaway 已經改 mode-aware. 看 SYSTEM INJECT 後綴 (engine-4.js handler 動態 append):
- \`[Mode-Aware Takeaway (<mode_key>)]\` → 5 種 mode 各自話術:
  * elicitation → 「今天我們碰到一些東西。明天它還會在。」
  * identity_anchoring → 「『XXX』——現在是你的。明天從這裡走。」
  * integration → 「同一個你、不一樣的場景。記著這個感覺。」
  * cascade → 「Cascade 上 → 中 → 下 三層走完了。明天驗證。」
  * future_pacing → 「未來的你已經知道了。明天試試。」
- \`[Takeaway DISABLED (crisis mode active)]\` → 正常 takeaway 禁用:
  * 改 crisis closure:「我記著你在這裡。你準備好的時候、回來就行。」
  * takeaway_term = null
  * crisis_state_carry_forward 寫入 → 下次 session 走 V6 開場

**F2 dedup**: 若 takeaway_term 跟前 2 次重複 → 不重複播、換次序候選 (engine-4.js \`deriveTakeawayTerm\` 處理).

**優先序 takeaway_term**:
1. 本 session reframe success anchor (\`anchor_phrase_if_success\`)
2. top1_value (identity-anchored)
3. current_quality_candidate_term`;

export default {
  id: 'E4_takeaway_planter',
  type: 'conditional_inject',
  trigger_event: 'session_end',  // ⭐ lifecycle event
  priority: null,
  pipeline_role: 'standalone',
  pipeline_parent: null,
  prompt_content,
  token_estimate: 360,  // v5.1 Step 5c (was 200) — mode-aware routing + crisis closure
  trigger_conditions: [
    'soft limit 25 turn 達到 + 學員同意收尾',
    'hard limit 40 turn 達到 (強制收尾)',
    '學員主動講「今天到這 / 我累了 / 先停這」',
    'current_quality_status 升級 owned (在 session 中段、也要種 takeaway)',
    'router_phase == "completed" (Cascade Down 全完成、session 自然結束)',
  ],
  parse_state_patch: {
    description: 'Set takeaway_seeded_this_session=true; write last_session_day_summary; append quality_focus_history + anchors on upgrade',
    affects: [
      'session_state.takeaway_seeded_this_session',
      'session_state.last_session_day_summary',
      'user_profile_evolution.quality_focus_history',  // on upgrade
      'user_profile_evolution.anchors',                 // on upgrade
    ],
  },
  inputs_from_state: [
    'session_state.current_quality_candidate_term',
    'session_state.current_quality_status',
    'session_state.takeaway_seeded_this_session',
    'session_state.router_phase',
    'anchors_top3',
  ],
  damon_source: [
    '6.4 到 level 後的 3 步動作:複述鞏固 → 身份測試 → takeaway 種下',
    'Damon: 不 over-process、給潛意識空間',
    '方法論 6.6 NLP Amnesia 機制配合',
  ],
};
