# v5.0 lib/ 模組 spec（交付物 2/6）

**作者**：Patrick ｜ 2026-05-20 ｜ 給 Claude Code 落地

---

## 模組結構總覽

```
lib/
├── haiku-judge/          ← 4 個 Haiku 4.5 judge instances
│   ├── sensory-detail.js     (A1、3 dimension)
│   ├── depth-signal.js       (A4)
│   ├── containment-logic.js  (A5)
│   └── takeaway-sentiment.js (A6)
├── state/                ← 4 個 state 機制
│   ├── state-manager.js      (session_state CRUD + JSONB merge)
│   ├── requires-typing.js    (A1 物理防護)
│   ├── cumulative-score.js   (A2 通用累積分數模板)
│   └── handoff-escalation.js (A3)
├── session/              ← 2 個 session 機制
│   ├── day-boundary.js       (new_session_day + cross-day reset)
│   └── phase-machine.js      (current_phase / router_phase transition)
└── prompt-sections/      ← cached prefix + conditional inject 段落
    ├── cached/               (3 個 cached reference + 主框架)
    └── conditional/          (引擎 1-4 各 sub-prompt + Checkpoint 1 phase)
```

---

## 1. lib/haiku-judge/（4 instances）

統一介面：`async function judge(inputs) → structured output`、用 `@anthropic-ai/sdk` + Haiku 4.5、latency target 200ms。

### A1 sensory-detail.js（3 dimension）⭐

```javascript
// 用於：E1c / E2 confirm 重 4 / E3 cascade_down / Phase 2 身份測試
// 3 dimension（Turn 1 P7 + Turn 2 P20 累積）
input:  { user_response, prior_question, value_being_tested }
output: {
  // dimension 1：具體事件 markers
  has_time_marker, has_location_marker, has_person_marker, has_action_marker: bool,
  sensory_detail_score: 0-4,
  // dimension 2（P7）：evidence 歸屬
  evidence_attribution: "self" | "others" | "ambiguous",
  // dimension 3（P20）：evidence 來源
  derived_from_another_value: bool,
}
clearance: sensory_detail_score >= 2 AND attribution == "self" AND derived == false
```

### A4 depth-signal.js

```javascript
// 用於：E3_opening_branch_router 分支 C / E3_deep_signal_detector
input:  { user_response, last_3_turns, anchors_top3 }
output: {
  has_specific_event_marker, repetition_pattern, body_metaphor_present: bool,
  emotional_intensity_estimate: 0-3,
  depth_judgment_score: 0-3,  // 0 表面 / 1 中度 / 2 深→deep_signal / 3 極深→handoff+建議預約 Vivi
}
threshold_for_deep_routing: depth_judgment_score >= 2
```

### A5 containment-logic.js

```javascript
// 用於：E3_top1_determination Step 5 / E3_cascade_down（備用）
input:  { user_response, prior_containment_question, values_being_compared: [v1, v2] }
output: {
  answer_addresses_containment, linear_thinking_error_detected: bool,
  containment_direction: "A_contains_B" | "B_contains_A" | "interdependent" | "unclear",
  confidence: "high" | "medium" | "low",
}
```

### A6 takeaway-sentiment.js（dashboard 信號 1）

```javascript
// 用於：session 收尾 takeaway 種下後、判斷 sentiment
input:  { takeaway_term, session_end_context }
output: {
  takeaway_sentiment: "positive" | "neutral" | "negative",
}
// negative 累積 3 場 → user_profile_evolution.negative_takeaway_count >= 3 → critical HITL
```

**共用基礎**：`lib/haiku-judge/_base.js` — SDK client + structured output schema validation + 200ms timeout fallback（超時降級到主對話 LLM inline judge）。

---

## 2. lib/state/（4 機制）

### state-manager.js（核心）

```javascript
// session_state JSONB CRUD、避免 race condition
getState(session_id) → session_state object
updateState(session_id, patch) → jsonb merge（用 Postgres `||` 不整個覆寫）
resetTransient(session_id) → 清 ✅ reset 類欄位（見 migration 014 §3）
getUserProfile(user_id) → user_profile_evolution（upsert pattern）
updateUserProfile(user_id, patch) → ON CONFLICT DO UPDATE
```

### requires-typing.js（A1 機制）

```javascript
// 附錄 A1：PPL 物理防護（E1c）
trigger: E1c inject 後下一輪仍 short_compliance OR cumulative_ppl_score >= 0.8
blocking: requires_typing_active=true 時、AI 不進下個提問、要求具體事件
clearance: A1 sensory-detail judge → score >= 2 AND attribution == self
failure: 2 次 fail → cascade handoff-escalation
```

### cumulative-score.js（A2 通用模板）

```javascript
// 通用累積分數模板、instance：cumulative_ppl_score
createScore({ field_name, range, update_rules, decay_per_turn, reset_on, alert_thresholds })
// 未來引擎可 createScore 新 instance、不重寫邏輯
```

### handoff-escalation.js（A3）

```javascript
// 附錄 A3：把判斷權交回學員
trigger: E1c requires_typing 2x fail / E1d progress >= 6 / E1a offtopic >= 3 / E3 deep signal
action: 跳出治理動作、給學員 two_choice、不推進
side_effect: handoff_triggered_count += 1；>= 2 → HITL alert
post: redirect / pause / silent 三種 branching
```

---

## 3. lib/session/（2 機制）

### day-boundary.js

```javascript
// new_session_day = calendar day 已過 + 學員本日首次發 message
detectNewSessionDay(user_profile, now) → { is_new_day: bool, gap_days: int }
onNewSessionDay(session_state, user_profile) → reset transient（見 migration 014 §3）
// gap_days 對齊 calendar day、餵給 E4 開場 5 變體選擇
```

### phase-machine.js

```javascript
// current_phase（CP1、8 enum）↔ router_phase（E3、7 enum）transition mapping
PHASE_TRANSITION_MAP: {
  // current_phase → 對應 router_phase 範圍 + entry/exit conditions
  phase_1: { router_phases: ["opening", "elicitation", "top1_determination"], ... },
  phase_2: { router_phases: ["identity_test_routing"], ... },
  phase_3a: { ... }, phase_3b: { ... }, phase_4: { router_phases: ["cascade_down"] },
  phase_5: { router_phases: ["completed"] },
  integration_retention: { ... }, program_completed: { ... },
}
advancePhase(session_state) → 依 exit_condition 推進 + state_field_updates
// phase 進度欄位跨 day 不 reset（migration 014 exception）
```

---

## 4. lib/prompt-sections/

```
cached/
├── damon-core-philosophy.js   (世界觀 + 12+ 禁區 + Values×Identity)  ← 主框架 cached
├── 5-layer-unwrap.js          (引擎 1、~600t)
├── 4-7-router.js              (引擎 3、~1400t)
└── active-reference-styles.js (引擎 4、~800t)

conditional/
├── engine-1/ (master_detector / classifier / E1a-d)
├── engine-2/ (master_detector / aggregator / upgrade-stay-continue)
├── engine-3/ (5 子路由器)
├── engine-4/ (5 變體 selector / takeaway / cascade-ref / export)
└── checkpoint-1/ (phase 1-5 + integration-retention + 附錄 C)
```

詳細 cached 切割見交付物 4。

---

## 落地優先序（給 Claude Code）

```
P0（基礎、其他依賴）：state-manager / day-boundary / haiku-judge/_base
P1（引擎核心）：phase-machine / 4 個 haiku judge / 3 個 state 機制
P2（prompt）：cached/ + conditional/（依交付物 4 + 5）
```

---

*— lib 模組 spec v0.1 ｜ Patrick ｜ batch 2/6 —*
