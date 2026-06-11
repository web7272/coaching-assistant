// lib/prompt-sections/prompt-sections.test.js
// 驗證 export shape + 跟 PR-3c registry 介面相容性
// 25 個檔案: 4 cached + 20 conditional + 1 aggregate index

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  CACHED_PREFIX_SECTIONS,
  CACHED_PREFIX_TOKEN_ESTIMATE,
} from './cached/index.js';

import {
  DIRECTLY_REGISTERED_DETECTORS,
  ALL_PROMPT_SECTIONS,
  ENGINE_1_PIPELINE,
  ENGINE_2_PIPELINE,
  ENGINE_3_SUB_ROUTERS,
  ENGINE_4_COMPONENTS,
} from './conditional/index.js';

import {
  DETECTOR_TYPES,
  TRIGGER_EVENTS,
  CASCADE_PRIORITY,
  DetectorRegistry,
} from '../detector/registry.js';

// ─────────────────────────────────────────────────────────
// cached/ 4 段
// ─────────────────────────────────────────────────────────

test('cached prefix: exactly 4 sections in fixed order', () => {
  assert.equal(CACHED_PREFIX_SECTIONS.length, 4);
  assert.equal(CACHED_PREFIX_SECTIONS[0].order, 1);
  assert.equal(CACHED_PREFIX_SECTIONS[1].order, 2);
  assert.equal(CACHED_PREFIX_SECTIONS[2].order, 3);
  assert.equal(CACHED_PREFIX_SECTIONS[3].order, 4);
});

test('cached prefix: last section has cache_breakpoint=true (spec 04 §1)', () => {
  const last = CACHED_PREFIX_SECTIONS[CACHED_PREFIX_SECTIONS.length - 1];
  assert.equal(last.cache_breakpoint, true, 'cache_control: ephemeral 必須標在最後一段');
  assert.equal(last.id, 'active_reference_styles');
});

test('cached prefix: every section has non-empty content + positive token_estimate', () => {
  for (const s of CACHED_PREFIX_SECTIONS) {
    assert.ok(typeof s.content === 'string' && s.content.length > 0, `${s.id} has empty content`);
    assert.ok(typeof s.token_estimate === 'number' && s.token_estimate > 0, `${s.id} bad token_estimate`);
    assert.equal(s.type, 'always_on_cached');
  }
});

test('cached prefix: total token estimate matches spec 04 (~4000)', () => {
  // spec 04 §0: damon 1200 + 5-layer 600 + 4-7-router 1400 + active-ref 800 = 4000
  // I used 1250 + 600 + 1400 + 800 = 4050 — close enough
  // 5/25 (Day-4 C1): damon 1400→1450 (紅線 21 +50 tok) → ceiling 4200→4300
  // 5/29 (A003 sandbox v3, 守住記憶 frame): damon 1450→1900, §3 router
  //   1400→1700 → ceiling 4300→5100 (一次最大的 cached patch、frame 段較長因為
  //   3 情境 + 防濫用 + 心法示範各自獨立成段, 之後若濃縮再降回去).
  // 6/4 (safety patch #23, 紅線 20 擴 4 categories +(d) passive DW): damon
  //   1900→2000 → ceiling 5100→5200 留 100 tok 緩衝給後續微調.
  // 6/4 (v5.1 s3patch, 紅線 22-25 + 世界觀 3 statement + 4 reframe pattern):
  //   damon 2000→2400 → ceiling 5200→5600 留 100 tok 緩衝.
  // 6/4 (v5.1 Step 5c errata Patch 1, active-reference Reframe Library + mode routing):
  //   active-ref 800→1200 → ceiling 5600→6000 留 100 tok 緩衝.
  // 6/5 (v5.1 Step 7 PR-7b, active-reference + R8/R12 reference):
  //   active-ref 1200→1320 → ceiling 6000→6200 留 100 tok 緩衝. ⚠️ cache invalidation 一次.
  // 6/5 (v5.1 Step 9 cached §3 replacement, four-seven-router → mode-aware-router-reference):
  //   §3 router 1700→1600 (errata 設計師估、節點變多 phrasing 精簡) → total降 100、
  //   floor 微調保留 6 mode 框架 expand 空間. ⚠️ cache invalidation 一次 (與 Step 10 simulation 一起 re-warm).
  // 6/11 (v5.2 七步 errata PR-2, cached §3 末尾 append §3.5 七步路徑 internal framing):
  //   §3 router 1600→1800 (§3.5 ~+200 tok, Vivi 終審逐字鎖定) → ceiling 6100→6300 留 100 tok 緩衝.
  //   ⚠️ cache invalidation 再一次 (Patrick 排低流量窗口 + re-warm, 同 PR-b 紀律).
  assert.ok(CACHED_PREFIX_TOKEN_ESTIMATE >= 3800 && CACHED_PREFIX_TOKEN_ESTIMATE <= 6300,
    `token estimate ${CACHED_PREFIX_TOKEN_ESTIMATE} outside [3800, 6300]`);
});

// 🛑 5/29 Patrick (Vivi A003 sandbox v3) — 守住記憶 frame 段必須在 cached prefix
//   裡 (現在只在 damon-core-philosophy; Step 9 cached §3 重寫後 §3 不再 dup 此段).
//   修 Sonnet 被質疑時諂媚 hallucinate「我沒對話記錄」, 同時鎖紅線「絕對不編造看不到的具體錨點」.
test('🛑 5/29 (A003 v3): damon-core-philosophy 含「守住記憶 frame」段 + 三情境 + 紅線', () => {
  const damonCore = CACHED_PREFIX_SECTIONS[0];
  // 段標題
  assert.match(damonCore.content, /守住記憶 frame/);
  // 心法核心句
  assert.match(damonCore.content, /錨點要真、沒有就轉當下、絕不編造/);
  // 三情境
  assert.match(damonCore.content, /情境 A.*context.*錨點/s);
  assert.match(damonCore.content, /情境 B.*看不到.*context 沒帶到/s);
  assert.match(damonCore.content, /情境 C.*反覆指出.*落差/s);
  // 紅線
  assert.match(damonCore.content, /編造一個你看不到的具體錨點/);
  assert.match(damonCore.content, /frame 詐騙/);
  // 防濫用界線
  assert.match(damonCore.content, /防濫用界線/);
  // 心法收尾
  assert.match(damonCore.content, /你不是 search engine、你是教練/);
});

// ⭐ v5.1 cached §3 replacement (Step 9, 2026-06-05): four-seven-router →
//   mode-aware-router-reference. 5/29 守住記憶 frame test 退役 — the new §3
//   is the 6 mode framework; 守住記憶 frame relevant content moved to
//   damon-core-philosophy (cached §1) where the 25 紅線 lives.
test('🛑 v5.1 Step 9: cached §3 = mode_aware_router_reference (NOT four_seven_router)', () => {
  const router = CACHED_PREFIX_SECTIONS[2];
  assert.equal(router.id, 'mode_aware_router_reference');
  assert.equal(router.order, 3);
  // No v5.0 4.7 中央路由器 vocabulary leaks (except the deliberate「跟 v5.0
  // four-seven-router 的本質差異」 comparison section).
  assert.doesNotMatch(router.content, /4\.7 中央路由器藍圖/);
  assert.doesNotMatch(router.content, /Re-imprinting 訊號清單/);
});

test('cached: damon-core-philosophy includes 25 紅線 (§3 patch 6/4 v5.1 s3patch)', () => {
  const damonCore = CACHED_PREFIX_SECTIONS[0];
  // ⭐ 6/4 v5.1 s3patch — title 21 → 25.
  assert.match(damonCore.content, /25 條紅線/);
  assert.equal(/16 條紅線/.test(damonCore.content), false, 'title must say 25, not 16');
  assert.equal(/20 條紅線/.test(damonCore.content), false, 'title must say 25, not 20');
  assert.equal(/21 條紅線/.test(damonCore.content), false, 'title must say 25, not 21 (s3patch bumped)');
  assert.match(damonCore.content, /不問「為什麼」/);
  // spot-check key rules
  assert.match(damonCore.content, /付費對等性原則/);
  assert.match(damonCore.content, /擁有這個，對你有什麼重要/);
});

// 🛑 §3 patch 5/25 (Day-4 實測 C1) — 紅線 21：每輪以問句收尾.
test('🛑 §3 patch 5/25 (Day-4 C1): 紅線 21 每輪以問句收尾 + ✗ 範例 + 收尾輪豁免', () => {
  const damonCore = CACHED_PREFIX_SECTIONS[0];
  assert.match(damonCore.content, /21\. 每一輪都以「問句」收尾/);
  assert.match(damonCore.content, /把球留在學員場上/);
  // ✗ + ✓ 雙範例都在
  assert.match(damonCore.content, /✗ 例：/);
  assert.match(damonCore.content, /✓ 例：/);
  // 收尾輪 / session_end 豁免明寫
  assert.match(damonCore.content, /session_end \/ 收尾輪 \/ finalize \/ Day 21 結業/);
  assert.match(damonCore.content, /closure 機制接管/);
});

test('🛑 §3 patch 5/21: 新增紅線 17-20 都在 cached content', () => {
  const damonCore = CACHED_PREFIX_SECTIONS[0];
  // 17 Hierarchy 涵蓋類別 (不線性排序)
  assert.match(damonCore.content, /17\. 不用「最重要 \/ 排第一 \/ 最先想到」排序 values/);
  assert.match(damonCore.content, /最大涵蓋類別.*存在依賴測試/s);
  // 18 不替學員填空
  assert.match(damonCore.content, /18\. 不替學員填空、不總結成新詞/);
  assert.match(damonCore.content, /用學員自己的原話複述/);
  // 19 evidence 三準則 (a)(b)(c)
  assert.match(damonCore.content, /19\. evidence 三準則/);
  assert.match(damonCore.content, /\(a\) 學員自己視角/);
  assert.match(damonCore.content, /\(b\) 現在式/);
  // ⭐ 6/4 v5.1 s3patch — 「Cascade Down 階段」 → 「cascade mode 內」
  assert.match(damonCore.content, /\(c\) 獨立.*cascade mode 內.*Top 2\/3/s);
  assert.equal(/Cascade Down 階段/.test(damonCore.content), false,
    'v5.1 s3patch must rename "Cascade Down 階段" → "cascade mode 內"');
  // 20 深創傷偵測 → handoff、不執行 Re-imprinting
  assert.match(damonCore.content, /20\. 偵測深創傷訊號/);
  assert.match(damonCore.content, /不在 AI 內執行 Re-imprinting/);
});

test('🛑 §3 patch 5/21: 紅線 9 改寫 (內部分類合法、不對學員描述為人格類型)', () => {
  const damonCore = CACHED_PREFIX_SECTIONS[0];
  assert.match(damonCore.content, /9\. 不把內在阻力「對學員描述」為固定人格類型/);
  assert.match(damonCore.content, /阻力是 part、不是 who you are/);
  assert.match(damonCore.content, /AI 內部分類 5 種 resistance.*合法的，但不對學員講分類/s);
  // 舊版單句措辭已不在
  assert.equal(/9\. 不把內在阻力分成固定的人格類型。/.test(damonCore.content), false);
});

// ═════════════════════════════════════════════════════════
// 🛑 §3 patch 6/4 (v5.1 s3patch / 設計師 ship-ready + Vivi 3 decisions)
//   - 紅線 22-25 (Gap #5/#2/#24/#25)
//   - 核心世界觀 +3 statement (Gap #8/#1+#12/#3)
//   - 語氣段 +4 reframe pattern (Gap #10)
// ═════════════════════════════════════════════════════════

test('🛑 §3 patch 6/4 (v5.1 s3patch): 紅線 22 身份不是頻率、不是成績單 (Gap #5)', () => {
  const damonCore = CACHED_PREFIX_SECTIONS[0];
  assert.match(damonCore.content, /22\. 身份不是頻率、不是成績單——/);
  // 觸發訊號
  assert.match(damonCore.content, /至少要 X%/);
  assert.match(damonCore.content, /不夠高頻所以不算/);
  assert.match(damonCore.content, /不是 24 小時都是/);
  assert.match(damonCore.content, /真正的 X 的人頻率更高/);
  // 反制話術
  assert.match(damonCore.content, /『X』是身份、不是成績單/);
  assert.match(damonCore.content, /\[role\] 不會因為 \[low context\] 就不是 \[role\]/);
  assert.match(damonCore.content, /\[event\] 是事件、\[quality\] 是你是誰/);
});

test('🛑 §3 patch 6/4 (v5.1 s3patch): 紅線 23 不接受交易框架 (Gap #2)', () => {
  const damonCore = CACHED_PREFIX_SECTIONS[0];
  assert.match(damonCore.content, /23\. 不接受交易框架——/);
  // 觸發訊號
  assert.match(damonCore.content, /我必須 X 才 Y/);
  assert.match(damonCore.content, /沒有 X 我就 Z/);
  assert.match(damonCore.content, /至少要做到 X 才 Y/);
  // 鍵字
  assert.match(damonCore.content, /換取生存權 \/ 完整感 \/ 被愛資格/);
  // 反制話術
  assert.match(damonCore.content, /這個交易是誰定的/);
  assert.match(damonCore.content, /沒有 X、Y 真的不能存在嗎/);
});

test('🛑 §3 patch 6/4 (v5.1 s3patch): 紅線 24 不接受副產品作為終點 quality (Gap #24)', () => {
  const damonCore = CACHED_PREFIX_SECTIONS[0];
  assert.match(damonCore.content, /24\. 不接受副產品作為終點 quality——/);
  // 6 個副產品詞
  assert.match(damonCore.content, /「開心 \/ 意義 \/ 目的 \/ 快樂 \/ 幸福 \/ 滿足」/);
  assert.match(damonCore.content, /這些是副產品、不是 quality/);
  assert.match(damonCore.content, /鏈式追問挖出產生這些副產品的[\s\n]*更深 quality/);
});

test('🛑 §3 patch 6/4 (v5.1 s3patch): 紅線 25 不接受完美主義框架 (Gap #25)', () => {
  const damonCore = CACHED_PREFIX_SECTIONS[0];
  assert.match(damonCore.content, /25\. 不接受完美主義框架——/);
  assert.match(damonCore.content, /需要全部時間都是 X/);
  assert.match(damonCore.content, /需要 100% 才算 X/);
  assert.match(damonCore.content, /不能有任何 \[behavior\]/);
  // 反制
  assert.match(damonCore.content, /身份不是頻率、任何 X 都有 boundary 跟 event、100% 是不存在的目標/);
});

test('🛑 §3 patch 6/4 (v5.1 s3patch): 核心世界觀 +3 statement (Gap #8/#1+#12/#3)', () => {
  const damonCore = CACHED_PREFIX_SECTIONS[0];
  // Strategy vs Quality (Gap #8)
  assert.match(damonCore.content, /Strategy 是「做什麼」.*Quality 是「你是誰」/s);
  assert.match(damonCore.content, /就算今天不做 X、X 還在你身上嗎/);
  // 你才是價值的源頭 (Gap #1+#12)
  assert.match(damonCore.content, /你才是價值的源頭/);
  assert.match(damonCore.content, /感覺 \/ 愛 \/ 動力是你內在的資源/);
  assert.match(damonCore.content, /把感覺投影到他人 \/ 環境 \/ 條件時/);
  assert.match(damonCore.content, /那個感覺、是從哪裡來的/);
  // Survival vs Thriving (Gap #3)
  assert.match(damonCore.content, /大腦預設是生存.*避開恐懼、Away from/s);
  assert.match(damonCore.content, /Thriving.*迎向潛能、Toward/s);
  assert.match(damonCore.content, /dominant 在 Survival 時/);
  assert.match(damonCore.content, /不急著推 Toward vision/);
});

test('🛑 §3 patch 6/4 (v5.1 s3patch): 語氣段 +4 Damon reframe pattern (Gap #10)', () => {
  const damonCore = CACHED_PREFIX_SECTIONS[0];
  assert.match(damonCore.content, /【Damon 高頻 reframe pattern、偵測到對應訊號時變數填空 invoke】/);
  // 4 個 pattern (含範例)
  assert.match(damonCore.content, /「『X』是身份、不是成績單」.*『自由』是身份、不是成績單/s);
  assert.match(damonCore.content, /「\[event\] 是事件、\[quality\] 是你是誰」.*崩潰是事件、平靜是你是誰/s);
  assert.match(damonCore.content, /「\[role\] 不會因為 \[low context\] 就不是 \[role\]」.*媽媽不會因為今天累就不是媽媽/s);
  assert.match(damonCore.content, /「這是你、不是你為了 \[external validation\] 才變成的樣子」/);
});

test('🛑 §3 patch 5/21: 付費對等性「直接推進」(非「強勢推進」)', () => {
  const damonCore = CACHED_PREFIX_SECTIONS[0];
  assert.match(damonCore.content, /你可以直接推進，不需要太客氣/);
  assert.equal(/強勢推進/.test(damonCore.content), false, '「強勢」中文負面色彩、Vivi sign-off 改「直接」');
});

test('cached: five-layer-unwrap includes 5 動作', () => {
  const fiveLayer = CACHED_PREFIX_SECTIONS[1];
  assert.match(fiveLayer.content, /動作 1:指認/);
  assert.match(fiveLayer.content, /動作 2:區分/);
  assert.match(fiveLayer.content, /動作 3:Mirror/);
  assert.match(fiveLayer.content, /動作 4:連結/);
  assert.match(fiveLayer.content, /動作 5:現場 Mirror/);
});

test('🛑 cached §3 mode_aware_router_reference: 6 modes verbatim from errata v0.1', () => {
  const router = CACHED_PREFIX_SECTIONS[2];
  // Spec body anchors (errata §3 line 21-297 verbatim).
  assert.match(router.content, /§3 主對話 LLM Internal Reference — Mode-Aware Routing/);
  // 6 mode section headers.
  assert.match(router.content, /### Mode 1:Elicitation/);
  assert.match(router.content, /### Mode 2:Identity Anchoring/);
  assert.match(router.content, /### Mode 3:Integration/);
  assert.match(router.content, /### Mode 4:Cascade/);
  assert.match(router.content, /### Mode 5:Future Pacing/);
  // ⚠️ Vivi hotfix 6/5: was `(.|\s)*` — catastrophic backtracking ReDoS
  //   that hung the entire suite (single regex > 20s). Split into 2 literal
  //   anchor checks for safety + speed.
  assert.match(router.content, /### Mode 6:Crisis/);
  assert.match(router.content, /Orthogonal Override/);
  // 雙向流動 reference block.
  assert.match(router.content, /Mode 雙向流動 Reference/);
  assert.match(router.content, /v5\.1 mode flow.*不是線性 phase progression/s);
  // Crisis orthogonal symbol.
  assert.match(router.content, /Mode 6 \(crisis\) ⊥ orthogonal/);
  // 反 regression 概念.
  assert.match(router.content, /不存在「mode 倒退」/);
  // Engine integration reference block (v0.2 — split into 2 mechanisms).
  assert.match(router.content, /Engine Integration Reference/);
  assert.match(router.content, /經由不同機制傳遞/);
  // v0.2: unconditional state inject block.
  assert.match(router.content, /state injection per turn(unconditional|（unconditional|(.{0,2})unconditional)/);
  assert.match(router.content, /active_modes: list/);
  assert.match(router.content, /primary_mode: str/);
  assert.match(router.content, /reframe_invocation_history \(跨 session 累積/);
  // v0.2: conditional sub-prompt injection block.
  assert.match(router.content, /conditional sub-prompt injection/);
  assert.match(router.content, /引擎 1 signals(S1-S6|（S1-S6|(.{0,2})S1-S6)/);
  assert.match(router.content, /引擎 2 candidates/);
  assert.match(router.content, /引擎 4 reframe/);
  assert.match(router.content, /Hero's Welcome 4 步驟 SOP/);
  assert.match(router.content, /Care Less List Vivi 終審版/);
  assert.match(router.content, /Crisis SOP 13 個 sub-prompts/);
  // v0.2: 你的職責 updated phrasing.
  assert.match(router.content, /unconditional state \+ conditional sub-prompt inject/);
  assert.match(router.content, /crisis override 時所有其他 inject paused、只走 crisis sub-prompts/);
  // 跟 v5.0 four-seven-router 本質差異 (kept verbatim).
  assert.match(router.content, /跟 v5\.0 four-seven-router 的本質差異/);
});

test('🛑 cached §3 v0.2: spec_version + cache_invalidation_note metadata', async () => {
  const { default: section } = await import('./cached/mode-aware-router-reference.js');
  assert.equal(section.spec_version, 'v0.2');
  assert.match(section.cache_invalidation_note, /v0\.2 Engine Integration 微調 合併進同一次 invalidate/);
  // v0.1 → v0.2 resolved the「declared-but-no-runtime-correspondent」gap:
  //   engine_1_signals / engine_2_candidates / engine_4_reframe — now correctly
  //   labelled as conditional sub-prompt injection (their actual runtime mechanism).
});

test('🛑 cached §3: (v5.2) forward-compat markers kept verbatim (active_context anchors)', () => {
  const router = CACHED_PREFIX_SECTIONS[2];
  // Errata explicitly marks these as v5.2 forward-compat — must stay intact
  // (active_context inject not wired yet but body references it for future).
  assert.match(router.content, /v5\.2 architecture:active_context 已 lock/);
  assert.match(router.content, /\[active_context\]/);
  assert.match(router.content, /active_context_session_summary/);
  // Module-level forward-compat marker array.
  assert.equal(router.v5_2_forward_compat_markers.length, 3);
});

test('🛑 cached §3: NO leftover four_seven_router references (deprecation hygiene)', () => {
  const router = CACHED_PREFIX_SECTIONS[2];
  // The 1 acceptable occurrence is in「跟 v5.0 four-seven-router 的本質差異」 section header.
  const occurrences = (router.content.match(/four-seven-router|four_seven_router/g) || []).length;
  assert.equal(occurrences, 1,
    'only deliberate 1 occurrence in comparison section header allowed');
});

test('cached: active-reference-styles covers 3 原則 + 5 變體 + gap_days 分級', () => {
  const ref = CACHED_PREFIX_SECTIONS[3];
  assert.match(ref.content, /Damon 引用風格 3 大原則/);
  assert.match(ref.content, /變體 V1/);
  assert.match(ref.content, /變體 V5/);
  assert.match(ref.content, /gap_days 分級處理範本/);
  assert.match(ref.content, /NLP Amnesia/);
});

// ─────────────────────────────────────────────────────────
// conditional/ 20 個 sub-prompts
// ─────────────────────────────────────────────────────────

test('conditional: ALL_PROMPT_SECTIONS has exactly 22 items (PR-23s4c)', () => {
  // PR-23s4c task 2: +integration-router +future-pacing-router → E3 5→7.
  assert.equal(ALL_PROMPT_SECTIONS.length, 22, 'E1 6 + E2 5 + E3 7 + E4 4 = 22');
});

test('conditional: every section has required keys { id, type, prompt_content, parse_state_patch, inputs_from_state, damon_source }', () => {
  for (const s of ALL_PROMPT_SECTIONS) {
    assert.ok(typeof s.id === 'string' && s.id.length > 0, `bad id: ${JSON.stringify(s.id)}`);
    assert.ok(DETECTOR_TYPES.includes(s.type), `${s.id} type "${s.type}" not in DETECTOR_TYPES`);
    assert.ok(typeof s.prompt_content === 'string', `${s.id} prompt_content not string`);
    assert.ok(typeof s.parse_state_patch === 'object' && s.parse_state_patch !== null,
      `${s.id} parse_state_patch missing`);
    assert.ok(Array.isArray(s.inputs_from_state), `${s.id} inputs_from_state not array`);
    assert.ok(Array.isArray(s.damon_source) && s.damon_source.length > 0,
      `${s.id} damon_source missing`);
  }
});

test('conditional: every section has unique id', () => {
  const ids = ALL_PROMPT_SECTIONS.map(s => s.id);
  const set = new Set(ids);
  assert.equal(set.size, ids.length, 'duplicate ids: ' + JSON.stringify(ids));
});

// ─────────────────────────────────────────────────────────
// PR-3c registry compatibility
// ─────────────────────────────────────────────────────────

test('DIRECTLY_REGISTERED_DETECTORS: all valid registry shapes (each can register with stub handler)', () => {
  const r = new DetectorRegistry({ logger: () => {} });
  for (const det of DIRECTLY_REGISTERED_DETECTORS) {
    const stubbed = { ...det, handler: async () => ({ handled: false }) };
    assert.doesNotThrow(() => r.register(stubbed), `${det.id} failed to register`);
  }
  assert.equal(r.size(), DIRECTLY_REGISTERED_DETECTORS.length);
});

test('user_turn detectors: trigger_event="user_turn" + numeric priority (PR-23s4c: 9-step chain)', () => {
  const userTurnDetectors = DIRECTLY_REGISTERED_DETECTORS.filter(d => d.trigger_event === 'user_turn');
  // PR-23s4c task 2: +integration-router +future-pacing-router. Chain 7→9 sub-routers.
  assert.equal(userTurnDetectors.length, 9, 'PR-23s4c: 9-step cascade (E1+7 E3+E2)');
  for (const d of userTurnDetectors) {
    assert.equal(typeof d.priority, 'number', `${d.id} priority not number`);
    assert.ok(d.priority >= 1, `${d.id} priority must be >= 1`);
  }
});

test('user_turn priorities match CASCADE_PRIORITY exactly', () => {
  const expected = [
    // PR-23s4b: task 1 renames per v51_engine_3_errata_v02.md.
    // PR-23s4c: +integration-router (45) +future-pacing-router (65).
    { id: 'E1_deviation_master_detector',       priority: CASCADE_PRIORITY.E1_deviation_pipeline },
    { id: 'E3_deep_signal_detector',            priority: CASCADE_PRIORITY.E3_deep_signal_detector },
    { id: 'E3_elicitation_router',              priority: CASCADE_PRIORITY.E3_elicitation_router },
    { id: 'E3_top1_judge',                      priority: CASCADE_PRIORITY.E3_top1_judge },
    { id: 'E3_integration_router',              priority: CASCADE_PRIORITY.E3_integration_router },        // PR-23s4c
    { id: 'E3_mode_transition_router',          priority: CASCADE_PRIORITY.E3_mode_transition_router },
    { id: 'E3_cascade_mode_validator',          priority: CASCADE_PRIORITY.E3_cascade_mode_validator },
    { id: 'E3_future_pacing_router',            priority: CASCADE_PRIORITY.E3_future_pacing_router },      // PR-23s4c
    { id: 'E2_identity_test_master_detector',   priority: CASCADE_PRIORITY.E2_identity_test_pipeline },
  ];
  for (const e of expected) {
    const det = DIRECTLY_REGISTERED_DETECTORS.find(d => d.id === e.id);
    assert.ok(det, `missing ${e.id}`);
    assert.equal(det.priority, e.priority, `${e.id} priority mismatch (got ${det.priority}, want ${e.priority})`);
  }
});

test('🛑 cascade priority enforces E1 BEFORE E2 (spec 03 §2)', () => {
  const e1 = DIRECTLY_REGISTERED_DETECTORS.find(d => d.id === 'E1_deviation_master_detector');
  const e2 = DIRECTLY_REGISTERED_DETECTORS.find(d => d.id === 'E2_identity_test_master_detector');
  assert.ok(e1.priority < e2.priority, 'E1 偏離治理 must be lower priority number (= higher pri) than E2 身份測試');
});

test('lifecycle detectors: 4 events from E4', () => {
  const eventDetectors = {
    new_session_day:   ENGINE_4_COMPONENTS.day_opening,
    session_end:       ENGINE_4_COMPONENTS.takeaway,
    paired:            ENGINE_4_COMPONENTS.cascade_ref,
    program_milestone: ENGINE_4_COMPONENTS.export,
  };
  for (const [event, det] of Object.entries(eventDetectors)) {
    assert.equal(det.trigger_event, event, `${det.id} trigger_event mismatch`);
    assert.ok(TRIGGER_EVENTS.includes(det.trigger_event));
  }
});

test('paired detector: paired_with set to E3_cascade_mode_validator (PR-23s4b)', () => {
  const pairedDet = ENGINE_4_COMPONENTS.cascade_ref;
  assert.equal(pairedDet.trigger_event, 'paired');
  assert.equal(pairedDet.paired_with, 'E3_cascade_mode_validator');
});

// ─────────────────────────────────────────────────────────
// Pipeline structure (engine 1 + engine 2)
// ─────────────────────────────────────────────────────────

test('engine 1 pipeline: master + classifier + 4 sub-prompts (E1a/b/c/d)', () => {
  assert.equal(ENGINE_1_PIPELINE.master.id, 'E1_deviation_master_detector');
  assert.equal(ENGINE_1_PIPELINE.classifier.id, 'E1_subtype_classifier');
  assert.ok(ENGINE_1_PIPELINE.sub_prompts.E1a);
  assert.ok(ENGINE_1_PIPELINE.sub_prompts.E1b);
  assert.ok(ENGINE_1_PIPELINE.sub_prompts.E1c);
  assert.ok(ENGINE_1_PIPELINE.sub_prompts.E1d);
});

test('engine 1 pipeline internals point to correct parent', () => {
  assert.equal(ENGINE_1_PIPELINE.classifier.pipeline_parent, 'E1_deviation_master_detector');
  for (const sub of Object.values(ENGINE_1_PIPELINE.sub_prompts)) {
    assert.equal(sub.pipeline_parent, 'E1_subtype_classifier');
  }
});

test('engine 2 pipeline: master + aggregator + 3 sub-prompts', () => {
  assert.equal(ENGINE_2_PIPELINE.master.id, 'E2_identity_test_master_detector');
  assert.equal(ENGINE_2_PIPELINE.aggregator.id, 'E2_aggregator');
  assert.equal(ENGINE_2_PIPELINE.sub_prompts.upgrade.id, 'E2_upgrade_to_owned');
  assert.equal(ENGINE_2_PIPELINE.sub_prompts.stay.id, 'E2_stay_candidate');
  assert.equal(ENGINE_2_PIPELINE.sub_prompts.continue.id, 'E2_continue_elicitation');
});

test('engine 3: 7 sub-routers all standalone (no pipeline_parent) — PR-23s4c', () => {
  assert.equal(ENGINE_3_SUB_ROUTERS.length, 7);  // PR-23s4c +integration +future_pacing
  for (const router of ENGINE_3_SUB_ROUTERS) {
    assert.equal(router.pipeline_parent, null, `${router.id} should be standalone`);
    assert.equal(router.pipeline_role, 'standalone');
  }
});

test('engine 4: 4 components with different trigger events', () => {
  const events = new Set([
    ENGINE_4_COMPONENTS.day_opening.trigger_event,
    ENGINE_4_COMPONENTS.takeaway.trigger_event,
    ENGINE_4_COMPONENTS.cascade_ref.trigger_event,
    ENGINE_4_COMPONENTS.export.trigger_event,
  ]);
  assert.equal(events.size, 4, 'each E4 component should have distinct trigger_event');
});

// ─────────────────────────────────────────────────────────
// Damon-aligned content spot checks (search & replace did not corrupt content)
// ─────────────────────────────────────────────────────────

test('content uses student_id (not user_id) — P0 errata', () => {
  for (const s of ALL_PROMPT_SECTIONS) {
    assert.equal(/\buser_id\b/.test(s.prompt_content), false,
      `${s.id} contains "user_id" — should be "student_id" per P0 errata`);
  }
});

test('E1c includes "我不喜歡這個答案" (Damon Lucia 親口)', () => {
  assert.match(ENGINE_1_PIPELINE.sub_prompts.E1c.prompt_content, /我不喜歡這個答案/);
});

test('E1d references TECHNIQUE_5_LAYER_UNWRAP cached reference', () => {
  assert.equal(ENGINE_1_PIPELINE.sub_prompts.E1d.cached_reference, 'TECHNIQUE_5_LAYER_UNWRAP');
});

test('E2 master detector includes Quality 詞表 + 身份句結構', () => {
  const masterDet = ENGINE_2_PIPELINE.master;
  assert.ok(masterDet.quality_terms, 'missing quality_terms');
  assert.ok(masterDet.identity_sentence_structures, 'missing identity_sentence_structures');
  // 5 groups in quality_terms
  assert.ok(masterDet.quality_terms.damon_validated.length > 0);
  assert.ok(masterDet.quality_terms.east_asian_adapted.length > 0);
  assert.ok(masterDet.quality_terms.a001_corpus.length > 0);
  // 8 identity sentence structures
  assert.equal(masterDet.identity_sentence_structures.length, 8, '8 身份句結構 (IS1-IS8)');
});

test('E2 quality_terms.blacklist includes Damon-rejected fake qualities', () => {
  const blacklist = ENGINE_2_PIPELINE.master.quality_terms.blacklist;
  assert.ok(blacklist.includes('成功的'), 'blacklist must include 成功的 (external validation trap)');
  assert.ok(blacklist.includes('自律的'), 'blacklist must include 自律的 (self-discipline framework)');
});

test('E3 deep_signal_detector has Haiku A4 trigger + handoff template (Vivi 6/6 wording)', () => {
  const deep = ENGINE_3_SUB_ROUTERS.find(d => d.id === 'E3_deep_signal_detector');
  assert.equal(deep.haiku_judge_used, 'A4_depth_signal');
  assert.match(deep.prompt_content, /handoff_escalation/);
  // 6/6 wording-revised: 1925 framing + Taiwan + fallback (NOT legacy「不繼續往前推」).
  assert.match(deep.prompt_content, /1925/);
  assert.match(deep.prompt_content, /不急著往下走/);
  assert.match(deep.prompt_content, /如果你不在台灣,請搜尋你所在地的緊急專線/);
});

test('E3 top1_judge uses Haiku A5 containment_logic (PR-23s4b rename)', () => {
  const top1 = ENGINE_3_SUB_ROUTERS.find(d => d.id === 'E3_top1_judge');
  assert.equal(top1.haiku_judge_used, 'A5_containment_logic');
  assert.match(top1.prompt_content, /存在依賴/);
  assert.match(top1.prompt_content, /Linear Thinking Error/);
});

test('E4 day_opening declares 5 variants (5/24: V1-V5 renamed to A/A-short/B-safe/A+gap*)', () => {
  const dayOpen = ENGINE_4_COMPONENTS.day_opening;
  assert.equal(dayOpen.variants.length, 5);
  for (const v of ['A', 'A-short', 'B-safe', 'A+gap3to7', 'A+gap8+']) {
    assert.ok(dayOpen.variants.includes(v), `missing variant: ${v}`);
  }
});

// 🛑 PR-4c-green 5/24 — Patrick 真機 A001/A002 fix. The inject's prescriptive
// rules + ✓/✗ examples are the LAST line of defense against冷-opener / fabrication.
test('🛑 E4 day_opening: 鐵則 + 模式 A/B framework explicit (Patrick 5/24)', () => {
  const c = ENGINE_4_COMPONENTS.day_opening.prompt_content;
  // 鐵則 block must announce itself + cover the 4 hard rules.
  assert.match(c, /⚠️ 鐵則/);
  assert.match(c, /有真實素材時/);
  assert.match(c, /絕對不杜撰/);
  // Mode framework.
  assert.match(c, /【模式 A — 用 takeaway「意思」接住、再邀請】/);
  assert.match(c, /【模式 B — 沒素材時的安全暖開場】/);
  // ✓/✗ examples must be present (concrete examples shape Sonnet output).
  assert.match(c, /✓ 範例 A-1/);
  assert.match(c, /✗ 範例/);
  // A001/A002 災難 explicitly called out.
  assert.match(c, /鑽石/);
});

test('🛑 E4 day_opening: explicit ban on cold-opener question in cross-day turn', () => {
  // The inject must name the cold-opener category as forbidden (without
  // quoting it verbatim — mimicry risk).
  const c = ENGINE_4_COMPONENTS.day_opening.prompt_content;
  // The「✗」 examples should mention this antipattern by name.
  assert.match(c, /忽略昨天/, 'must call out「ignore yesterday」 antipattern');
  assert.match(c, /冷起手式/, 'must name 冷起手式 explicitly as forbidden in cross-day turn');
});

test('🛑 E4 day_opening: no-fabrication rule across both modes', () => {
  const c = ENGINE_4_COMPONENTS.day_opening.prompt_content;
  // Mode B (no material) → no fabrication
  assert.match(c, /絕對不杜撰/);
  // ✗ example showing what fabrication looks like
  assert.match(c, /學員根本沒說過|杜撰/);
});

test('🛑 E4 day_opening: inputs_from_state lists the takeaway sources buildDynamicContext now surfaces', () => {
  const inputs = ENGINE_4_COMPONENTS.day_opening.inputs_from_state || [];
  assert.ok(inputs.includes('user_profile_evolution.last_session_day_summary.last_takeaway_term'),
    'last_takeaway_term must be declared as input');
  assert.ok(inputs.includes('user_profile_evolution.daily_takeaways'),
    'daily_takeaways must be declared as input');
});

test('E4 export prompt includes 3-段 Markdown structure', () => {
  const exp = ENGINE_4_COMPONENTS.export;
  assert.match(exp.prompt_content, /第一段:你是誰/);
  assert.match(exp.prompt_content, /第二段:對 AI 教練的引導風格指引/);
  assert.match(exp.prompt_content, /第三段:使用說明/);
  // Damon-style guidance in section 2
  assert.match(exp.prompt_content, /不要問我「為什麼」/);
});

// ─────────────────────────────────────────────────────────
// All 9 user_turn detectors register without conflict (E1 + E3 7 routers + E2)
// PR-23s4c: +integration-router +future-pacing-router (DIRECTLY_REGISTERED list).
// (passive-hope-cascade registers via ALL_DETECTORS path, not directly_registered.)
// ─────────────────────────────────────────────────────────

test('🛑 all 9 user_turn detectors register together + listForEvent returns in priority order (PR-23s4c)', () => {
  const r = new DetectorRegistry({ logger: () => {} });
  for (const det of DIRECTLY_REGISTERED_DETECTORS) {
    r.register({ ...det, handler: async () => ({ handled: false }) });
  }
  const userTurnList = r.listForEvent('user_turn');
  assert.equal(userTurnList.length, 9);   // PR-23s4c: +2 sub-routers
  // Verify priority order strictly ascending
  for (let i = 1; i < userTurnList.length; i++) {
    assert.ok(userTurnList[i].priority > userTurnList[i - 1].priority,
      `order broken at idx ${i}: ${JSON.stringify(userTurnList[i - 1])} → ${JSON.stringify(userTurnList[i])}`);
  }
  // First in order = E1 (lowest priority number = highest priority)
  assert.equal(userTurnList[0].id, 'E1_deviation_master_detector');
  // Last = E2
  assert.equal(userTurnList[userTurnList.length - 1].id, 'E2_identity_test_master_detector');
});
