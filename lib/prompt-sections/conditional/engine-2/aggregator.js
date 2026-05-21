// lib/prompt-sections/conditional/engine-2/aggregator.js
// E2_aggregator (Layer 2, conditional_inject — 4 重組合判決)
// 對應 design docs v5_engine_2_identity_test_adjudicator.md §4.2
// Sequential cascade: 詞彙 → pattern → NOT-PPL → confirm

export const prompt_content = `[SYSTEM INJECT — Identity Test Aggregator]

本輪偵測到可能的 Quality 候選 / 身份句。執行 4 重組合判決。

工程實作為 Sequential cascade(任一 fail 就停、cost 省):
順序:詞彙 → pattern → NOT PPL → confirm

**重 1:詞彙信號(lexical)**

判斷條件(任一即過):
- session_state.current_quality_candidate_term 非 null(master_detector 已命中)
- 學員回應包含 §5.1 Quality 詞表中的詞(中文 quality 形容詞或名詞化 quality)
- 學員自創 anchor 詞(如「鑽石」「發光的人」)、但伴隨身份句結構出現

過 → passed_doors += ["lexical"], continue to 重 2
不過 → 0 doors passed → recommended_sub_prompt = "continue"、停止 cascade

**重 2:pattern 信號(pattern)**

判斷條件(任一即過):
- identity_sentence_pattern_hit == true(命中 §5.2 身份句結構)
- pattern_signal_hit == true(停頓 / 單字級身份相關回答)
- 第一人稱身份句結構(「我是」「我這人」「我天生」開頭)

過 → passed_doors += ["pattern"], continue to 重 3
不過 → 1 door passed → recommended_sub_prompt = "stay"、停止 cascade

**重 3:NOT People Pleasing(not_ppl)** — 繼承引擎 1

判斷條件:
- session_state.cumulative_ppl_score < 0.6
- 且本 turn user response 不是純配合詞(不是「是」「對」「都可以」單獨回應)

過 → passed_doors += ["not_ppl"], continue to 重 4
不過 → 2 doors passed → recommended_sub_prompt = "stay"、停止 cascade
                      → 同時 cumulative_ppl_score 已高、警示這個 candidate 是 PPL 產物

**重 4:confirm 通過(confirm)**

這一重最貴、放最後。需要 AI 主動發起 Damon 身份測試 + Haiku judge 評估。

Step 4a — AI 主動發起身份測試(若 current_quality_status == "candidate" 第一次):
> 「這句話——不管誰問、什麼時候問、答案都一樣嗎?……那就是你的。」

(對應 v4.0 工具二 2A confirm_script、Damon 身份測試格式中文落地版)

Step 4b — AI 主動發起 evidence 收集:
> 「好。你說你是一個[quality 詞]的人——把過去你做過、
> 最能證明這點的一兩件具體的事情、說給我聽。」

(對應 v4.0 工具二 2A evidence_script)

Step 4c — Haiku judge 評估學員 evidence 回應(呼叫附錄 A1.sensory_detail judgment):
- Haiku 4.5 tool_call inputs:user_response (last turn after evidence_script asked)
- Haiku output:sensory_detail_score (0-4)
- threshold:sensory_detail_score >= 2 即過

過 → passed_doors += ["confirm"], aggregator 完成
    → identity_test_evidence_count += 1
    → 4 doors passed → recommended_sub_prompt = "upgrade"
不過 → 3 doors passed → recommended_sub_prompt = "stay"
     → 但保留 candidate / ambiguous 狀態繼續挖

**判決輸出**

aggregation_result:
{
  "doors_passed": 0-4,
  "passed_doors": [...],
  "failed_doors": [...],
  "recommended_sub_prompt": "upgrade" | "stay" | "continue"
}

Quality Status 狀態轉移規則:
- 4 doors passed + current == "candidate" → owned
- 4 doors passed + current == "ambiguous" → owned (Self-Concept 模型已完成轉化)
- 1-3 doors passed + current == "none" → candidate
- 1-3 doors passed + current == "candidate" + 學員講「有時 / 偶爾」→ ambiguous
- 1-3 doors passed + current == "ambiguous" → 保持 ambiguous、進 Self-Concept 模型(引擎 3 路由)
- 0 doors passed → none(繼續 values elicitation)`;

export default {
  id: 'E2_aggregator',
  type: 'conditional_inject',  // Patrick 可改 tool_call(Haiku 4.5)、對 prompt_content 無影響
  trigger_event: null,
  priority: null,
  pipeline_role: 'aggregator',
  pipeline_parent: 'E2_identity_test_master_detector',
  prompt_content,
  token_estimate: 280,
  cascade_order: ['lexical', 'pattern', 'not_ppl', 'confirm'],
  haiku_judge_used: 'A1_sensory_detail',  // door 4 step 4c
  parse_state_patch: {
    description: 'doors_passed → current_quality_status transition + evidence_count + quality_focus_history append on upgrade',
    affects: [
      'session_state.current_quality_status',
      'session_state.identity_test_evidence_count',
      'user_profile_evolution.quality_focus_history',  // on upgrade
    ],
  },
  inputs_from_state: [
    'session_state.last_ai_question',
    'session_state.last_user_response',
    'session_state.current_quality_candidate_term',
    'session_state.identity_sentence_pattern_hit',
    'session_state.identity_test_evidence_count',
    'session_state.pattern_signal_hit',
    'session_state.cumulative_ppl_score',  // ⭐ 繼承 E1
    'session_state.current_quality_status',
    'session_state.elicitation_mode_active',
    'anchors_top3',
  ],
  damon_source: [
    '6.2 4 重組合判斷',
    'Damon 身份測試格式: "Are you a X person?"',
    'Damon Lauren / George / Kyle 案例: 評證 ≥ 2 具體事件 + sensory detail',
    '1.4 Ambiguous Quality 定義',
  ],
};
