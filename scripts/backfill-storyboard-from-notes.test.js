// scripts/backfill-storyboard-from-notes.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseArgs, runOneStudentFromNotes, formatFromNotesReport,
} from './backfill-storyboard-from-notes.js';

const GEN = {
  meta: { noteCount: 16, totalDropped: 215, totalSents: 833 },
  incongruence_probe: { detected: true, summary: '重視忠誠卻處於第三者位置。' },
  steps: {
    1: { phase:'early', brain_state:'大腦1', resistance:'阻力1', benevolent_intent:'動機1', sovereign_action:null },
    6: { phase:'climax', brain_state:'大腦6', resistance:null, benevolent_intent:null, sovereign_action:'宣告6。我說了算。' },
    7: { phase:'climax', brain_state:'大腦7', resistance:null, benevolent_intent:null, sovereign_action:'宣告7。我說了算。' },
  },
};

function mockDeps({ commit, step = 6 }) {
  const writes = [];
  return {
    deps: {
      loadStep: async () => step,
      pullNotes: async () => [{ week:1, day:1, note_text:'x。', is_week_summary:false }],
      generate: async () => GEN,
      write: async (id, sb) => writes.push({ id, sb }),
      commit, log: () => {},
    },
    writes,
  };
}

test('🛑 runOneStudentFromNotes: commit writes new-shape sc_storyboard, cap by currentStep', async () => {
  const { deps, writes } = mockDeps({ commit: true, step: 6 });
  const res = await runOneStudentFromNotes('A006', deps);
  assert.equal(writes.length, 1, 'commit → 1 write');
  const sb = writes[0].sb;
  // step1 filled w/ new fields
  assert.equal(sb.step_1.state, 'filled');
  assert.equal(sb.step_1.brain_state.description, '大腦1');
  assert.equal(sb.step_1.resistance, '阻力1');
  assert.equal(sb.step_1.benevolent_intent, '動機1');
  // step6 sovereign
  assert.equal(sb.step_6.sovereign_action, '宣告6。我說了算。');
  // step7 > currentStep(6) → empty (progress gate) even though gen has it
  assert.equal(sb.step_7.state, 'empty');
  assert.equal(res.filled, 2); // steps 1 + 6
});

test('🛑 runOneStudentFromNotes: dryRun does NOT write', async () => {
  const { deps, writes } = mockDeps({ commit: false });
  await runOneStudentFromNotes('A006', deps);
  assert.equal(writes.length, 0);
});

test('🛑 formatFromNotesReport: safe (probe + per-step, no raw notes), phase-aware sections', async () => {
  const { deps } = mockDeps({ commit: false });
  const res = await runOneStudentFromNotes('A006', deps);
  const rep = formatFromNotesReport(res);
  assert.match(rep, /內在不一致探針:有/);
  assert.match(rep, /可能阻力:阻力1/);   // early step
  assert.match(rep, /良善動機:動機1/);
  assert.match(rep, /主權宣告:宣告6/);    // climax step
  assert.equal(/note_text|x。/.test(rep), false, 'no raw note text in report');
  // 未套 cap 原始生成行:步7 其實生得出來 (腦✓+權✓), 但被 cap=6 擋掉 → sb 裡 Step 7 empty.
  assert.match(rep, /原始生成\(未套 cap\)/);
  assert.match(rep, /步7:腦✓\+權✓/, '原始生成第7步有料 (腦+權)');
  assert.match(rep, /\*\*Step 7 新的身分\*\* \(empty\)/, '套 cap 後第7步 empty (被擋)');
});

test('🛑 parseArgs: students / commit / model', () => {
  const a = parseArgs(['node','s','--students=A006 A003','--commit','--model=m']);
  assert.deepEqual(a.students, ['A006','A003']);
  assert.equal(a.commit, true);
  assert.equal(a.model, 'm');
  const b = parseArgs(['node','s','--student=A006']);
  assert.deepEqual(b.students, ['A006']);
  assert.equal(b.commit, false);
});
