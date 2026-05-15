// lib/tool2/tool2-prompt.js
// v4.0 工具二 prompt render layer
//
// 設計原則（兩檔架構）：
// - 本檔只負責「依 module + week + day 組 prompt 字串」
// - 教練學意圖 / §10.6 / v3.2b → v4 變更摘要 等開發註解全留在 tool2-data.js
// - chat.js 只 import 本檔的 buildTool2Section、絕對不 import tool2-data.js
//
// 對齊：v4.0 Advisor Code Prompt Phase 2

import { SELF_SENTENCES, MONEY_SENTENCES, RELATIONSHIP_SENTENCES } from './tool2-data.js';

const POOL_TABLE = {
  self: SELF_SENTENCES,
  money: MONEY_SENTENCES,
  relationship: RELATIONSHIP_SENTENCES,
};

function getAvailablePools(week, day) {
  if (week === 1) {
    if (day <= 2) return ['2A'];
    if (day <= 4) return ['2A', '2B'];
    return ['2A'];
  }
  if (week === 2) return ['2C'];
  return [];
}

function render2A(p) {
  return `【2A 池｜${p.label}】
句式（學員挑一句最像自己的）：
${p.sentences.map(s => `  ・${s}`).join('\n')}

流程：
  ① 學員選 → confirm：「${p.confirm_script}」
  ② confirm 完 → evidence：「${p.evidence_script}」
     （AI 把學員說的具體事件存進 Damon Note【Scope 證據】、Week 3 Day 3 直接調用）
  ③ 進觸發 #3：「${p.trigger_script}」`;
}

function render2B(p, week) {
  const head = `【2B 池｜${p.label}】
句式：
${p.sentences.map(s => `  ・${s}`).join('\n')}`;

  if (week === 1) {
    const s = p.week1_script;
    return `${head}

Week 1 採集版（觸發 #5、4 步、停在第④、不賦予新角色）：
  ① ${s.step1}
  ② ${s.step2}
  ③ ${s.step3}
  ④ ${s.step4}

⚠️ Week 1 停在第④步——語錄還沒挖出來、阻力對象不清晰。
   打字錨定的儀式感留給 Week 2 Day 3。`;
  }

  return `${head}

Week 2 Day 3 整合版：見【賦予新角色四步驟】完整段落
要求：${p.week2_day3_script.requires_typing}`;
}

function render2C(p, day) {
  const lines = [`【2C 池｜${p.label}】`,
                 `句式：\n${p.sentences.map(s => `  ・${s}`).join('\n')}`,
                 `\n流程（觸發 #6 Step1 回收 + Step2 問來源）：「${p.trigger_script}」`];
  if (day === 2) lines.push(`\n⚠️ Day 2 守則：${p.day2_rule}`);
  if (day === 4) {
    lines.push(`\nDay 4 Step3（反例提問、前提：Day 3 賦予新角色已完成）：
「這句話、永遠都是真的嗎？有沒有任何時候、哪怕一次、你不是這樣？」`);
  }
  return lines.join('\n');
}

export function buildTool2Section(module, week, day) {
  const pools = getAvailablePools(week, day);
  if (pools.length === 0) {
    return `\n\n# 今天不主動使用工具二
（Week 3 是整合週、用 Week 1 的 2A 詞 + Week 2 的 2C 信念溯源結果、在 Damon Note。）`;
  }
  const src = POOL_TABLE[module];
  const sections = [];
  for (const k of pools) {
    if (k === '2A') sections.push(render2A(src['2A']));
    if (k === '2B') sections.push(render2B(src['2B'], week));
    if (k === '2C') sections.push(render2C(src['2C'], day));
  }
  return `\n\n# 今天可用的工具二池\n\n${sections.join('\n\n')}`;
}
