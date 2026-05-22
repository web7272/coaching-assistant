// lib/prompt-sections/conditional/checkpoint-1/transitions/phase-3b-to-3a-simplified.js
// CP1 Phase 3b → 3a Simplified 過渡 (Scope Overlap 升級 owned 後的常見路徑)
// 對應 design docs v5_checkpoint_1_*_turn_2.md §10.1
//
// ⭐ Errata Patch 5/21（v5_errata_patch_phase_3a_3b_scope_overlap_default.md Patch 3）:
// 過渡話術改為生活場景化(跟 Patch 1 build-vision Step 1b 一致)
// simplified 版本不寫死 dissociated → associated 過渡(§3 紅線 14:不問身體/畫面、除非學員自己用感官語言)
// 若學員從 Phase 3b 已自發走視覺 channel → 過渡同時提供視覺 + 場景兩個 channel

export const prompt_content = `[SYSTEM INJECT — Transition: Phase 3b → Phase 3a Simplified]

**Trigger condition**:
Phase 3b Step 4 Scope Overlap 完成
+ step 4c 重新身份測試通過
+ current_quality_status: "ambiguous" → "owned"

**AI 過渡話術(由主對話 LLM 處理、不另起 inject、errata 5/21 改生活場景化)**:
> 「『[top1_value]』(這個 expanded 版本)現在是你的。
> 接下來想想——
> **3 個月後的你、過著符合『[top1_value]』的生活、會是什麼樣子?**
> 你會跟誰見面?做哪幾件事?選哪個方向?」

→ 直接接 Patch 1 修正後的 Phase 3a Step 1b 生活場景化
→ Step 1a 畫布起手在 simplified 版本可省略(因 Phase 3b 已完成 quality 認領、不需重新「擺進畫面」概念)
→ simplified 版本直接從 Step 1b 開始、Step 1c Scope Overlap、Step 3 Let it Work

**【若學員從 Phase 3b 已自發走視覺 channel】**:
過渡話術同時提供視覺 + 場景兩個 channel:
> 「『[top1_value]』(這個 expanded 版本)現在是你的。
> 想想 3 個月後——
> **你看到的畫面是什麼?跟誰見面?做哪些事?**」

→ AI 順著學員既有 channel(對應紅線 14)

**Rationale**:
Phase 3b 已經完整跑過 Self-Concept 模型(Mapping Across + 反例 + 三向歸類 + Scope Overlap)、
學員對 top1_value 的內部認領已很深、不需要 full 4 步驟改變法。

Phase 3a Simplified 只跑:
- Step 1 Build Vision(Patch 1 修正後版本:Scope Overlap default、視覺 channel 學員自發 surface 時走)
- Step 3 Let it Work(直接 Future Pacing + takeaway)

注意:simplified 版本**不寫死「dissociated → associated」過渡**、
跟 Patrick ship 版 §3 紅線 14 對齊(不問身體哪裡 / 畫面什麼樣、除非學員自己用感官語言)。

跳過 Step 2 Check Resistance:
- Phase 3b 內已多次處理 resistance(反例整合、三向歸類本質都是 resistance 處理)
- 此時再做 Check Resistance 會 over-process、違反 Damon 原則

**Day range for 3a Simplified**: min 1 / max 2`;

export default {
  id: 'CP1_transition_phase_3b_to_3a_simplified',
  type: 'conditional_inject',
  dispatch_mode: 'phase_transition',
  phase: 'transitions',
  sub_step: 'phase_3b_to_3a_simplified',
  trigger_event: null,
  priority: null,
  prompt_content,
  token_estimate: 320,  // 增加(errata Scope Overlap + 視覺 channel 條件分支)
  errata: '5/21 過渡話術改生活場景化、跟 Patch 1 build-vision 一致、紅線 14 順著 channel 走',
  parse_state_patch: {
    description: 'Transition: current_phase=phase_3a, next_action=build_vision_simplified, init build_vision_progress',
    affects: [
      'session_state.current_phase',
      'session_state.next_action',
      'session_state.build_vision_progress',
      'user_profile_evolution.quality_focus_history',  // append top1_value upgrade
    ],
  },
  inputs_from_state: [
    'session_state.top1_value',
    'session_state.current_quality_status',
    'session_state.self_concept_progress',
  ],
  damon_source: [
    'CP1 turn 2 §10.1 Phase 3b → Phase 3a Simplified',
    'errata 5/21 v5_errata_patch_phase_3a_3b_scope_overlap_default.md Patch 3',
  ],
};
