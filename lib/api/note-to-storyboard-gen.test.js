// lib/api/note-to-storyboard-gen.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  preScrubNote, preScrubNotes, gateText, gateSovereign,
  endsWithSelfControl, pointsAtSelf, parseJsonLoose,
  generateStoryboardFromNotes, EARLY_STEPS, CLIMAX_STEPS, SOVEREIGN_RETRY_MAX,
  buildScStoryboardFromGen,
  regenStoryboardFromNotes,
} from './note-to-storyboard-gen.js';

// ── pure helpers ──
test('🛑 preScrubNote drops SI sentence, keeps safe', () => {
  const r = preScrubNote('我從小就在照顧家人。有時候我覺得不想活了。我會主動倒水。');
  assert.equal(/不想活/.test(r.safe), false);
  assert.match(r.safe, /照顧家人/);
  assert.equal(r.dropped, 1);
  assert.equal(r.total, 3);
});

test('🛑 preScrubNotes builds blocks + meta + counts', () => {
  const out = preScrubNotes([
    { week: 1, day: 1, note_text: '你很努力。想死的念頭。', is_week_summary: false },
    { week: 1, day: 2, note_text: '你看見了自己。', is_week_summary: true },
  ]);
  assert.equal(/想死/.test(out.notesText), false);
  assert.match(out.notesText, /W1D1/);
  assert.match(out.notesText, /週結/);
  assert.equal(out.totalDropped, 1);
});

test('🛑 gateText: SI blocked, clean passes', () => {
  assert.equal(gateText('你想死的時候').ok, false);
  assert.equal(gateText('你正在慢慢看見自己一直都有照顧人的能力。').ok, true);
});

test('🛑 gateSovereign: needs declaration + no rigidity + no SI', () => {
  assert.equal(gateSovereign('你要拿回主權。').ok, false, 'missing declaration');
  assert.equal(gateSovereign('那個貶低你的舊聲音不是你。停。拿回開關。我說了算。').ok, true);
  assert.equal(gateSovereign('你不夠好，你錯了。我說了算。').ok, false, 'rigidity-at-self');
  assert.equal(gateSovereign('去死吧。我說了算。').ok, false, 'SI');
});

test('🛑 endsWithSelfControl / pointsAtSelf', () => {
  assert.equal(endsWithSelfControl('……主導權在我'), true);
  assert.equal(endsWithSelfControl('……拿回來'), false);
  assert.equal(pointsAtSelf('你不夠'), true);
  assert.equal(pointsAtSelf('你錯了'), true);
  assert.equal(pointsAtSelf('那個貶低你的舊聲音'), false); // abstract — clean
});

test('🛑 parseJsonLoose tolerates surrounding text', () => {
  assert.deepEqual(parseJsonLoose('hi {"a":1} bye'), { a: 1 });
  assert.equal(parseJsonLoose('no json'), null);
});

// ── orchestrator (mock LLM) ──
const SYNTH = JSON.stringify({
  incongruence_probe: { detected: true, summary: '重視忠誠卻處於第三者位置，行為與渴望相悖。' },
  step_1: { brain_state: '你帶著一個方程式：被需要才存在。', resistance: '有一個聲音說：沒人需要我我就什麼都不是。', benevolent_intent: '它保護你不必直視那個空。' },
  step_2: { brain_state: '你其實很清楚自己想要被堅定選擇。', resistance: '有個聲音說：別去想那個渴望太痛。', benevolent_intent: '它幫你把門關上免於再次落空。' },
  step_3: { brain_state: '數據就在你說過的話裡。', resistance: '有個聲音說：那些不算數。', benevolent_intent: '它守護你的精確，怕你再期待再失去。' },
  step_4: { brain_state: '你是照顧人的人，不只在她面前。', resistance: '有個聲音說：我還在當第三者，這標籤配不上我。', benevolent_intent: '它守護你的一致性，提醒你身份與所在還有距離。' },
  step_5: { brain_state: '你的雷達一直都在。', resistance: '有個聲音說：要她選你才算數。', benevolent_intent: '它要你得到真正夠分量的愛，只是方向找錯。' },
  // step_6 sovereign intentionally rigidity-at-self → forces retry
  step_6: { brain_state: '對方的選擇不是你的計分板。', sovereign: '你就是不夠好才會這樣，你錯了。我說了算。' },
  step_7: { brain_state: '那個喜歡是先在你裡面的。', sovereign: '每天找一個真實瞬間存進來。被需要很好，但你的存在不是別人需要你才開始。我說了算。' },
});

function makeMock({ retryText }) {
  let synthCalls = 0, retryCalls = 0;
  const fn = async (_client, payload) => {
    if (payload.system.includes('只為這一個步驟')) {
      retryCalls++;
      return { ok: true, data: { content: [{ text: retryText }] } };
    }
    synthCalls++;
    return { ok: true, data: { content: [{ text: SYNTH }] } };
  };
  return { fn, calls: () => ({ synthCalls, retryCalls }) };
}

test('🛑 orchestrator: phase structure (1-5 early w/ resistance+intent; 6-7 climax w/ sovereign)', async () => {
  const m = makeMock({ retryText: '那個貶低你的舊聲音不是你。你的價值不由她決定。拿回開關。我說了算。' });
  const out = await generateStoryboardFromNotes({
    notes: [{ week: 1, day: 1, note_text: '你很努力地照顧人。', is_week_summary: false }],
    anthropic: {}, callAnthropicWithRetry: m.fn, model: 'x',
  });
  for (const n of EARLY_STEPS) {
    assert.equal(out.steps[n].phase, 'early');
    assert.ok(out.steps[n].brain_state, `step${n} brain`);
    assert.ok(out.steps[n].resistance, `step${n} resistance`);
    assert.ok(out.steps[n].benevolent_intent, `step${n} intent`);
    assert.equal(out.steps[n].sovereign_action, null);
  }
  for (const n of CLIMAX_STEPS) {
    assert.equal(out.steps[n].phase, 'climax');
    assert.ok(out.steps[n].brain_state, `step${n} brain`);
    assert.equal(out.steps[n].resistance, null);
  }
});

test('🛑 orchestrator: step6 rigidity sovereign → retry fixes it (filled, attempts=2)', async () => {
  const m = makeMock({ retryText: '那個貶低你的舊聲音不是你。你的價值不由她決定。拿回開關。我說了算。' });
  const out = await generateStoryboardFromNotes({
    notes: [{ week: 1, day: 1, note_text: '你很努力。', is_week_summary: false }],
    anthropic: {}, callAnthropicWithRetry: m.fn, model: 'x',
  });
  assert.ok(out.steps[6].sovereign_action, 'step6 sovereign filled after retry');
  assert.equal(out.steps[6].sovereign_attempts, 2);
  assert.equal(out.steps[7].sovereign_action !== null, true, 'step7 good on first pass');
  assert.equal(out.steps[7].sovereign_attempts, 1);
});

test('🛑 orchestrator: retry all-fail → sovereign null (no leak, attempts capped)', async () => {
  // retry text still rigidity → never passes
  const m = makeMock({ retryText: '你不夠好。我說了算。' });
  const out = await generateStoryboardFromNotes({
    notes: [{ week: 1, day: 1, note_text: '你很努力。', is_week_summary: false }],
    anthropic: {}, callAnthropicWithRetry: m.fn, model: 'x',
  });
  assert.equal(out.steps[6].sovereign_action, null);
  assert.equal(out.steps[6].sovereign_attempts, SOVEREIGN_RETRY_MAX);
  assert.equal(out.steps[6].sovereign_reason, 'rigidity-at-self');
});

test('🛑 orchestrator: probe parsed + gated', async () => {
  const m = makeMock({ retryText: '正面語。我說了算。' });
  const out = await generateStoryboardFromNotes({
    notes: [{ week: 1, day: 1, note_text: '你很努力。', is_week_summary: false }],
    anthropic: {}, callAnthropicWithRetry: m.fn, model: 'x',
  });
  assert.equal(out.incongruence_probe.detected, true);
  assert.match(out.incongruence_probe.summary, /忠誠/);
});

test('🛑 orchestrator: no anthropic → empty (fail-soft)', async () => {
  const out = await generateStoryboardFromNotes({ notes: [{ week:1, day:1, note_text:'x。' }] });
  assert.deepEqual(out.steps, {});
  assert.equal(out.incongruence_probe.detected, false);
});

test('🛑 orchestrator: empty notes after pre-scrub → empty', async () => {
  const m = makeMock({ retryText: 'x。我說了算。' });
  const out = await generateStoryboardFromNotes({
    notes: [{ week:1, day:1, note_text:'想死。去死。' }],
    anthropic: {}, callAnthropicWithRetry: m.fn, model: 'x',
  });
  assert.deepEqual(out.steps, {});
});

// ── buildScStoryboardFromGen ──
test('🛑 buildScStoryboardFromGen: shape + currentStep gate + new fields + endpoint round-trip', () => {
  const gen = {
    1: { phase:'early', brain_state:'大腦1', resistance:'阻力1', benevolent_intent:'動機1', sovereign_action:null },
    2: { phase:'early', brain_state:'大腦2', resistance:'阻力2', benevolent_intent:'動機2', sovereign_action:null },
    6: { phase:'climax', brain_state:'大腦6', resistance:null, benevolent_intent:null, sovereign_action:'宣告6。我說了算。' },
    7: { phase:'climax', brain_state:'大腦7', resistance:null, benevolent_intent:null, sovereign_action:'宣告7。我說了算。' },
  };
  const sb = buildScStoryboardFromGen(gen, 6); // currentStep = 6
  // early step filled w/ new fields, brain_state wrapped {description, quote:null}
  assert.equal(sb.step_1.state, 'filled');
  assert.equal(sb.step_1.brain_state.description, '大腦1');
  assert.equal(sb.step_1.brain_state.quote, null);
  assert.equal(sb.step_1.resistance, '阻力1');
  assert.equal(sb.step_1.benevolent_intent, '動機1');
  assert.equal(sb.step_1.sovereign_action, null);
  // climax step filled w/ sovereign, no resistance
  assert.equal(sb.step_6.sovereign_action, '宣告6。我說了算。');
  assert.equal(sb.step_6.resistance, null);
  // steps 3,4,5 no gen content → empty
  assert.equal(sb.step_3.state, 'empty');
  assert.equal(sb.step_3.brain_state, null);
  // step 7 > currentStep(6) → empty EVEN THOUGH gen has content (progress gate)
  assert.equal(sb.step_7.state, 'empty');
  // endpoint round-trip: read sb["step_N"].brain_state.description survives
  assert.equal(sb.step_1.brain_state.description, '大腦1');
  assert.equal(sb.step_6.brain_state.description, '大腦6');
});

test('🛑 buildScStoryboardFromGen: empty/null gen → all empty (no throw)', () => {
  const sb = buildScStoryboardFromGen({}, 7);
  for (let n=1;n<=7;n++) assert.equal(sb[`step_${n}`].state, 'empty');
  const sb2 = buildScStoryboardFromGen(null, 3);
  assert.equal(sb2.step_1.state, 'empty');
});

// ── regenStoryboardFromNotes (S6 finalize helper) ──
const SYNTH_FULL = JSON.stringify({
  incongruence_probe: { detected: true, summary: '重視忠誠卻處於第三者位置。' },
  step_1: { brain_state: '大腦1', resistance: '阻力1', benevolent_intent: '動機1' },
  step_6: { brain_state: '大腦6', sovereign: '拿回開關。我說了算。' },
});
function regenDeps({ writeThrows = false } = {}) {
  const writes = [];
  return {
    writes,
    pullNotes: async () => [{ week:1, day:1, note_text:'你很努力。', is_week_summary:false }],
    writeStoryboard: async (id, sb) => { if (writeThrows) throw new Error('db down'); writes.push({ id, sb }); },
    anthropic: {},
    callAnthropicWithRetry: async (_c, payload) => ({ ok: true, data: { content: [{ text: payload.system.includes('只為這一個步驟') ? '正面語。我說了算。' : SYNTH_FULL }] } }),
  };
}
test('🛑 S6 regenStoryboardFromNotes: writes new-shape sc_storyboard (filled>0), cap by currentStep', async () => {
  const d = regenDeps();
  const r = await regenStoryboardFromNotes({ studentId:'A006', currentStep:6, ...d, model:'x' });
  assert.equal(r.wrote, true);
  assert.equal(writeCount(d), 1);
  const sb = d.writes[0].sb;
  assert.equal(sb.step_1.state, 'filled');
  assert.equal(sb.step_1.resistance, '阻力1');
  assert.equal(sb.step_6.sovereign_action, '拿回開關。我說了算。');
  assert.equal(sb.step_7.state, 'empty'); // > currentStep 6
});

test('🛑 S6 regenStoryboardFromNotes: write throws → swallowed, wrote:false (never throws, keeps existing)', async () => {
  const d = regenDeps({ writeThrows: true });
  const r = await regenStoryboardFromNotes({ studentId:'A006', currentStep:6, ...d, model:'x' });
  assert.equal(r.wrote, false);
  assert.ok(r.error);
});

test('🛑 S6 regenStoryboardFromNotes: no anthropic → 0 filled → no write (keep existing)', async () => {
  const d = regenDeps();
  const r = await regenStoryboardFromNotes({ studentId:'A006', currentStep:6, pullNotes:d.pullNotes, writeStoryboard:d.writeStoryboard, model:'x' });
  assert.equal(r.wrote, false);
  assert.equal(writeCount(d), 0);
});

function writeCount(d){ return d.writes.length; }
