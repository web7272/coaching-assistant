// lib/prompt-sections/conditional/day1-mirror-inject.test.js
// Day-1 照鏡 inject gate + 內容鎖 (fable 6/26 Q3 · Vivi 核准).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DAY1_MIRROR_INJECT, buildDay1MirrorInject } from './day1-mirror-inject.js';

test('🛑 gate: sessionDay===1 && plan==="trial" → 回 inject', () => {
  assert.equal(buildDay1MirrorInject({ sessionDay: 1, plan: 'trial' }), DAY1_MIRROR_INJECT);
  assert.equal(buildDay1MirrorInject({ sessionDay: '1', plan: 'trial' }), DAY1_MIRROR_INJECT);
});

test('🛑 gate: 非 Day1 或 非 trial → null (0 副作用)', () => {
  assert.equal(buildDay1MirrorInject({ sessionDay: 2, plan: 'trial' }), null);
  assert.equal(buildDay1MirrorInject({ sessionDay: 1, plan: 'paid' }), null);
  assert.equal(buildDay1MirrorInject({ sessionDay: 1 }), null);
  assert.equal(buildDay1MirrorInject({}), null);
  assert.equal(buildDay1MirrorInject(), null);
});

test('🛑 內容:五層撥開手法 + self-limiting + 不替學員總結 + 危機優先', () => {
  const t = DAY1_MIRROR_INJECT;
  assert.match(t, /原話排列照鏡/);
  assert.match(t, /你看到了嗎/);
  assert.match(t, /每場最多一次/);
  assert.match(t, /不得是 AI 發明的標籤或診斷詞/);       // 不替學員定義 (守紅線)
  assert.match(t, /先承認、再挑戰/);
  assert.match(t, /紅線 20/);                              // 碰危機即放棄
  assert.match(t, /否認或修正:接受他的版本/);            // 不辯論
});
