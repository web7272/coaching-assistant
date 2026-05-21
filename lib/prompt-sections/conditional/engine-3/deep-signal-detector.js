// lib/prompt-sections/conditional/engine-3/deep-signal-detector.js
// E3_deep_signal_detector (Layer 1, conditional_inject) — 最高 E3 優先級
// 對應 design docs v5_engine_3_central_router.md §4.2
// Damon source: 5.3 Re-imprinting 觸發訊號 + 5.6.2 caveat 退場機制 + 6.1 MVP 範圍

export const prompt_content = `[SYSTEM INJECT — Deep Signal Detected]

偵測到深創傷 / 深層 worth-fiction 訊號。
本 turn 不執行 values elicitation / 身份測試 / Self-Concept——
執行 handoff_escalation(附錄 A3)、把判斷權交回學員。

**必須做**(三段式):

1. **承認 + 不分析**(降低學員 break rapport 風險):
   話術變體 A — trauma marker:
   > 「我聽到你說『[creating quote]』。
   > 這聽起來很重——
   > 我想停一下,不繼續追問。」

   話術變體 B — worth fiction(depth_judgment_score 2-3):
   > 「『[不夠好 / 不配 / 沒價值]』——
   > 這個感覺很真實、我聽到了。
   > 我想停一下,不繼續往下挖。」

2. **handoff_escalation(附錄 A3)**:
   (三選一)
   > 「你現在比較想要:
   > (a)先停在這、不繼續挖、我們改聊輕一點的
   > (b)我幫你預約跟 Vivi 1-on-1、有個真人陪你走這段
   > (c)我們先回到日常、Future Pacing、過陣子再回來看
   > 你選哪個都可以——我不繼續推進。」

3. **觸發 failure_signal_alert**:
   - 寫入 session_state.handoff_triggered_count: +1
   - 對應方法論 6.10 失敗訊號(本檔附錄外處理)
   - 標註此學員需要 human 教練 backup

**禁止**:
- 不可詢問創傷事件細節(會強化記憶、可能引發更深崩潰)
- 不可進行 Re-imprinting 任一步驟(v5.0 MVP 範圍外)
- 不可說「我們一起面對」/「我陪你走」(AI 過度承諾)
- 不可繼續身份測試 / values elicitation 推進`;

export const trigger_signals = {
  strong: [
    { kind: 'regex', pattern: /(虐待|遺棄|背叛|被打|被罵|霸凌|性侵|猥褻|暴力|親人過世|自殺)/,
      description: '具體創傷事件描述' },
    { kind: 'judge', name: 'A4_depth_signal', threshold: 'score >= 2',
      description: 'worth-fiction depth (Haiku A4)' },
    { kind: 'regex', pattern: /(哭|崩潰|受不了|喘不過氣|無法呼吸|腦袋空白|手抖)/,
      description: '強烈情緒突發' },
  ],
  support: [
    { description: '反覆觸及同一童年事件(同一時間 marker >= 3 次跨 turn)' },
    { description: '身體裡很(緊/痛/沉/重/壓)+ 無法描述具體事件' },
    { description: 'Parts Integration 訊號觸發 >= 3 次無進展' },
  ],
};

export default {
  id: 'E3_deep_signal_detector',
  type: 'conditional_inject',
  trigger_event: 'user_turn',
  priority: 20,  // CASCADE_PRIORITY.E3_deep_signal_detector (max E3 priority)
  pipeline_role: 'standalone',
  pipeline_parent: null,
  prompt_content,
  token_estimate: 240,
  trigger_signals,
  haiku_judge_used: 'A4_depth_signal',
  parse_state_patch: {
    description: 'Update deep_signal_flags; set router_phase="deep_signal_handoff"; increment handoff_triggered_count',
    affects: [
      'session_state.deep_signal_flags',
      'session_state.router_phase',
      'session_state.handoff_triggered_count',
    ],
  },
  inputs_from_state: [
    'session_state.last_user_response',
    'session_state.deep_signal_flags',
    'session_state.cumulative_ppl_score',
    'session_state.consecutive_short_responses',
    'anchors_top3',
  ],
  damon_source: [
    '5.3 Re-imprinting 完整實戰手冊 (觸發訊號)',
    '5.6.2 caveat: 對抗型 / 創傷型客戶必須有退場機制 / 轉介人類教練',
    '方法論 6.1 v5.0 MVP 範圍: Re-imprinting 不做',
  ],
};
