// lib/sub-prompts/future_pacing/care-less-list-optional.test.js
// v5.1 Step 7 PR-7b — Snapshot LOCK Care Less List Vivi 終審版逐字 (guard #2).
//
// 設計師端不改 phrasing. 任何更動本檔 snapshot → 需要 Vivi 重新 review 後才能 update.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import careLessList, {
  SEGMENT_1_INVITATION, SEGMENT_2_GUIDANCE_RAILS,
  SEGMENT_2B_SOFT_PROMPT, SEGMENT_3_CONFIRM, SEGMENT_4_CLOSING_EXTENSION,
} from './care-less-list-optional.js';

// ─── Vivi 終審版 snapshot lock — 逐字字符比對 ─────────────

test('🛑 SNAPSHOT LOCK — Segment 1 邀請開場 (Vivi 終審版逐字)', () => {
  assert.equal(SEGMENT_1_INVITATION, `我們做一個小小的整理、想做再做、不想做也完全沒關係。

你剛剛說、你想成為一個 {{TOP_1_QUALITY}} 的人。

那……有沒有什麼事、是你一直很用力在顧、很用力在意——
可是對現在的你來說、其實已經可以放鬆一點點、不用抓那麼緊了?`);
});

test('🛑 SNAPSHOT LOCK — Segment 2 critical 紅線 (Vivi 終審版 guidance rails)', () => {
  assert.equal(SEGMENT_2_GUIDANCE_RAILS, `引導 critical 紅線 (Vivi 終審版規則、Sonnet 必須遵守):

❌ 不能用「少 care」這三個字當開場 (亞洲女性聽到會內疚).
✅ 用「不用抓那麼緊」「可以放鬆一點」「把力氣留一些給自己」這種說法 —
   門檻低很多、不會踩到「妳變冷漠了」恐懼.

學員 surface 例子 (參考、Sonnet 不複誦):
  - 「我一直很在意別人怎麼看我——這個其實可以鬆一點」
  - 「我一直要做到 100% 才安心——這個可以放下一點」
  - 「我一直用別人的標準在衡量自己——這個可以慢慢放掉」`);
});

test('🛑 SNAPSHOT LOCK — Segment 2b 學員講不出來的輕引 (Vivi 終審版逐字)', () => {
  assert.equal(SEGMENT_2B_SOFT_PROMPT, `比如說、別人的眼光、別人的標準、要做到完美……
這裡面有沒有哪一個、你其實有點累了?

📌 等她自己說出那個詞、不要替她選`);
});

test('🛑 SNAPSHOT LOCK — Segment 3 第一段確認 (Vivi 終審版逐字)', () => {
  assert.equal(SEGMENT_3_CONFIRM, `好。那你想慢慢放鬆一點的、是 {{STUDENT_LISTED_ITEMS}}。

我想跟你說清楚一件事——
這不是叫你變得不在乎、更不是叫你變得冷漠。

你還是那個會在乎、會顧人的你。
我們只是把你一直往外借出去的那些力氣、慢慢收回來一點點、
留給你想成為的那個人。

少抓那一點點、不是失去什麼。
是還給自己。`);
});

test('🛑 SNAPSHOT LOCK — Segment 4 收尾延伸 (Vivi 終審版逐字、整段是落點)', () => {
  assert.equal(SEGMENT_4_CLOSING_EXTENSION, `還有一件事、我想特別跟你說。

你的體貼、你的善良——
這些不是要你放掉的東西。
它們是你最珍貴的優點、不是缺點。
這個世界需要更多像你這樣會在乎別人的人。

我們從頭到尾、沒有要你變得不體貼。

我們只是發現——
你一直在照顧一份名單、
名單上有家人、有同事、有朋友、
每一個你都顧到了。

只有一個人、你一直忘了寫上去。

就是你自己。

所以今天我們不是要你少體貼、是要你做一件事:
把你自己、也加進你那份體貼善良的名單裡。

你對別人那麼好——
從今天起、那個『別人』、也包含你。`);
});

// ─── Module shape ───────────────────────────────────────

test('🛑 Care Less List default export: id + token_estimate + state schema', () => {
  assert.equal(careLessList.id, 'future_pacing_care_less_list_optional');
  assert.equal(careLessList.token_estimate, 620);
  assert.equal(careLessList.type, 'conditional_inject');
  assert.ok(careLessList.parse_state_patch.affects.includes('session_state.care_less_list'));
  assert.ok(careLessList.parse_state_patch.affects.includes('session_state.self_added_to_list'));
});

test('🛑 Care Less List _vivi_terminal_segments: frozen + 5 segments', () => {
  const seg = careLessList._vivi_terminal_segments;
  assert.ok(Object.isFrozen(seg));
  // Note: JS .sort() string-compares — '2B' < '2_' lexicographically.
  assert.deepEqual(Object.keys(seg).sort(), [
    'SEGMENT_1_INVITATION', 'SEGMENT_2B_SOFT_PROMPT', 'SEGMENT_2_GUIDANCE_RAILS',
    'SEGMENT_3_CONFIRM', 'SEGMENT_4_CLOSING_EXTENSION',
  ]);
});

test('🛑 Care Less List prompt_content: contains all 5 segments verbatim', () => {
  for (const seg of [
    SEGMENT_1_INVITATION, SEGMENT_2_GUIDANCE_RAILS, SEGMENT_2B_SOFT_PROMPT,
    SEGMENT_3_CONFIRM, SEGMENT_4_CLOSING_EXTENSION,
  ]) {
    assert.ok(careLessList.prompt_content.includes(seg),
      'prompt_content must contain each segment verbatim');
  }
});

test('🛑 Care Less List: critical 設計原則 (expansion framing) is documented in prompt', () => {
  // Sanity: prompt_content contains the design principles.
  assert.match(careLessList.prompt_content, /把你自己、也加進你那份體貼善良的名單裡/);
  assert.match(careLessList.prompt_content, /不是失去.*是還給自己/s);
  // Negative — 不能用「少 care」 phrasing as opener.
  assert.match(careLessList.prompt_content, /❌ 不能用「少 care」/);
});

test('🛑 Care Less List: disable条件 includes crisis + student rejection', () => {
  assert.ok(careLessList.disable_conditions.includes('crisis mode active'));
  assert.ok(careLessList.disable_conditions.some(c => /我不想做|跳過/.test(c)));
});
