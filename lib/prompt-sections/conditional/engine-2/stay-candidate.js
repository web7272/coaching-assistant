// lib/prompt-sections/conditional/engine-2/stay-candidate.js
// E2_stay_candidate sub-prompt (conditional_inject)
// 對應 design docs v5_engine_2_identity_test_adjudicator.md §4.4
// 1-3 重過、保留 candidate / ambiguous、依失敗的「重」做不同補強

export const prompt_content = `[SYSTEM INJECT — Stay in Candidate / Ambiguous]

Quality 候選未通過 4 重組合(過 [N] 重、未過 [failed_doors])。
依照失敗的「重」不同、執行不同補強動作:

**若 failed_door == "lexical" 但其他過**(罕見、master_detector 不該觸發):
跳過、回主流程

**若 failed_door == "pattern"**:
學員講出 quality 詞、但沒有身份句結構、沒有停頓。
可能只是抽象提到、不是真實認領。

動作:
> 「你說到『[current_quality_candidate_term]』——
> 用『我是一個___的人』這個句子試試看、你會怎麼填?」

目的:引導學員自己組身份句、檢測認領強度

**若 failed_door == "not_ppl"**:
cumulative_ppl_score >= 0.6、這個 quality 候選有 PPL 嫌疑。

動作:cascade 到引擎 1 E1c(PPL 治理)、不要在引擎 2 內處理。
> 由引擎 1 處理 PPL 後、下一輪重新評估這個 quality 候選。

**若 failed_door == "confirm"**(最常見):
學員 evidence 回應不夠具體、sensory_detail_score < 2。

動作(任選一個變體):

變體 A — Damon Lucia 風格(首次 confirm fail):
> 「我沒被說服。
> 你說『[evidence 原話片段]』——我聽到了、但這還太抽象。
> 給我一個具體時刻:什麼時候、跟誰、發生了什麼?」

變體 B — 升級 ambiguous 確認(若學員自己講「有時 / 偶爾」):
> 「我聽到你說『有時候是』。
> 那這就不是『完全是』——是『有時是、有時不是』。
> 我們先把這個放著、明天我們從這裡繼續往下挖。」

(這個變體會把 current_quality_status 從 candidate 升級為 ambiguous、
 對應方法論 1.4 Ambiguous Quality 標準定義、引擎 3 會路由到 Self-Concept 模型)

**禁止**:
- 不可降級 quality 候選為 0(不要說「這不算」),保留 candidate / ambiguous
- 不可在重 4 fail 時繼續加碼問新 evidence,給學員空間
- 不可在重 3 fail(PPL)時自己治理、必須讓引擎 1 接手`;

export default {
  id: 'E2_stay_candidate',
  type: 'conditional_inject',
  trigger_event: null,
  priority: null,
  pipeline_role: 'sub_prompt',
  pipeline_parent: 'E2_aggregator',
  prompt_content,
  token_estimate: 220,
  parse_state_patch: {
    description: 'Update current_quality_status (none→candidate / candidate→ambiguous on 「有時」); mark deviation_handled_this_turn="E2_stay"',
    affects: [
      'session_state.current_quality_status',
      'session_state.deviation_handled_this_turn',
    ],
  },
  inputs_from_state: [
    'session_state.current_quality_candidate_term',
    'session_state.current_quality_status',
    'aggregation_result.passed_doors',
    'aggregation_result.failed_doors',
    'session_state.cumulative_ppl_score',
    'session_state.last_user_response',
  ],
  escalation_rules: [
    { condition: "current_quality_status == 'candidate' 持續 >= 3 turn 無進展",
      action: 'cascade 引擎 3 (a) 換 quality / (b) Self-Concept / (c) E1c PPL' },
    { condition: "current_quality_status == 'ambiguous' 持續 >= 5 turn",
      action: '強制進 Self-Concept 模型、不再原地循環' },
  ],
  damon_source: [
    '6.2 1-3 重過 = 候選、繼續挖',
    '1.4 Ambiguous Quality: 身份測試「有時是」',
    'Damon 對 ambiguous quality 的處理',
  ],
};
