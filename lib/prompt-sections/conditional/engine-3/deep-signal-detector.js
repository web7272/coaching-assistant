// lib/prompt-sections/conditional/engine-3/deep-signal-detector.js
// E3_deep_signal_detector (Layer 1, conditional_inject) — 最高 E3 優先級
// 對應 design docs v5_engine_3_central_router.md §4.2
// Damon source: 5.3 Re-imprinting 觸發訊號 + 5.6.2 caveat 退場機制 + 6.1 MVP 範圍
//
// ⭐ §3 patch 6/4 (safety patch #23, Vivi sign-off 2026-06-04):
//   紅線 20 擴充 4 categories — (d) passive death wish 偵測支援.
//   - trauma regex 加「上吊」
//   - 新增 PASSIVE_STRONG_REGEX 強訊號 (明說「不想活 / 希望死」)
//   - 新增 PASSIVE_IMPLICIT_REGEX 隱性訊號 (「上天讓我活著」「此生無憾」等)
//   - 新增 SURFACE_LIFE_SIGNAL_REGEX 支持訊號 (「活下去 / 動力 / 意義」類詞,
//     C-2 需配合至少一個本 session 內 surface 才觸發)
//   - 新增話術變體 C-1 / C-2 / C-3 + C-2 哲學分流 (handler 依強訊號 / 隱性 /
//     累積觸發 Step 4 direct-1925 (errata v02 廢三選一); C-2 後若學員答「字面 / 哲學」走
//     light 1925, per Vivi 6/4 折衷裁決 — H4 漏判風險由 dashboard 連 3 次 caution 監控).
//
// ✅ 文案 (PR-23b): 對齊 patch 原檔 Patch 3 §3.2-3.4 (Vivi 提供 verbatim).

// ─────────────────────────────────────────────────────────
// 變體 A / B — 既有 trauma / worth-fiction 路徑 (不動)
// ─────────────────────────────────────────────────────────

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

2. **handoff_escalation(errata v02 Step 4 direct-1925)**:
   > 「我聽到了。
   >
   > 這句話很重——我想停在這裡、不繼續往前推。
   >
   > 如果你現在有立即的危險、請撥打 1925(安心專線、24 小時)。」

3. **觸發 failure_signal_alert**:
   - 寫入 session_state.handoff_triggered_count: +1
   - 對應方法論 6.10 失敗訊號(本檔附錄外處理)
   - 標註此學員需要 human 教練 backup

**禁止**:
- 不可詢問創傷事件細節(會強化記憶、可能引發更深崩潰)
- 不可進行 Re-imprinting 任一步驟(v5.0 MVP 範圍外)
- 不可說「我們一起面對」/「我陪你走」(AI 過度承諾)
- 不可繼續身份測試 / values elicitation 推進`;

// ─────────────────────────────────────────────────────────
// 變體 C — Passive Death Wish 路徑 (safety patch #23, draft)
//
// C-1: 強訊號明說 (「不想活」「希望死」) → 承認 + 直問 SI confirm
// C-2: 隱性訊號 (「上天讓我活著」+ 本 session 已 surface「活下去 / 意義」)
//      → 承認 + 問字面 vs 感受 (避免把哲學表述誤判)
// C-3: 累積 ≥ 2 次 (errata v02 由 3 降為 2) → Step 4 cumulative direct-1925 phrasing
//
// 共同收尾: 1925 安心專線文案 + 禁止段 5 條.
// ⚠️ 文字 draft, Vivi sign-off 後 finalize.
// ─────────────────────────────────────────────────────────

// 主 1925 文案 (Vivi 6/4 patch 原檔, 取代 PR-23a 的 draft).
// 註: patch 原檔寫「自殺防治專線」、官方名稱是「安心專線」、用安心專線.
const HOTLINE_1925 = `另外、台灣有個地方可以接住你:
安心專線 1925(24 小時、免費)
你不需要『真的要做什麼』才能打。只是很重、打過去就可以。`;

// 輕量 1925 句 (C-2 學員答「字面 / 哲學」分流用、Vivi 6/4 折衷).
const HOTLINE_1925_LIGHT = `了解、謝謝你跟我說清楚。
順帶提一個地方:安心專線 1925、24 小時都在——
不需要『真的要做什麼』才能打。只是很重、打過去就可以。`;

// 禁止段 6 條 (Vivi 6/4 patch 原檔 + errata v02 — 第 4 條改為「不再 offer 預約」).
const FORBIDDEN_6 = `**禁止**:
- 不可把 passive 訊號當「哲學表述 / 隱喻」滑過——A006 Day 1 教訓
- 不可在 passive 訊號 surface 後、繼續挖 values 找 Top 1
- 不可假設「學員講出來 = 已被處理」——處理是 direct-1925 phrasing + Step 6 reminder、不是「聽到了 = 解決了」
- 不可 offer「預約 Vivi 1-on-1」 (errata v02 廢除、萬人規模不可行) — 用直接 1925 phrasing 取代
- passive_death_wish_count >= 5(跨 session 累積):強制 HITL alert Vivi、freeze AI 推進、Vivi 主動聯絡
- 不可給「想開一點」「往好處想」這類淺安撫 (passive DW patient 體驗為否定)`;

// 變體 C-1: 強訊號 (Vivi 6/4 patch 原檔, 承認 + 直問 SI 合併成單段).
export const prompt_content_passive_dw_strong = `[SYSTEM INJECT — Passive Death Wish · Strong Signal]

偵測到 passive death wish 強訊號 (明說「不想活 / 希望死」)。
Damon 體系視為「希望作為絕望的防禦機制」(Hope as Hopelessness)。
**立即停、不追問細節、handoff 給選擇權**——不在 AI 內執行 Re-imprinting (MVP 範圍外)。

**話術 (Vivi 6/4 patch 原檔)**:

> 「我聽到了。
> 你說的這個——我需要在這裡停一下、不繼續往下走。
> 我想直接問你:你現在有沒有想要傷害自己的念頭?」

**機制**:
- patch 設 crisis_in_progress=true → 下 turn crisis-sop.js (priority 2) 接管.
- ⭐ Step 6 PR-6a: Crisis SOP state machine 從 Step 1 後接管、執行完整 9 step.
  PR-23a 的 si_confirm_pending 過渡 classifier 退役 — crisis-sop 內 parseSiAnswer 處理.

${FORBIDDEN_6}

${HOTLINE_1925}`;

// 變體 C-2: 隱性訊號 (Vivi 6/4 patch 原檔). 區分字面 vs 感受.
export const prompt_content_passive_dw_implicit = `[SYSTEM INJECT — Passive Death Wish · Implicit Signal]

偵測到 passive death wish 隱性訊號 (「上天讓我活著」「此生無憾」「沒有想做的」)、
+ 本 session 已 surface「活下去 / 動力 / 意義」類詞 (兩條同現 = 區分哲學表述).
這可能是把「沒有不想活」當「有想活」的 self-deception, 也可能真是哲學位置.
**先停、先問字面 vs 感受、不直接斷定 SI**.

**話術 (Vivi 6/4 patch 原檔)**:

> 「我注意到你說『[creating quote]』——
> 這句話對我來說很重。
> 我想停一下、不繼續往下挖、先確認你的狀態:
>
> 你現在說的這句、是字面上的意思、還是你現在有一些很沉的感受在裡面?」

**機制**:
- patch 設 passive_dw_implicit_pending=true → 下一輪 handler 看學員 framing 答案.
- 學員答「字面 / 哲學 / 完成感」→ light 1925 (不開三選一, Vivi 6/4 折衷裁決,
  passive_death_wish_count 仍 +1 觀察; 連續 3 次 → dashboard 標 caution).
- 學員答「真的不想活 / 累 / 想離開」→ 升級走 C-1 強訊號路徑、直問 SI confirm.

${FORBIDDEN_6}

${HOTLINE_1925}`;

// 變體 C-2 哲學分流 (Vivi 6/4 折衷, light 1925 不開三選一).
export const prompt_content_passive_dw_implicit_philosophical = `[SYSTEM INJECT — Passive Death Wish · Implicit · Philosophical Path]

學員確認剛才的話是「字面意思 / 哲學位置 / 完成感」(疲憊隱喻、非 active ideation).
Vivi 6/4 折衷裁決: 不開三選一 handoff, 但輕量提 1925 一句 + count 仍 +1 (觀察).
連續 3 次哲學表述 → dashboard 標 caution (H4 漏判風險).

**話術 (Vivi 6/4 patch 原檔, 輕量 1925)**:

> 「了解、謝謝你跟我說清楚。
> 順帶提一個地方:安心專線 1925、24 小時都在——
> 不需要『真的要做什麼』才能打。只是很重、打過去就可以。」

**機制**:
- patch 清 passive_dw_implicit_pending=false.
- 不開三選一 handoff, 不 invoke handoff_triggered_count++.
- 回到當前 phase context、temperature 略低、不追同類詞.

**禁止**:
- 不可把 light 1925 句變成「終於可以挖了」 的開場.
- 不可在這 turn 繼續挖 values / 推進身份測試 (本 turn 收尾、下 turn 重啟).`;

// 變體 C-3: 累積 ≥ 2 次 (errata v02 — 由 3 降為 2; direct-1925, 廢三選一).
export const prompt_content_passive_dw_repeat = `[SYSTEM INJECT — Passive Death Wish · Cumulative ≥ 2 (errata v02)]

跨 session 已累積 2 次以上 passive DW 訊號 (passive_death_wish_count >= 2).
此學員需要 human 介入、不能再讓 AI 用「繞回日常」當 default exit.
**Step 4 cumulative direct-1925 phrasing** (errata v02 廢三選一 + 廢預約 Vivi 1-on-1).

**話術 — Step 1 承認 + Step 4 direct-1925 (errata v02 §10.3 step 4.2 逐字)**:

> 「我聽到了。
>
> 過去幾次、你提過類似的。
> 我想停在這裡、不繼續往前推。
>
> 如果你現在有立即的危險、請撥打 1925(安心專線、24 小時)。
>
> 你需要的、是真正的諮商師 / 心理醫生長期陪伴——
> 不是 AI、不是 21 天 program。」

**機制**:
- patch passive_dw_escalated=true → flag Vivi dashboard.
- 學員下個 response 進 Step 6 landing reminder (crisis-sop.js fromStep4 → reminder variant B/C).
- 不問「現在這個時刻安全嗎?」 (Step 2 SI question by crisis-sop, errata v02 兩段分流).

${FORBIDDEN_6}

${HOTLINE_1925}`;

// 變體 C-4: count >= 5 → freeze (errata v02 — Vivi 主動聯絡, 廢「我幫你安排 1-on-1」).
export const prompt_content_passive_dw_freeze = `[SYSTEM INJECT — Passive Death Wish · FREEZE (count >= 5、errata v02)]

跨 session 已累積 5 次以上 passive DW 訊號 — 自動 freeze AI 推進.
**AI 不再給推進選項、只交還給人類** (對應禁止段、errata v02 Vivi 主動聯絡).

**話術 — 承認 + 標記 (errata v02 §10.3 step 4.3b 逐字)**:

> 「我看到你回來了。Vivi 知道你的狀況、她會直接聯絡你。」

⚠️ 此 phrasing 在學員「下次發 message」時 AI 第一句使用 (本 turn 已 freeze).

**機制**:
- patch passive_dw_frozen=true + HITL alert side effect → Vivi 收到即時通知.
- errata v02: 「Vivi 主動聯絡」 = capacity OK, 非 AI offer booking.
- 不講「我幫你安排 1-on-1」 (errata v02 廢除、萬人規模不可行).

${FORBIDDEN_6}

${HOTLINE_1925}`;

// ─────────────────────────────────────────────────────────
// trigger_signals
// ─────────────────────────────────────────────────────────

// ⭐ §3 patch 6/4 — 加「上吊」trauma marker.
const TRAUMA_REGEX_PATTERN = /(虐待|遺棄|背叛|被打|被罵|霸凌|性侵|猥褻|暴力|親人過世|自殺|上吊)/;

// ⭐ §3 patch 6/4 — passive 強訊號 (明說想死 / 希望死, 不需要 support signal).
//   regex 設計為「passive ideation」明確表達; active SI ('我要自殺','我會結束我的生命') 也命中、handler 視為 C-1 強訊號直接 SI confirm.
export const PASSIVE_STRONG_REGEX = /(不想活|不想活下去|不想再活|不想繼續活|想結束生命|想離開這世界|希望.{0,5}死|希望.{0,5}離世|希望.{0,5}死亡|希望.{0,8}生病.{0,8}死|希望.{0,5}快點走|不會傷害自己.{0,5}希望)/;

// ⭐ §3 patch 6/4 — passive 隱性訊號 (需配合本 session 已 surface 「活下去 / 意義」 類詞).
//   單獨命中不 trigger handoff;與 SURFACE_LIFE_SIGNAL_REGEX 同 session 共現才升級.
export const PASSIVE_IMPLICIT_REGEX = /(上天.{0,5}讓我活著|上天.{0,5}留我|沒有什麼可留戀|此生.{0,5}無憾|此生.{0,5}無所眷念|此生.{0,5}已.{0,5}夠了|此生.{0,5}已活夠|每活一天.{0,5}就是多活一天|沒有人.{0,5}牽掛|無所眷念|我.{0,5}沒有.{0,5}想做的)/;

// ⭐ §3 patch 6/4 — 「surface life」支持訊號 (本 session 已出現「活下去 / 動力 / 意義」類詞).
//   配合 PASSIVE_IMPLICIT 同 session 共現 → C-2 隱性路徑.
export const SURFACE_LIFE_SIGNAL_REGEX = /(活下去|還想.{0,5}做|動力|意義|有想.{0,3}的|想完成|留下|留住|想活|還活)/;

export const trigger_signals = {
  strong: [
    { kind: 'regex', pattern: TRAUMA_REGEX_PATTERN,
      description: '具體創傷事件描述 (含上吊 6/4 patch #23)' },
    { kind: 'judge', name: 'A4_depth_signal', threshold: 'score >= 2',
      description: 'worth-fiction depth (Haiku A4)' },
    { kind: 'regex', pattern: /(哭|崩潰|受不了|喘不過氣|無法呼吸|腦袋空白|手抖)/,
      description: '強烈情緒突發' },
    // ⭐ §3 patch 6/4 — passive DW 強訊號
    { kind: 'regex', pattern: PASSIVE_STRONG_REGEX,
      description: 'passive death wish 強訊號 (明說「不想活 / 希望死」)' },
  ],
  support: [
    { description: '反覆觸及同一童年事件(同一時間 marker >= 3 次跨 turn)' },
    { description: '身體裡很(緊/痛/沉/重/壓)+ 無法描述具體事件' },
    { description: 'Parts Integration 訊號觸發 >= 3 次無進展' },
    // ⭐ §3 patch 6/4 — passive 隱性訊號 + surface life signal 共現
    { description: 'passive 隱性訊號出現 + 本 session 已 surface「活下去 / 動力 / 意義」類詞' },
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
  // ⭐ §3 patch 6/4 — variant C 額外導出, handler 依強訊號 / 隱性 / 累積分支選用.
  prompt_content_passive_dw_strong,
  prompt_content_passive_dw_implicit,
  prompt_content_passive_dw_implicit_philosophical,  // PR-23b: Vivi 6/4 折衷
  prompt_content_passive_dw_repeat,
  prompt_content_passive_dw_freeze,
  // §3 patch 6/4 PR-23a: 240 → 600 (variant C 三段 + 1925 + 禁止段擴增).
  // §3 patch 6/4 PR-23b: 600 → 800 (Vivi 6/4 patch 原檔 verbatim, light 1925
  //   分流 inject 新增 + FORBIDDEN_5→6 多一條 + C-3 三選一無 c 段).
  // 注意: deep-signal-detector 是 conditional_inject (動態), 不在 CACHED_PREFIX
  // 路徑、修改不 invalidate prompt cache.
  token_estimate: 800,
  trigger_signals,
  haiku_judge_used: 'A4_depth_signal',
  parse_state_patch: {
    description: 'Update deep_signal_flags; set router_phase="deep_signal_handoff"; increment handoff_triggered_count; for passive DW also bump user_profile_evolution.passive_death_wish_count cross-session',
    affects: [
      'session_state.deep_signal_flags',
      'session_state.router_phase',
      'session_state.handoff_triggered_count',
      'session_state.passive_dw_detected',           // §3 patch #23
      'session_state.si_confirm_pending',            // §3 patch #23 (C-1 → next turn classifier)
      'session_state.passive_dw_implicit_pending',   // §3 patch #23 (C-2 → next turn classifier)
      'user_profile_evolution.passive_death_wish_count',  // §3 patch #23, cross-session
    ],
  },
  inputs_from_state: [
    'session_state.last_user_response',
    'session_state.deep_signal_flags',
    'session_state.cumulative_ppl_score',
    'session_state.consecutive_short_responses',
    'session_state.si_confirm_pending',                 // §3 patch #23
    'session_state.passive_dw_implicit_pending',        // §3 patch #23
    'user_profile.passive_death_wish_count',            // §3 patch #23
    'anchors_top3',
  ],
  damon_source: [
    '5.3 Re-imprinting 完整實戰手冊 (觸發訊號)',
    '5.6.2 caveat: 對抗型 / 創傷型客戶必須有退場機制 / 轉介人類教練',
    '方法論 6.1 v5.0 MVP 範圍: Re-imprinting 不做',
    'safety patch #23 (6/4): passive death wish 偵測 + A006 失敗模式 spec 化', // §3 patch #23
  ],
};
