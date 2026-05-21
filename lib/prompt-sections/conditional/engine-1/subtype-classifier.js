// lib/prompt-sections/conditional/engine-1/subtype-classifier.js
// E1_subtype_classifier (Layer 2, conditional_inject)
// 對應 design docs v5_engine_1_deviation_detector.md §4.3
//
// 由 master_detector pipeline 觸發、structured output 分類:
// E1a / E1b / E1c / E1d / false_positive
// 仲裁優先級:PPL > Bypassing > Vague > Off-topic

export const prompt_content = `[SYSTEM INJECT — Deviation Subtype Classifier]

本輪偵測到可能的對話偏離。分類為以下 5 類之一:

**explicit_protest_hit 優先處理**
若 session_state.explicit_protest_hit == true、直接判定如下:
- 命中「跳過 / 結束 / 我之後再想想」→ recommended_sub_prompt = E1c(PPL 反彈、用付費對等性原則處理)
- 命中「你又 / 鬼打牆 / 沒在聽」→ recommended_sub_prompt = E1a(AI 自己偏離了、要 reset)
- 命中情緒詞(媽呀 / OMG)→ 不歸 4 類、回 "none" 但 confidence = "high"、由主對話 LLM 自然回應(承認情緒)

**E1a — off_topic**
- 學員回應與 AI 上一輪提問詞彙重疊度低
- 內容是故事細節(時/地/人具體)、不是針對提問的答覆
- consecutive_offtopic_turns >= 1

**E1b — vague**
- 模糊詞命中、且缺少具體名詞 / 事件
- F1 防護:亞洲內斂學員短話 + 具體名詞 ≠ 敷衍、判 false_positive

**E1c — people_pleasing**
觸發條件(至少 2 個成立):
- 短配合回應(「是」「對」「好」單獨成句)
- 回應與 AI 上一輪提問詞彙過度重疊(echo)
- 連續 ≥ 3 turn 沒提出新內容 / 新詞彙
- cumulative_ppl_score >= 0.6
- 回應「太快、太順、太完整」——無自然停頓、無自我修正

**E1d — bypassing**
- Spiritual 大詞命中
- 缺少具體事件支撐
- F4 精準防護:elicitation_mode_active == true AND recent_specific_examples_count >= 2
  → values 大詞合法、判 false_positive

**false_positive**
- regex 命中但語意不構成偏離

**仲裁規則(多類同時成立)**
優先級:people_pleasing > bypassing > vague > off_topic
理由:PPL 累積最危險會 cascade 整個 session;bypassing 影響後續 values 真實性;
vague / off_topic 只影響當下 turn。

輸出 structured JSON:
{
  "deviation_type": "...",
  "confidence": "...",
  "evidence": [...],
  "arbitration_applied": bool,
  "recommended_sub_prompt": "E1a" | "E1b" | "E1c" | "E1d" | "none"
}`;

export default {
  id: 'E1_subtype_classifier',
  type: 'conditional_inject',
  trigger_event: null,    // pipeline internal, called by master_detector handler
  priority: null,
  pipeline_role: 'classifier',
  pipeline_parent: 'E1_deviation_master_detector',
  prompt_content,
  token_estimate: 250,
  parse_state_patch: {
    description: 'Sets deviation_classification + recommended_sub_prompt; updates *_turns / cumulative_ppl_score per rules',
    affects: [
      'session_state.deviation_classification',
      'session_state.consecutive_short_responses',
      'session_state.consecutive_offtopic_turns',
      'session_state.consecutive_vague_turns',
      'session_state.cumulative_ppl_score',
    ],
  },
  inputs_from_state: [
    'session_state.last_ai_question',
    'session_state.last_user_response',
    'session_state.triggered_signals',
    'session_state.explicit_protest_hit',
    'session_state.elicitation_mode_active',
    'session_state.recent_specific_examples_count',
    'session_state.cumulative_ppl_score',
    'session_state.consecutive_short_responses',
    'session_state.consecutive_offtopic_turns',
    'session_state.consecutive_vague_turns',
    'anchors_top3',
  ],
  arbitration_priority: ['people_pleasing', 'bypassing', 'vague', 'off_topic'],
  damon_source: ['spec docs/v5-spec/design/v5_engine_1_deviation_detector.md §4.3'],
};
