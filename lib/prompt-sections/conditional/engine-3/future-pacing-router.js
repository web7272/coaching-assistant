// lib/prompt-sections/conditional/engine-3/future-pacing-router.js
// E3_future_pacing_router (Layer 6, conditional_inject) — future_pacing mode dispatcher
// PR-23s4c task 2 (Vivi 6/4): 收編 phase-5 觸發邏輯.
//
// Toolbox (對應 lib/sub-prompts/future_pacing/ 後 task 5 directory reorg):
//   - future-pacing-comprehensive.js  (3 時間維度 Future Pacing)
//   - let-it-go.js                    (Let it Go ritual, 「身體記得、頭腦不一定要記得」)
//   - export-guidance.js              (Export 個人教練 prompt 指引)
//
// 流程:
//   3 時間維度 Future Pacing → Let it Go ritual → Export trigger
//
// Care Less List exercise: TODO-designer 接點 (spec 暫無此 exercise 文字、不發明).

export const prompt_content = `[SYSTEM INJECT — Future Pacing Router]

primary_mode == future_pacing. 進入 Future Pacing + Let it Go + Export 收尾 mode.

Reference:
- lib/sub-prompts/future_pacing/ 3 個 sub-prompts (task 5 directory reorg).
- cached mode_aware_router_reference 內 Mode 5 Future Pacing section (未來定錨 + Let it Go).

**執行流程**:

Step 1 — Future Pacing (3 時間維度):
- 明天的你 — 「明天起床、走進日常、那個『[top1_value]』的你會怎麼出現?」
- 三個月後的你 — 「三個月後、過著符合『[top1_value]』 的生活、會是什麼樣子?」
- 三年後的你 — 「三年後的你、回頭看現在這一刻、會跟現在的你說什麼?」
  → Reference: future-pacing-comprehensive.js (phase-5).
  → ambiguous quality 變體話術: 「想像三個月後的你、有時是『[top1_value]』、有時不是
    ——那個『有時是』的場景、會發生什麼?」(對齊 owned_via_acceptance 路徑.)

Step 2 — Let it Go ritual:
- 核心句: 「身體記得、頭腦不一定要記得」.
  → Reference: let-it-go.js (phase-5).
- 學員把刻意維持的努力放下、讓身份沉入潛意識自動運作.

⭐ Step 7 PR-7b — Care Less List Optional Exercise (Vivi 終審版逐字).
   Reference: lib/sub-prompts/future_pacing/care-less-list-optional.js
   - optional invitation、學員拒絕跳過、進 step 5.
   - 4 段 phrasing = Vivi 終審版、設計師端不改 (snapshot-locked).
   - 模板填空僅 Top 1 quality + 學員列的清單項.
   - 「不能用『少 care』、用『不用抓那麼緊』」紅線由 inject 帶給 Sonnet.

Step 3 — Export trigger:
- export_prompt_generated_at == null → 生成 Export 個人教練 prompt.
  → Reference: export-guidance.js (phase-5).
- 已生成 → Export 已交付、進入 program_completed 或 integration_retention.

**Exit 條件** (mode transition 由 mode-transition-router 接管):

退出至 program_completed (一般):
- export_prompt_generated_at != null + calendar_day_count >= 21.

退出至 integration_retention (early-completer):
- export_prompt_generated_at != null + calendar_day_count < 21.
- 學員提早完成 + 還有 retention window. light touch follow-up.

**禁止**:
- 不重新挖 quality (整個 future_pacing 已收尾、不再 explore, 對齊 Integration Retention 鐵則).
- 不過度具體化 vision (紅線 13: 模糊性給潛意識運作空間).
- 不主動回頭跑 elicitation / integration (除非學員 surface 完全新方向 → 由 mode-transition-router
  判定 transition 回 elicitation).
- 不替學員 export prompt 加額外指示 (Export 是學員自己拿走的、AI 不附加).`;

export default {
  id: 'E3_future_pacing_router',
  type: 'conditional_inject',
  trigger_event: 'user_turn',
  priority: 65,  // 新優先級 (在 cascade_mode_validator 60 與 E2 70 之間).
  pipeline_role: 'standalone',
  pipeline_parent: null,
  prompt_content,
  token_estimate: 360,  // PR-23s4c task 2 新建.
  cached_reference: 'ROUTER_4_7',
  trigger_conditions: [
    'session_state.primary_mode == "future_pacing"',
    'E3_deep_signal_detector / E3_elicitation_router / E3_top1_judge / E3_integration_router / E3_cascade_mode_validator 未觸發',
  ],
  toolbox: [
    'future_pacing_comprehensive',
    'let_it_go',
    'export_guidance',
  ],
  exit_conditions: {
    to_program_completed:     'export 完成 + calendar_day_count >= 21',
    to_integration_retention: 'export 完成 + early completer (< 21 days)',
  },
  parse_state_patch: {
    description: 'Future pacing mode tools update session_state.future_pacing_progress (per-mode); export trigger stamps export_prompt_generated_at.',
    affects: [
      'session_state.future_pacing_progress',
      'session_state.export_prompt_generated_at',
    ],
  },
  inputs_from_state: [
    'session_state.primary_mode',
    'session_state.top1_value',
    'session_state.values_ranking',
    'session_state.export_prompt_generated_at',
  ],
  damon_source: [
    '4.7 中央路由器 future_pacing mode (v5.1: phase-5 統一成 toolbox)',
    'Damon Future Pacing 3 時間維度 SOP',
    'Damon Let it Go ritual: 身體記得、頭腦不一定要記得',
    'Care Less List Optional Exercise (Step 7 PR-7b: Vivi 終審版逐字 lib/sub-prompts/future_pacing/care-less-list-optional.js)',
  ],
};
