// scripts/regen-notebook-page.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseArgs, regenOneStudent, formatRegenReport } from './regen-notebook-page.js';

test('parseArgs: default scope = A025, module=self, dry-run', () => {
  const a = parseArgs(['node', 's']);
  assert.deepEqual(a.students, ['A025']);
  assert.equal(a.module, 'self');
  assert.equal(a.commit, false);
});

test('parseArgs: --students / --module / --commit / --report', () => {
  const a = parseArgs(['node', 's', '--students=A025 A019', '--module=self', '--commit', '--report=r.md']);
  assert.deepEqual(a.students, ['A025', 'A019']);
  assert.equal(a.commit, true);
  assert.equal(a.report, 'r.md');
});

function mkDeps(overrides = {}) {
  const calls = { regen: [] };
  const deps = {
    module: 'self',
    commit: false,
    deriveWasCrisis: (st) => st && st.crisis === true,
    listSessions: async () => [
      { sessionId: 's1', day: 1, fullNote: 'X'.repeat(500), sessionState: { crisis: false } },
      { sessionId: 's2', day: 2, fullNote: 'Y'.repeat(600), sessionState: { crisis: true } },
    ],
    loadStudentMeta: async () => ({ preferredName: null, activeContextName: '自由', activeContextDefinition: null }),
    loadYesterdayHypothesis: async () => null,
    regen: async (args) => { calls.regen.push(args); return '新卡'.repeat(40); },
    log: () => {},
    ...overrides,
  };
  return { deps, calls };
}

test('🛑 dry-run: 不呼叫 regen (不寫 DB), 只列 meta + 帶出 wasCrisis', async () => {
  const { deps, calls } = mkDeps({ commit: false });
  const res = await regenOneStudent('A025', deps);
  assert.equal(calls.regen.length, 0, 'dry-run 不可呼叫 regen/寫 DB');
  assert.equal(res.days.length, 2);
  assert.equal(res.days[0].wasCrisis, false);
  assert.equal(res.days[1].wasCrisis, true);
  assert.equal(res.days[0].committed, false);
});

test('🛑 commit: 每個 finalized day 呼叫 regen; wasCrisis 正確傳入 generateNotebookPage', async () => {
  const { deps, calls } = mkDeps({ commit: true });
  const res = await regenOneStudent('A025', deps);
  assert.equal(calls.regen.length, 2);
  // Day 1 非 crisis → sharp; Day 2 crisis → gentle. wasCrisis 必須正確分流。
  assert.equal(calls.regen[0].wasCrisis, false);
  assert.equal(calls.regen[1].wasCrisis, true);
  // 只覆寫前端卡:fullNote 沿用既有後端筆記、不重生後端。
  assert.equal(calls.regen[0].fullNote.length, 500);
  assert.equal(res.days[0].committed, true);
});

test('🛑 skip: 沒有後端筆記的 day → 不呼叫 regen (skipped)', async () => {
  const { deps, calls } = mkDeps({
    commit: true,
    listSessions: async () => [{ sessionId: 's1', day: 1, fullNote: '', sessionState: {} }],
  });
  const res = await regenOneStudent('A025', deps);
  assert.equal(calls.regen.length, 0);
  assert.equal(res.days[0].skipped, 'no-backend-note');
});

test('🛑 report: meta only — 不含後端筆記 / 卡內容 (鐵律 #2)', async () => {
  const { deps } = mkDeps({ commit: true });
  const res = await regenOneStudent('A025', deps);
  const rep = formatRegenReport(res);
  assert.match(rep, /A025 · self/);
  assert.match(rep, /wasCrisis=false/);
  assert.match(rep, /wasCrisis=true/);
  // 報告只有長度數字、無原始內容。
  assert.equal(/XXXXX/.test(rep), false);
  assert.equal(/新卡新卡/.test(rep), false);
});
