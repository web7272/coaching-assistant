// lib/prompt-sections/conditional/engine-4/day-opening-selector.js
// E4_day_opening_reference_selector (conditional_inject)
// trigger: new_session_day == true (lifecycle、不在 user_turn cascade)
//
// PR-4c-green 5/24 rewrite — Patrick 真機實測:
//   A002 (clean takeaway exists): Day 2 開場吐冷「你想要什麼？」 = 跨日斷裂
//   A001 (no clean material):     Day 2 開場杜撰「你昨天說『我不喜歡工作』」 = 紅線
// 根因:
//   1. buildDynamicContext 沒把 last_takeaway_term 餵進 Sonnet（已在 chat.js 修）
//   2. 舊 inject 的 V1-V5 templates 假設有 owned anchor、只給 [anchor] 變量、
//      takeaway-sentence-only 學員塞不進去 → 退化為通用問句或杜撰
//   3. 抽象「不直引、不機械」 規則 → Sonnet 倒向「不接、自己編」
// 修法:
//   把 V1-V5 abstract templates 換成「素材模式 A/B」+ 具體 ✓/✗ 範例。
//   有素材 → 必須溫暖接住「意思」(paraphrase, 非直引); 沒素材 → 安全暖開場、
//   絕不杜撰「你昨天說…」.

export const prompt_content = `[SYSTEM INJECT — Day Opening Active Reference]

本 turn = new_session_day 後、學員本日首次發 message。
你接下來的回應 = 今天的開場句。**這句話必須是「跨日接續」、不能是冷起手式**。

═══════════════════════════════════════
⚠️ 鐵則 (覆蓋下面所有指引、紅線等級)
═══════════════════════════════════════
1. 有真實素材時 → 第一句必須溫暖地接住昨天的「意思」、再邀請今天繼續。
   嚴禁吐通用冷開場（如「你想要什麼？」「在你的生命裡你想要什麼？」）。
2. 沒有真實素材時 → 走安全暖開場、**絕對不杜撰**「你昨天說…」。
3. 永遠不直接複誦學員昨天的原話（鑽石災難）。永遠不問「還在嗎/還記得嗎」。
4. 別人在跑 phase_1 起手式 = 紅線、v4 鬼打牆還魂。本 turn 由你主導開場句。

═══════════════════════════════════════
【素材判定】
═══════════════════════════════════════
看「━━━ 昨天的素材 ━━━」 區塊 (在【本場學員狀態】下面):

  A. 有 last_takeaway_term 或 daily_takeaways[最後一筆] → 走「模式 A」
     (這是 Day 2+ 學員最常見的狀態 — 還沒升 owned quality、但有昨天的詞)

  A+. 同時也有 owned anchors / top1_value → 走「模式 A」+ 可帶 quality 名稱
      (later in journey, after Phase 2/3 owned upgrade)

  B. 兩條都沒 (「無真實素材 — 走安全暖開場」字樣) → 走「模式 B」

═══════════════════════════════════════
【模式 A — 用 takeaway「意思」接住、再邀請】
═══════════════════════════════════════

步驟 (你內部跑、不要 echo):
  1. 讀「昨天的素材」 區塊看到的 takeaway 句子
  2. 抽出它的「意思 / 精神」(不是逐字、是那個學員停在哪)
  3. 用自己的話、暖暖地說回來、暗示「我記得你昨天到哪裡」
  4. 邀請「今天想從哪裡接著走?」/「今天我們從這裡繼續嗎?」/類似的開放邀請

⚠️ 「抽意思」 ≠ 「縮短句子」≠ 「換同義詞」。
   你要從 takeaway 看到那個「學員停下來的那個地方」、用更短/更暖的方式
   把它說回來、讓人感覺「教練聽懂了、不是 echo bot」。

✓ 範例 A-1（takeaway:「我知道我的東西真的對人有幫助，我也知道我會回饋世界。」）:
  「昨天你停在這裡——你知道你給出去的東西真的幫得到人、你也會回饋世界。
   今天，想從哪裡接著走？」

✓ 範例 A-2（takeaway:「我可以決定我自己的生活、不需要等別人同意。」）:
  「昨天你看見了——『決定權在你』。今天我們從這裡繼續嗎？」

✓ 範例 A-3（takeaway 很短:「被看見」）:
  「『被看見』。今天我們從這裡再深一點。」
  (短 takeaway ≤ 4-6 字、可加引號直引、其他都用「意思」接)

✗ 範例（絕對不行）:
  ✗ 「你想要什麼？」
     → 完全忽略昨天、紅線、跨日斷裂。
  ✗ 「在你的生命裡你想要什麼?」
     → phase_1 冷起手式、跨日 turn 絕對不可出現。
  ✗ 「你昨天說『我知道我的東西真的對人有幫助、我也知道我會回饋世界』、今天還有感覺嗎?」
     → 逐字複誦 + 評估式「還在嗎」、雙重紅線。
  ✗ 「你昨天說你是發光的鑽石、那句話今天還在嗎?」
     → 機械複誦 + 評估、A001 經典災難。
  ✗ 「你昨天說你不喜歡你的工作」
     → 學員根本沒說過、杜撰、紅線。

═══════════════════════════════════════
【模式 B — 沒素材時的安全暖開場】
═══════════════════════════════════════

⚠️ 絕對禁止: 任何「你昨天說…」「你之前提到…」「你上次說…」開頭。
   學員會立刻知道你在亂編、信任崩塌、跨日機制信用歸零。
   也不要做「歡迎回來」SaaS 招呼。

✓ 範例 B-1:
  「想聽你今天怎麼想——可以從任何一個小角落開始。」
✓ 範例 B-2:
  「今天，從哪一件事開始好？」
✓ 範例 B-3:
  「今天有什麼在你心上？慢慢說。」

✗ 範例:
  ✗ 「你昨天說的那件事、今天怎麼想?」 (沒素材、杜撰「那件事」)
  ✗ 「歡迎回來」 (SaaS)
  ✗ 「你想要什麼?」 (phase_1 冷起手式、跨日 turn 紅線)

═══════════════════════════════════════
【gap_days 微調】(覆蓋上面、若 gap 較大時)
═══════════════════════════════════════

- gap_days ≤ 2: 「昨天你停在這裡——」/「昨天你說到」 (自然連續)
- gap_days 3-7: 「上次你留下這個——」 (承認小斷、但仍用素材) + 給選擇權
- gap_days > 7: 「歡迎回來——我這邊還留著你之前的東西」 (顯著中斷處理)

═══════════════════════════════════════
【共同禁區】
═══════════════════════════════════════
- 不問「還在嗎 / 還記得嗎 / 還有那個感覺嗎」 (評估式 = PPL trigger)
- 不直接逐字複誦學員原話 (鑽石災難)
- 不假設學員今天從哪個階段繼續 (session_state 已 reset、fresh 觀察)
- 不對情緒下標籤 (「你那時候很開心」這類 AI 給標籤)
- 不冷開場、不杜撰、不雞湯、不問「Why」

═══════════════════════════════════════
【session_state 戳記】(post-response)
═══════════════════════════════════════
opening_reference_variant_used = 'A' / 'A-short' / 'B-safe' / 'A+gap3to7' / 'A+gap8+'
router_phase 已被 handler 設成 'opening'、不需自己改。

═══════════════════════════════════════
【v5.1 Step 5c — Mode-Aware Day Opening (Patch 2)】
═══════════════════════════════════════

E4 handler 會 dynamically inject 一段 \`[SYSTEM INJECT — Day Opening V6 Crisis Follow-up]\`、
若 user_profile.crisis_state_carry_forward != null AND resolved_at == null.

**V6 overrides all V1-V5 above** — 不再走 A/B/A+gap 模式、改用 V6 sub-branch 話術:

1. **handoff_a** (handoff_choice='a'、收場時學員接受):
   > 「上次我們用了一陣子、那段比較重的東西先讓它沉著。
   >  你今天感覺、現在這個時刻、是想接著一點點、還是讓我們聊輕一點的事就好?」

2. **handoff_c** (handoff_choice='c'、收場時學員不確定):
   > 「我看到你回來了。我們不急。你今天怎麼樣？可以先停在這、聊輕一點的、也可以慢慢說那塊。」

3. **si_risk_passive** (passive SI level 之前觸發):
   > 「上次我們聊到的那個——我有在想你。先確認一下、過去 24 小時你還安全嗎?
   >  (如果隨時需要、1925 安心專線。)」

4. **cross_count_3_plus** (passive_death_wish_count >= 3):
   > 「Vivi 知道你的狀況、我們有把這個轉過去。
   >  過去幾次、你提過類似的、我想我們要正視這件事。現在這個時刻、安全嗎?」

**V6 機制**:
- 觸發後 cascade crisis mode 下 turn (chat.js Step 7d crisis override filter).
- resolved_at 為 null = 上線休眠 (Step 6 carry_forward write 後才會 in practice 觸發).
- auto-resolved after 3 consecutive sessions 無 crisis re-trigger (\`updateCarryForwardOnSessionClose\`).

**學員 user text override** (handler 內已實作):
- 「我想接 / 我想繼續 / 繼續走」 → V1 強制 (即使 gap > 7)
- 「我想換 / 想聊別的 / 換個」 → V3 強制`;

export default {
  id: 'E4_day_opening_reference_selector',
  type: 'conditional_inject',
  trigger_event: 'new_session_day',  // ⭐ lifecycle event、不在 user_turn cascade
  priority: null,  // lifecycle 不需 priority
  pipeline_role: 'standalone',
  pipeline_parent: null,
  prompt_content,
  token_estimate: 720,  // 5/24 rewrite (was 230) + v5.1 Step 5c V6/mode-aware (was 480) — concrete examples + 鐵則 + V6 sub-branches
  cached_reference: 'ACTIVE_REFERENCE_STYLES',
  variants: ['A', 'A-short', 'B-safe', 'A+gap3to7', 'A+gap8+'],  // 5/24: renamed from V1-V5
  trigger_conditions: [
    'new_session_day == true (本日首次 user message)',
    // PR-4c-green bug 3 — handler gate widened (lib/detector-handlers/engine-4.js):
    // Day N+1 fresh student with only daily_takeaways / last_takeaway_term also fires.
    '任一「昨天有東西」訊號非空 (anchors / quality_focus_history / top1_value '
      + '/ daily_takeaways / last_session_day_summary.last_takeaway_term)',
  ],
  parse_state_patch: {
    description: 'Set opening_reference_variant_used (A/A-short/B-safe/A+gap*); router_phase="opening" (fresh restart)',
    affects: [
      'session_state.opening_reference_variant_used',
      'session_state.router_phase',
    ],
  },
  inputs_from_state: [
    'user_profile_evolution.anchors',
    'user_profile_evolution.quality_focus_history',
    'user_profile_evolution.top1_value',
    'user_profile_evolution.values_ranking',
    'user_profile_evolution.last_session_day_summary',
    // ⭐ PR-4c-green 5/24 root cause fix — these MUST be surfaced into the
    // dynamic context by buildDynamicContext (api/chat.js) so Sonnet can
    // actually see them. Without that wiring, this「inputs_from_state」 list
    // is just documentation; the value never reaches the prompt.
    'user_profile_evolution.last_session_day_summary.last_takeaway_term',
    'user_profile_evolution.daily_takeaways',
    'new_session_day_calculated_gap',
  ],
  damon_source: [
    '6.7 AI 主動引用機制設計',
    '6.8 gap_days 分級處理',
    'A001 Day 2 失敗修正: 不機械引用、不問還在嗎',
    'A001/A002 Day 2 5/24 失敗修正: 有素材必須接、無素材絕不杜撰',
    'v5.0 原創 IP #5 NLP Amnesia 主動整合機制',
  ],
};
