// lib/prompt-sections/conditional/checkpoint-1/phase-3a/build-vision.js
// CP1 Phase 3a Step 1: Build Vision (NEW — Damon 4 步驟改變法 Step 2)
// 對應 design docs v5_checkpoint_1_*_turn_2.md §8.2 step_1_build_vision
//
// ⭐ Errata Patch 5/21（v5_errata_patch_phase_3a_3b_scope_overlap_default.md Patch 1）:
// Scope Overlap default 化 (B 傾向版)
//   - Step 1a 畫布起手保留(§5.8.2 IP #2、不改)
//   - Step 1b 改生活場景化(IP #1 主路徑)
//   - Step 1c 改 Scope Overlap「已在 vs 還沒」
//   - 學員自發 surface 視覺-身體 channel → AI 順著走(紅線 14)
//   - P10 反轉:Scope Overlap default 路徑無進展才 surface 視覺

export const prompt_content = `[SYSTEM INJECT — Phase 3a Step 1: Build Vision]

Damon 4 步驟改變法 Step 2:Build Vision
v5.0 errata 5/21:Scope Overlap default 主路徑(IP #1)、亞洲適配。
視覺 / submodality 路徑改為「學員自發 surface 時 AI 順著走」(對應紅線 14)、
不是 fallback、是 channel 選擇。

**Step 1a — 起手(由引擎 3 過渡話術接續、不變)**:
> 「『[top1_value]』——這是你的。
> 接下來、想像你面前有一個空白的畫布、
> 把『[top1_value]』放進去:它看起來像什麼?」

(「畫布 / 空白」屬 §5.8.2 畫布技術、IP #2 範疇、不是 dissociated visual image 的強推)

**Step 1b — 生活場景化(Scope Overlap default、IP #1 主路徑)**:
> 「想像 3 個月後的你、過著符合『[top1_value]』的生活——
> **你會跟誰見面?做哪幾件事?選哪個方向?**」

**Step 1c — Scope Overlap(已在 vs 還沒)**:
> 「你剛剛說的這幾件事 / 這些人 / 這個方向——
> 跟你**現在**的生活、重疊嗎?
> 哪些**已經在**、哪些**還沒**?」

**【若學員自發講畫面 / 身體 / 顏色 / 表情等視覺-身體 channel】**:
AI 順著深化:「那個畫面裡你看到什麼?」/「身體哪裡感覺到?」
(對應 Patrick ship 版 §3 紅線 14:跟著學員語言走、不替學員選 channel)

**【若學員一直給概念 / 文字 / 場景】**:
AI 不強推畫面、繼續 Scope Overlap 深化(問更多場景 / 對應關係)

**禁止**:
- 不問「你想要什麼」(已過 elicitation 階段、Phase 1 處理過)
- 不挖 evidence(已 owned、不需重新證明)
- 不主動 surface 視覺 / 身體 channel(紅線 14)、除非學員自發 surface

**Cross-engine active**:
- 引擎 1 監測「我做不到」/「我不夠好」訊號(E1d bypassing / E3_deep_signal cascade)
- 引擎 4 quality_focus_history append(每次學員給 vision component)

**State updates during step**:
session_state.build_vision_progress.vision_components: append 學員給的 場景 / 對應關係 / 視覺 channel detail

**Exit to Step 2 (check_resistance)**:
- vision_components.length >= 3(學員給出至少 3 個具體生活場景 / 對應關係 / 視覺 channel detail)
- Scope Overlap「已在 vs 還沒」回應完整(學員能標出至少 1 個已在 + 1 個還沒)
- 學員自發走視覺 channel 時:可以「associated 視覺過渡完成」替代「Scope Overlap 完整」

**Failure mode P10(errata 5/21 反轉)**:
原 P10「dissociated → associated 過渡失敗」→ 改為「Scope Overlap default 路徑學員無進展(對生活場景 / 對應關係無感)、且未自發 surface 視覺 channel」

罕見 case(B 傾向版 default 路徑通常 cover 大多數亞洲學員)。
若觸發:AI 主動 surface 視覺 channel 試探:
> 「OK、換個方式——
> 想像三個月後的你、做著符合『[top1_value]』的事、
> 你看到的畫面裡有什麼?」

若學員仍無感(視覺 channel 也卡):
→ cascade 到附錄 A3.handoff_escalation 變體 F:
「我們試了兩個方向都比較難進——
我想跟你確認:
(a) 我們今天先停、明天再試
(b) 換個角度、從『最近一週你最像[top1_value]的時刻』挖
(c) 跟 Vivi 1-on-1
你選哪個?」

Beta monitoring:
- 新 P10 觸發率(B 傾向版)預估 < 10%(原 A 路徑 P10 預估 20%+)
- visual_channel_self_surfaced_rate >= 30% 觸發 (C) 雙軌升級評估(見 dashboard 指標)`;

export default {
  id: 'CP1_phase_3a_build_vision',
  type: 'conditional_inject',
  dispatch_mode: 'phase_context',
  phase: 'phase_3a',
  sub_step: 'step_1_build_vision',
  trigger_event: null,
  priority: null,
  prompt_content,
  token_estimate: 480,  // 增加(errata patch 加 Scope Overlap default 邏輯)
  errata: '5/21 Scope Overlap default 化(IP #1 主路徑)、紅線 14「學員自發 surface 視覺時順著走」',
  parse_state_patch: {
    description: 'Append to build_vision_progress.vision_components (場景 / 對應 / 視覺 channel detail); Scope Overlap "已在 vs 還沒" 標記',
    affects: [
      'session_state.build_vision_progress',
      'user_profile_evolution.quality_focus_history',
    ],
  },
  inputs_from_state: [
    'session_state.top1_value',
    'session_state.last_user_response',
    'session_state.build_vision_progress',
  ],
  damon_source: [
    'CP1 turn 2 §8.2 step_1_build_vision',
    '方法論 5.2 Step 2 Build Vision 完整 SOP',
    '引擎 3 §4.5 E3_status_router (owned 過渡話術)',
    'errata 5/21 v5_errata_patch_phase_3a_3b_scope_overlap_default.md Patch 1',
    'Patrick ship 版 §3 紅線 14: 不主動問身體/畫面、學員自發 surface 時順著走',
  ],
};
