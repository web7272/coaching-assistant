// lib/prompt-sections/conditional/engine-3/deep-signal-detector.js
// E3_deep_signal_detector (Layer 1, conditional_inject) — 最高 E3 優先級
// 對應 design docs v5_engine_3_central_router.md §4.2
// Damon source: 5.3 Re-imprinting 觸發訊號 + 5.6.2 caveat 退場機制 + 6.1 MVP 範圍
//
// ⭐ §3 patch 6/4 (safety patch #23 / draft, awaits Vivi sign-off on 紅線 20):
//   紅線 20 擴充 4 categories — (d) passive death wish 偵測支援.
//   - trauma regex 加「上吊」
//   - 新增 PASSIVE_STRONG_REGEX 強訊號 (明說「不想活 / 希望死」)
//   - 新增 PASSIVE_IMPLICIT_REGEX 隱性訊號 (「上天讓我活著」「此生無憾」等)
//   - 新增 SURFACE_LIFE_SIGNAL_REGEX 支持訊號 (「活下去 / 動力 / 意義」類詞,
//     C-2 需配合至少一個本 session 內 surface 才觸發)
//   - 新增話術變體 C-1 / C-2 / C-3 (handler 依強訊號 / 隱性 / 累積觸發三選一)
//
// ⚠️ 變體 C 文案為 draft (Vivi 6/4 框架: 承認 → 不分析 → handoff → 1925).
//   待 Vivi 對齊 patch 原檔 Patch 3 §3.2-3.4 後 finalize copy.

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

2. **handoff_escalation(附錄 A3)**:
   (三選一)
   > 「你現在比較想要:
   > (a)先停在這、不繼續挖、我們改聊輕一點的
   > (b)我幫你預約跟 Vivi 1-on-1、有個真人陪你走這段
   > (c)我們先回到日常、Future Pacing、過陣子再回來看
   > 你選哪個都可以——我不繼續推進。」

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
// C-3: 累積 ≥ 3 次 (跨 session) → 移除三選一中的 (c) (繞回日常 = 否認問題)
//
// 共同收尾: 1925 安心專線文案 + 禁止段 5 條.
// ⚠️ 文字 draft, Vivi sign-off 後 finalize.
// ─────────────────────────────────────────────────────────

const HOTLINE_1925 = `📞 24 小時安心專線 1925 (依舊愛我) — 不用預約、不用付費、有人接。
如果現在不方便講電話、也可以打給 1995 (生命線) 或 1980 (張老師),
或上「衛福部安心專線」官網用文字 chat。`;

const FORBIDDEN_5 = `**禁止**:
- 不可詢問創傷 / passive 訊號的具體細節(會強化記憶、可能引發更深崩潰)
- 不可進行 Re-imprinting 任一步驟(v5.0 MVP 範圍外)
- 不可說「我們一起面對」/「我陪你走」(AI 過度承諾)
- 不可繼續身份測試 / values elicitation 推進
- 不可給「想開一點」「往好處想」這類淺安撫 (passive DW patient 體驗為否定)`;

// 變體 C-1: 強訊號
export const prompt_content_passive_dw_strong = `[SYSTEM INJECT — Passive Death Wish · Strong Signal]

偵測到 passive death wish 強訊號 (明說「不想活 / 希望死」)。
Damon 體系視為「希望作為絕望的防禦機制」(Hope as Hopelessness)。
**立即停、不追問細節、handoff 給選擇權**——不在 AI 內執行 Re-imprinting (MVP 範圍外)。

**必須做**:

1. **承認 + 不分析**:
   > 「我聽到你說『[creating quote]』。
   > 這是個很重要的訊號——
   > 我想停下來、不繼續推進。」

2. **直問 SI confirm** (A6 過渡行為 — TODO(任務3): 替換為 Crisis Mode SI SOP):
   > 「我想直接問你:你現在有沒有想要傷害自己的念頭?」
   > —— 等學員下一輪回答、handler 會依 deny / confirm / ambiguous 分流.

3. **patch 設 si_confirm_pending=true** → 下一輪走 SI 分類路徑.

${FORBIDDEN_5}

${HOTLINE_1925}`;

// 變體 C-2: 隱性訊號 (passive 隱性 + 本 session 已 surface 活下去類詞)
export const prompt_content_passive_dw_implicit = `[SYSTEM INJECT — Passive Death Wish · Implicit Signal]

偵測到 passive death wish 隱性訊號 (「上天讓我活著」「此生無憾」「沒有想做的」)、
+ 本 session 已 surface「活下去 / 動力 / 意義」類詞 (兩條同現 = 隱性 DW 非哲學表述).
這可能是把「沒有不想活」當「有想活」的 self-deception, 也可能真是哲學位置.
**先停、先問字面 vs 感受、不直接斷定 SI**.

**必須做**:

1. **承認 + 區分 framing**:
   > 「我聽到你說『[creating quote]』——
   > 我想停一下、先問你:這句話對你來說、是一個哲學的位置 (對人生大致沒遺憾)、
   > 還是現在心裡有「不太想活下去」的感覺?」

2. **依學員回答分流**:
   - 學員答「字面意思 / 哲學」→ 不 handoff、但 passive_death_wish_count 仍 +1 (觀察).
     回到當前 phase context、temperature 略低、不追同類詞.
   - 學員答「真的不想活 / 累 / 想離開」→ 升級走 C-1 強訊號路徑、直問 SI confirm.

3. **patch 設 passive_dw_implicit_pending=true** → 下一輪 handler 看學員 framing 答案.

${FORBIDDEN_5}

${HOTLINE_1925}`;

// 變體 C-3: 累積 ≥ 3 次 (移除繞回日常的 (c) 選項)
export const prompt_content_passive_dw_repeat = `[SYSTEM INJECT — Passive Death Wish · Cumulative ≥ 3]

跨 session 已累積 3 次以上 passive DW 訊號 (passive_death_wish_count >= 3).
此學員需要 human 介入、不能再讓 AI 用「繞回日常」當 default exit.
**handoff_escalation 移除 (c) 選項、只剩 (a) + (b)**.

**必須做**:

1. **承認 + 標記累積**:
   > 「我聽到你說『[creating quote]』。
   > 我注意到我們最近不只一次走到類似的位置——
   > 我想停下來、把選擇權交給你。」

2. **handoff_escalation(無 c 版)**:
   > 「你現在比較想要:
   > (a)先停在這、不繼續挖、我們改聊輕一點的
   > (b)我幫你預約跟 Vivi 1-on-1、有個真人陪你走這段
   > 你選哪個都可以——我不繼續推進。」

3. **patch passive_dw_escalated=true** → flag Vivi dashboard.

${FORBIDDEN_5}

${HOTLINE_1925}`;

// 變體 C-4: count >= 5 → freeze
export const prompt_content_passive_dw_freeze = `[SYSTEM INJECT — Passive Death Wish · FREEZE (count >= 5)]

跨 session 已累積 5 次以上 passive DW 訊號 — 自動 freeze AI 推進.
**AI 不再給推進選項、只交還給人類**.

**必須做**:

1. **承認 + 標記**:
   > 「我聽到你說『[creating quote]』。
   > 我想停下來——這段已經超過我能負責的位置了、
   > 我需要把這裡交給 Vivi。」

2. **強制只剩 (b) + HITL alert**:
   > 「下一步、我幫你安排跟 Vivi 1-on-1 (或你信任的精神科 / 諮商心理師)、有個真人陪你走這段。
   > 在那之前、如果你願意、可以打 1925、24 小時都有人接。」

3. **patch passive_dw_frozen=true + HITL alert side effect** → Vivi 收到即時通知.

${FORBIDDEN_5}

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
  prompt_content_passive_dw_repeat,
  prompt_content_passive_dw_freeze,
  // §3 patch 6/4: ~240 → ~600 (variant C 三段 + 1925 + 禁止段擴增).
  // 注意: deep-signal-detector 是 conditional_inject (動態), 不在 CACHED_PREFIX
  // 路徑、修改不 invalidate prompt cache.
  token_estimate: 600,
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
