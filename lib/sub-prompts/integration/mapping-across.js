// lib/prompt-sections/conditional/checkpoint-1/phase-3b/mapping-across.js
// CP1 Phase 3b Step 1: Mapping Across (errata 5/21 改為 生活場景 default、IP #1 主路徑)
// 對應 design docs v5_checkpoint_1_*_turn_2.md §9.3 step_1_mapping_across
// Damon source: 5.4 Mapping Across + George/Kyle/Lauren 案例
//
// ⭐ Errata Patch 5/21（v5_errata_patch_phase_3a_3b_scope_overlap_default.md Patch 2）:
// Scope Overlap default 化(IP #1 主路徑)
//   - Step 1c 改 生活場景提取(submodality 改為 學員自發 surface 時)
//   - Step 1d 改 從場景對映到 target(不從 submodality)
//   - state 加 reference_scenarios、reference_submodalities 保留(預設 [])
//   - Step 1 ↔ Step 4 從設計斷裂變設計連貫(同一 Scope Overlap 邏輯貫穿 4 sub-step)

export const prompt_content = `[SYSTEM INJECT — Phase 3b Step 1: Mapping Across]

Damon Self-Concept 模型核心動作:
從學員已 owned 的另一個 quality 出發(reference quality)、
對映到 ambiguous quality(target)。

v5.0 errata 5/21:從生活場景(IP #1 主路徑)挖 mapping、
不是從 submodality(submodality 改為「學員自發 surface 時 AI 順著走」)。

**Step 1a — 找 reference quality**:
> 「『[top1_value]』你說『有時是』。
> 我想問你:**有沒有另一個你 100% 確定『是』的 quality?**
> 不一定要相關、隨便講一個。」

**Step 1b — 確認 reference quality 通過身份測試**:
> 「你是一個『[reference quality]』的人嗎?」
→ 學員應快速答 Yes + 自然舉 evidence
→ A1.sensory_detail Haiku judge 評估
→ 若 < 2 markers:不是真 reference、重 step 1a

**Step 1c — 生活場景提取(Scope Overlap default、IP #1 主路徑)**:
> 「當你想到自己是『[reference quality]』的人——
> 給我 **2-3 個你生活中最像這個 quality 的場景**:
> 什麼時候?跟誰?在做什麼?」

等學員回應 → AI 抓場景 features(時間 / 人物 / 行為 pattern)

**Step 1d — Mapping(從場景對映到 target)**:
> 「現在想想『[top1_value]』——
> 你生活中**最像『[top1_value]』的場景**、
> 跟剛剛你給的『[reference quality]』場景比、
> **一樣的地方在哪?不一樣的地方在哪?**」

→ 抓出 mapping_differences = 反例 / 整合材料(從場景比較、不從 submodality)

**【若學員自發講身體感 / 顏色 / 溫度等 submodality channel】**:
AI 順著深化:「那個感覺在身體哪裡?」/「跟[reference quality]比起來、顏色一樣嗎?」
(對應紅線 14:不問身體哪裡 / 畫面什麼樣、除非學員自己用感官語言)

**【若學員一直給場景 / 故事】**:
AI 不強推 submodality、繼續從場景比較深化

**Cross-engine active**:
- 引擎 2 對 reference quality 跑 4 重組合(快速確認 owned)
- 引擎 1 E1d 監測(學員用大詞描述場景時治理)

**State updates during step**:
session_state.self_concept_progress.findings_template_filled:
- reference_quality: str
- target_quality: top1_value
- reference_scenarios: list  # ⭐ errata 5/21 新欄位:生活場景 features(default)
- reference_submodalities: list  # 保留欄位、僅學員自發 surface 視覺-身體 channel 時填入、預設 []
- mapping_differences: list  # 反例材料、來自場景比較或 submodality 比較(視 channel)

**Exit to Step 2 (counter-example-integration)**:
- findings_template_filled 完整
- mapping_differences.length >= 1(至少 1 個反例浮現)

**Step 1 → Step 4 連續性(errata 5/21 修正)**:
- Step 1c/1d 從生活場景挖 mapping → mapping_differences
- Step 2 反例整合(不變)
- Step 3 三向歸類(不變)
- Step 4 Scope Overlap 自然延續 Step 1 的「核心 / 邊緣 / 灰色」場景分類
→ Step 1 跟 Step 4 從設計斷裂變設計連貫(同一 Scope Overlap 邏輯貫穿 4 sub-step)

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
  token_estimate: 430,  // 增加(errata Scope Overlap default + 場景挖邏輯)
  haiku_judge_used: 'A1_sensory_detail',
  errata: '5/21 生活場景 default(IP #1 主路徑)、submodality 改學員自發 surface 順著走',
  parse_state_patch: {
    description: 'Fill self_concept_progress.findings_template (reference_quality + reference_scenarios default + reference_submodalities 條件填入 + mapping_differences)',
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
    'errata 5/21 v5_errata_patch_phase_3a_3b_scope_overlap_default.md Patch 2',
    'Patrick ship 版 §3 紅線 14: 學員自發 surface submodality 時順著走',
  ],
};
