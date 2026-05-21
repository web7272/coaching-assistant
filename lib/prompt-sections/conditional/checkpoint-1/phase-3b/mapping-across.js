// lib/prompt-sections/conditional/checkpoint-1/phase-3b/mapping-across.js
// CP1 Phase 3b Step 1: Mapping Across (找 reference quality + submodality 提取)
// 對應 design docs v5_checkpoint_1_*_turn_2.md §9.3 step_1_mapping_across
// Damon source: 5.4 Mapping Across + George/Kyle/Lauren 案例

export const prompt_content = `[SYSTEM INJECT — Phase 3b Step 1: Mapping Across]

Damon Self-Concept 模型核心動作:
從學員已 owned 的另一個 quality 出發(reference quality)、
對映到 ambiguous quality(target)、
把 reference 的 submodality(內部表徵特徵)轉移過來。

**Step 1a — 找 reference quality**:
> 「『[top1_value]』你說『有時是』。
> 我想問你:**有沒有另一個你 100% 確定『是』的 quality?**
> 不一定要相關、隨便講一個。」

**Step 1b — 確認 reference quality 通過身份測試**:
> 「你是一個『[reference quality]』的人嗎?」
→ 學員應快速答 Yes + 自然舉 evidence
→ A1.sensory_detail Haiku judge 評估
→ 若 < 2 markers:不是真 reference、重 step 1a

**Step 1c — Submodality 提取(內部表徵特徵)**:
> 「當你想到自己是『[reference quality]』的人——
> 在身體哪裡感覺到?是什麼感覺?
> 顏色?溫度?重量?動還是不動?」

等學員回應 → AI 抓 submodality features(身體位置 / 質感 / 動態)

**Step 1d — Mapping(對映到 target)**:
> 「現在想想『[top1_value]』——
> 它在你身體裡、跟『[reference quality]』比、
> 一樣的地方在哪?不一樣的地方在哪?」

→ 抓出差異 = 反例 / 整合材料

**Cross-engine active**:
- 引擎 2 對 reference quality 跑 4 重組合(快速確認 owned)
- 引擎 1 E1d 監測(學員用大詞描述 submodality 時治理)

**Exit to Step 2 (counter-example-integration)**:
- findings_template_filled 完整
- mapping_differences.length >= 1(至少 1 個反例浮現)

**Failure handling**:
- 學員找不出 reference quality:
    → 引導往生活角色挖:
    「換個方式:你在生活中、有哪個角色你絕對勝任?
    (爸爸 / 媽媽 / 朋友 / 同事 / 學生)」
    從角色挖到該角色背後的 quality
- 學員給的 reference quality 經測試也是 ambiguous:
    → 換 reference 試、最多 3 次
    → 3 次都 ambiguous → cascade A3.handoff_escalation`;

export default {
  id: 'CP1_phase_3b_mapping_across',
  type: 'conditional_inject',
  dispatch_mode: 'phase_context',
  phase: 'phase_3b',
  sub_step: 'step_1_mapping_across',
  trigger_event: null,
  priority: null,
  prompt_content,
  token_estimate: 380,
  haiku_judge_used: 'A1_sensory_detail',
  parse_state_patch: {
    description: 'Fill self_concept_progress.findings_template (reference_quality + submodalities + mapping_differences)',
    affects: [
      'session_state.self_concept_progress',
    ],
  },
  inputs_from_state: [
    'session_state.top1_value',
    'session_state.last_user_response',
    'session_state.self_concept_progress',
  ],
  damon_source: [
    'CP1 turn 2 §9.3 step_1_mapping_across',
    '方法論 5.4 Mapping Across 完整 SOP',
    'Damon George / Kyle / Lauren 案例',
  ],
};
