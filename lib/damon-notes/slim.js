// lib/damon-notes/slim.js
// Rolling 7-day + key-field extraction、cap yesterdayNote ~2K tokens
// 對齊：v4.0 Advisor Phase 4
//
// 設計：
// - 不是把整個 Damon Note 灌進 system prompt（跨 9 週後會炸 8-15K tokens）
// - 只抽幾個 always-needed 欄位 + 依 (week, day) gated 的 conditional 欄位
// - 跨週 summary（is_week_summary=true）在前、本週 daily 在後
// - feature flag DAMON_NOTE_SLIM 控制：ON 用本檔、OFF 走 legacy fallback
//
// ⚠️ KEY_FIELDS 命名跟 generateDamonNote prompt 的【欄位名】嚴格對齊（Phase 5.0c 才實際定）。
//    名字對不上 → extractFields 撈不到 → formatNote 跳過、不會壞、但欄位內容會 silently miss。

const KEY_FIELDS_ALWAYS = ['關鍵句', 'SC 觀察', '還沒碰到的'];

const KEY_FIELDS_CONDITIONAL = {
  'Scope 證據':            (week, day) => week === 3 && day >= 3,
  '賦予新角色狀態':         (week, day) => (week === 2 && day >= 4) || week === 3,
  '確定類別 + Scope':       (week, day) => week === 3 && day >= 3,
  'Transfer 結果':         (week, day) => week === 3 && day >= 4,
  '微證據 + 反例預演結果':   (week, day) => week === 3 && day >= 5,
  '宣言':                  (week, day) => week === 3 && day === 6,
};

// v4.0 Phase 4 spot-check 抓到 bug：Advisor 原 code 把 field name 直接內插進 regex、
// 含 regex meta 字元的欄位名（如「微證據 + 反例預演結果」「確定類別 + Scope」、
// `+` 是 regex 量詞）會 silently miss。Escape 後欄位名才當字面字串 match。
function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function extractFields(noteText, fields) {
  const out = {};
  for (const field of fields) {
    const re = new RegExp(`【${escapeRe(field)}】\\s*\\n([\\s\\S]*?)(?=\\n【|$)`, 'm');
    const m = noteText.match(re);
    if (m && m[1].trim()) out[field] = m[1].trim();
  }
  return out;
}

function formatNote(dayInfo, fields) {
  const lines = [`【${dayInfo}】`];
  for (const [k, v] of Object.entries(fields)) {
    if (v) lines.push(`【${k}】\n${v}`);
  }
  return lines.join('\n');
}

export function buildSlimDamonContext(recentNotes, currentWeek, currentDay) {
  if (!recentNotes || recentNotes.length === 0) return '';

  const conditionalFields = Object.entries(KEY_FIELDS_CONDITIONAL)
    .filter(([_, gate]) => gate(currentWeek, currentDay))
    .map(([field]) => field);
  const allFields = [...KEY_FIELDS_ALWAYS, ...conditionalFields];

  const weekSummaries = [];
  const thisWeekDailies = [];

  for (const note of recentNotes) {
    if (note.isWeekSummary) {
      if (note.week !== currentWeek) weekSummaries.push(note);
    } else {
      if (note.week === currentWeek) thisWeekDailies.push(note);
    }
  }

  const sections = [];

  for (const ws of weekSummaries) {
    sections.push(formatNote(
      `${ws.module} Week ${ws.week} 摘要`,
      extractFields(ws.noteText, allFields)
    ));
  }

  const recentDailies = thisWeekDailies.slice(-7);
  for (const d of recentDailies) {
    sections.push(formatNote(
      `本週 Day ${d.day}`,
      extractFields(d.noteText, allFields)
    ));
  }

  if (sections.length === 0) return '';

  return `\n\n# 之前的觀察（Damon Notes 累積，僅供你參考脈絡，不要對學員複述）
最新的在最下面。觀察學員反覆出現的詞、卡住的地方、走到哪一層。

${sections.join('\n\n---\n\n')}`;
}
