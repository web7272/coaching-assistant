// lib/prompt-sections/reverse-examples.js
// Conditional reverse-example dispatcher
// 對齊：v4.0 Advisor Phase 3
//
// 設計：
// - 4 個 regex trigger：emotion_state / desire_abstract / body_resistance / metaphor_confusion
// - 規則：學員最新訊息命中 trigger、把對應反例段落注入 system prompt（最高優先）
// - 註：trigger 命中 != AI 一定錯、是 attention nudge、強化 A001 累積的「應走主路徑」紀律
// - dispatcher 同時 return triggers_hit 名單、寫進 chat_usage_log 跟 prompt_engineering_misses
//
// chat.js 只 import getConditionalReverseExamples、feature flag CONDITIONAL_REVERSE_EXAMPLES 控制是否注入

import {
  EMOTION_STATE_REVERSE,
  DESIRE_ABSTRACT_REVERSE,
  RESISTANCE_HANDLER,
  METAPHOR_PATH_SIMPLIFY,
} from './reverse-examples-text.js';

const TRIGGERS = [
  {
    name: 'emotion_state',
    re: /茫然|迷茫|迷失方向|空虛|空空|空白|卡住|卡關|卡點|過不去|無力|沒力|孤單|孤獨|寂寞|無感|麻木|沒.{0,2}感覺|困惑|搞不清楚|不對勁/,
    text: EMOTION_STATE_REVERSE,
  },
  {
    name: 'desire_abstract',
    re: /自由|被看見|被理解|被肯定|安全感|穩定|成功|成就|幸福|快樂|滿足|被愛|被需要|連結|親密|真實|做自己|平靜|寧靜|很多錢|更多錢|財富自由|豐盛/,
    text: DESIRE_ABSTRACT_REVERSE,
  },
  {
    name: 'body_resistance',
    re: /不知道耶|說不上來|肩膀當然|沒.{0,2}什麼感覺|不太懂.{0,3}身體|身體哪裡是什麼意思|這要怎麼回答/,
    text: RESISTANCE_HANDLER,
  },
  {
    name: 'metaphor_confusion',
    re: /什麼姿勢|站著|中文嗎|看不懂|什麼意思\?|這(?:句|個)問句/,
    text: METAPHOR_PATH_SIMPLIFY,
  },
];

export function getConditionalReverseExamples(latestUserMessage) {
  if (!latestUserMessage) return { text: '', hits: [] };
  const hits = TRIGGERS.filter(t => t.re.test(latestUserMessage));
  if (hits.length === 0) return { text: '', hits: [] };
  const text = '\n\n# 本輪特別注意（trigger 命中、最高優先）\n\n' +
               hits.map(h => h.text).join('\n\n');
  return { text, hits: hits.map(h => h.name) };
}
