// lib/prompt-sections/conditional/engine-2/master-detector.js
// E2_identity_test_master_detector (Layer 1, detector_only)
// 對應 design docs v5_engine_2_identity_test_adjudicator.md §4.1 + §5.1 (Quality 詞表) + §5.2 (身份句結構)
//
// 每 user turn 檢查「本 turn 是否有可能是 Quality 候選詞或身份句出現」
// skip 條件: deviation_handled_this_turn != null (引擎 1 處理偏離中)

// ─────────────────────────────────────────────────────────
// §5.1 Quality 詞表 (~80 個、中文亞洲適配)
// 來源: Damon vocabulary (~15) + Scope Overlap (5) + A001 corpus (10) + 設計師 expand (50)
// ─────────────────────────────────────────────────────────

export const QUALITY_TERMS = Object.freeze({
  // 群 A: Damon 體系明確示範過的 Quality (high-priority match)
  damon_validated: [
    '好奇的', '勇敢的', '外向的', '慷慨的', '給予的', '善良的', '真實的', '真誠的',
    '有愛的', '有創造力的', '有勇氣的', '有智慧的', '平靜的', '自由的', '外放的', '開朗的',
  ],

  // 群 B: 亞洲文化適配 Damon 同源 (設計師 expand)
  east_asian_adapted: [
    '踏實的', '穩定的', '堅定的', '認真的', '用心的', '專注的', '投入的',
    '溫柔的', '體貼的', '有溫度的', '有同理心的', '會傾聽的',
    '有韌性的', '能堅持的', '有耐性的', '能等待的',
    '誠實的', '坦白的', '表裡如一的', '內外一致的',
    '獨立的', '自主的', '有主見的', '敢做自己的',
    '有想像力的', '有靈感的', '會玩的', '有童心的',
    '踏實活著的', '好好生活的', '好好愛自己的', '遵循內心的',
  ],

  // 群 C: 行動類 Quality
  action_qualities: [
    '能做決定的', '敢說不的', '會設邊界的', '會說出需要的',
    '願意嘗試的', '敢冒險的', '不怕失敗的', '能重來的',
    '能放下的', '能原諒的', '能往前走的', '能接受的',
    '能享受的', '能感受的', '能投入當下的', '能慢下來的',
  ],

  // 群 D: 存在類 Quality
  existence_qualities: [
    '完整的', '不缺什麼的', '夠了的', '安住的',
    '有方向的', '有重心的', '有根的', '有家的',
    '能被看見的', '能被愛的', '能被需要的', '能被信任的',
  ],

  // 群 E: A001 corpus 自發詞 (原話保留)
  a001_corpus: [
    '鑽石', '發光', '發光的人', '充滿愛', '充滿能量', '充滿愛與能量',
    '篤定', '自在', '滿足', '喜悅',
    'Use the best of me', '用全部的我',
    '為了讓鑽石發光', '有好好愛自己的',
  ],

  // 🚨 v5.1 Step 5b §5.1 黑名單 tier 化 (Vivi 6/4)
  //   3 tier 結構,語意判斷由 prompt + handler 共同承擔.
  //   tier 1 → matchE2 hard reject (existing behavior).
  //   tier 2 → suspected=true, blacklist_tier='tier2_conditional' flag (conditional guidance).
  //   tier 3 → suspected=true, blacklist_tier='tier3_borderline_with_reframe' flag.
  blacklist_tiers: Object.freeze({
    // Tier 1 absolute reject: Status / Power / Self-worth / Fulfillment / Purpose /
    //   Meaning (無 underlying) / 被需要 / 被選擇 / 被認同 + v5.0 既有.
    tier1_absolute_reject: [
      // v5.0 既有 (外部驗證 trap / 副產品空泛詞 / self-discipline / helping others)
      '成功的', '有權力的', '有面子的', '被尊重的', '有 self-worth 的',
      '有 fulfillment 的', '有 purpose 的', '有 meaning 的', '有 confidence 的',
      '自律的', '能控制自己的', '有紀律的',
      '幫助別人的',
      // v5.1 §A1 new: 被需要 / 被選擇 / 被認同 + Status / Power 同義
      '被需要', '被需要的', '被需求', '被需求的',
      '被選擇', '被選擇的', '被挑中', '被挑中的', '被堅定選擇', '被堅定選擇的',
      '被認同', '被認同的', '被肯定', '被肯定的', '被認可', '被認可的',
    ],
    // Tier 2 conditional: 安全感 / 開心 / 有意義 / 希望 — 語意判斷由 prompt 接管.
    tier2_conditional: [
      // 安全感 / 穩定性
      '安全感', '穩定性', '穩定的', '有安全感的',
      // 副產品: 開心 / 快樂 / 幸福 / 滿足
      '開心', '開心的', '快樂', '快樂的', '幸福', '幸福的', '滿足', '滿足的',
      // 向外索求 vs 本質: 有意義 / 有用 / 有價值
      '有意義', '有意義的', '有用', '有用的', '有價值', '有價值的',
      // 希望 as quality (絕大多數拒、cascade S2)
      '希望', '希望的', '有希望的',
    ],
    // Tier 3 borderline (收 + 強制 reframe): 自由 / 真實 Authenticity.
    //   自由 → R5 Away From → Toward 接管 (Damon Reframe Library, Step 7 PR-7a).
    //   真實 → Damon 推薦、特殊優先 (R5 not applicable, 直接 accept).
    tier3_borderline_with_reframe: [
      '自由', '自由的', 'Freedom',
      '真實', '真實的', '真誠', '真誠的', 'Authentic', 'Authenticity',
    ],
  }),
  // 平面 blacklist alias (matchE2 backward compat): tier 1 only is the hard reject.
  blacklist: [
    '成功的', '有權力的', '有面子的', '被尊重的', '有 self-worth 的',
    '有 fulfillment 的', '有 purpose 的', '有 meaning 的', '有 confidence 的',
    '自律的', '能控制自己的', '有紀律的',
    '幫助別人的',
    '被需要', '被需要的', '被需求', '被需求的',
    '被選擇', '被選擇的', '被挑中', '被挑中的', '被堅定選擇', '被堅定選擇的',
    '被認同', '被認同的', '被肯定', '被肯定的', '被認可', '被認可的',
  ],
});

// 特殊 flag
export const QUALITY_TERM_FLAGS = Object.freeze({
  // A001 Day 2 PPL 風險詞、即使 4 重組合過、引擎 3 路由時要額外檢查 cumulative_ppl_score
  candidate_only: ['篤定'],
  // 非標準 quality、但需要支援:命中時 master_detector 必須伴隨身份句結構命中才觸發 aggregator
  requires_identity_sentence: ['鑽石'],
});

// ─────────────────────────────────────────────────────────
// §5.2 身份句結構 (8 個 regex、v4.0 5 + 設計師擴展 3)
// ─────────────────────────────────────────────────────────

export const IDENTITY_SENTENCE_STRUCTURES = Object.freeze([
  { id: 'IS1', regex: /我是一個(.+?)的人/,           source: 'v4.0 工具二 2A' },
  { id: 'IS2', regex: /我是一個喜歡(.+?)的人/,       source: 'v4.0 工具二 2A' },
  { id: 'IS3', regex: /我是一個討厭(.+?)的人/,       source: 'v4.0 工具二 2A',
    note: 'Damon 體系 quality 可以反向定義——「討厭 X」隱含對立 quality 的認領' },
  { id: 'IS4', regex: /我是一個感動時很(.+?)的人/,   source: 'v4.0 工具二 2A',
    note: '情緒場景下的 quality、用於採集 Reactive Pattern' },
  { id: 'IS5', regex: /我是一個認為(.+?)很重要的人/, source: 'v4.0 工具二 2A',
    note: 'Values-as-identity、跨越 values 與 quality 邊界' },
  { id: 'IS6', regex: /我這人(.+)/,                  source: '設計師擴展、亞洲口語身份句' },
  { id: 'IS7', regex: /我天生(.+)/,                  source: '設計師擴展、本質性身份句' },
  { id: 'IS8', regex: /(.+?)是我這個人最重要的部分/, source: '設計師擴展、values-identity 連接句' },
]);

// ─────────────────────────────────────────────────────────
// detector definition
// ─────────────────────────────────────────────────────────

export default {
  id: 'E2_identity_test_master_detector',
  type: 'detector_only',
  trigger_event: 'user_turn',
  priority: 70,  // CASCADE_PRIORITY.E2_identity_test_pipeline (after all E1/E3)
  pipeline_role: 'master',
  pipeline_parent: null,
  prompt_content: '',
  quality_terms: QUALITY_TERMS,
  quality_term_flags: QUALITY_TERM_FLAGS,
  identity_sentence_structures: IDENTITY_SENTENCE_STRUCTURES,
  parse_state_patch: {
    description: 'Set identity_signal_suspected_this_turn + candidate_term + identity_sentence_pattern_hit on regex hit',
    affects: [
      'session_state.identity_signal_suspected_this_turn',
      'session_state.current_quality_candidate_term',
      'session_state.identity_sentence_pattern_hit',
    ],
  },
  inputs_from_state: [
    'session_state.last_user_response',
    'session_state.deviation_handled_this_turn',
    'session_state.identity_test_evidence_count',
    'session_state.current_quality_status',
  ],
  skip_condition: 'session_state.deviation_handled_this_turn != null (E1 已處理偏離中)',
  damon_source: [
    'spec docs/v5-spec/design/v5_engine_2_identity_test_adjudicator.md §4.1 / §5.1 / §5.2',
    'Damon 1.4 Ambiguous Quality 定義',
    'Damon Lauren / George / Kyle 案例',
  ],
};
