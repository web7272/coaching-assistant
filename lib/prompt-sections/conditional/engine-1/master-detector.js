// lib/prompt-sections/conditional/engine-1/master-detector.js
// E1_deviation_master_detector (Layer 1, detector_only)
// 對應 design docs v5_engine_1_deviation_detector.md §4.2
//
// 每個 user turn 結束後檢查「是否可能發生對話偏離」。
// 寧錯殺、不放過——分類交 E1_subtype_classifier。

export const regex_patterns = {
  vague_words: [
    /(應該是|大概|可能|好像|也許|或許|算是)/,
    /(就是|嗯|蛤|喔|哦)$/,
    /(都可以|都一樣|都好|隨便|看你)/,
  ],
  short_compliance: [
    /^(是|對|好|嗯|可以|沒錯|沒有|還好)[。!\s]*$/,
    /^.{1,4}$/,
  ],
  spiritual_big_words: [
    /(整合|完整|圓滿|覺醒|實現|命運|充實|豐盛)/,
    /(一切都是最好的安排|順其自然|放下|臣服)/,
    /(內在小孩|高我|宇宙|能量|頻率|顯化)/,
  ],
  // ⭐ A001 Day 3 五次抗議血淚教訓、最高優先級
  explicit_protest: [
    /(你又|重複|鬼打牆|聽不懂|已經講過|你沒在聽|我們在繞)/,
    /(我的媽呀|OMG|靠|搞什麼)/,
    /(可以跳過嗎|可以結束嗎|今天討論差不多了|我之後再想想)/,
  ],
};

export const cumulative_state_signals = {
  consecutive_short_responses: '>= 2',
  consecutive_offtopic_turns: '>= 1',
  consecutive_vague_turns: '>= 3',   // fable 6/26: 2->3
  cumulative_ppl_score: '>= 0.6',
};

// 命中 explicit_protest 任一 pattern → 強制 cascade 到 classifier、
// 不檢查 cumulative state、不檢查其他 regex。
// 同時 cumulative_ppl_score += 0.30(在 classifier 觸發前)。
export const priority_override_explicit_protest = true;

export default {
  id: 'E1_deviation_master_detector',
  type: 'detector_only',
  trigger_event: 'user_turn',
  priority: 10,  // CASCADE_PRIORITY.E1_deviation_pipeline (highest)
  pipeline_role: 'master',
  pipeline_parent: null,
  // detector_only: no LLM inject content — pure regex + state mutation
  prompt_content: '',
  regex_patterns,
  cumulative_state_signals,
  priority_override_explicit_protest,
  parse_state_patch: {
    description: 'Sets deviation_suspected_this_turn + triggered_signals on regex hit; +0.30 PPL on explicit_protest',
    affects: [
      'session_state.deviation_suspected_this_turn',
      'session_state.triggered_signals',
      'session_state.explicit_protest_hit',
      'session_state.cumulative_ppl_score',
    ],
  },
  inputs_from_state: [
    'session_state.consecutive_short_responses',
    'session_state.consecutive_offtopic_turns',
    'session_state.consecutive_vague_turns',
    'session_state.cumulative_ppl_score',
    'session_state.last_ai_question',
  ],
  damon_source: [
    'spec docs/v5-spec/design/v5_engine_1_deviation_detector.md §4.2',
    'A001 Day 3 五次抗議 (explicit_protest 列表)',
  ],
};
