// api/storyboard-pdf-data.js
// GET /api/storyboard-pdf-data?module=self            (student audience)
// GET /api/storyboard-pdf-data?audience=coach&studentId=A001
//
// Patrick 6/26 — 「我的故事」PDF 的一次性唯讀資料源 (P1).
//   回傳 PDF 所需全部: 7 步 storyboard + 21 天進度 history + 結業見證信/宣言/poem
//   + 價值觀 + 每日身分解析卡(附錄)。
//
//   🔴 Day 21 結業 gate: 未結業 (沒 coach_letter / declaration) → { ready:false },
//      完全不吐故事內容。結業後才給完整資料。
//   🔴 student-safe: 每日卡走 safeNoteForStudent (sanitize);storyboard/見證信
//      本來就已過 sanitizer。不放 raw note / 體系術語 / PII。
//   🔴 純讀、fail-soft: 任何 sub-read 失敗 → 該段給空、不 500。

import { neon } from '@neondatabase/serverless';
import { guardStudentOr401 } from '../lib/auth/student-session.js';
import { guardCoachOr401 }   from '../lib/auth/coach-session.js';
import { getUserProfile }    from '../lib/state/state-manager.js';
import { buildScStoryboardSteps } from './sc-storyboard.js';
import { projectPoem21 }     from './graduation.js';
import { safeNoteForStudent } from '../lib/api/student-note-safe.js';

let _sql = null;
export function _setSqlClient(client) { _sql = client; }
function getSql() { if (_sql) return _sql; return neon(process.env.DATABASE_URL); }

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const module   = String(req.query?.module   || 'self').trim();
  const audience = String(req.query?.audience || 'student').toLowerCase();

  let studentId;
  if (audience === 'coach') {
    if (!(await guardCoachOr401(req, res))) return;
    studentId = String(req.query?.studentId || '').trim();
    if (!studentId) return res.status(400).json({ error: 'Missing required query: studentId' });
  } else {
    studentId = await guardStudentOr401(req, res);
    if (!studentId) return;
  }

  try {
    const profile = await getUserProfile(studentId);
    const grad = profile?.last_session_day_summary?.graduation || null;
    const coachLetter = grad?.coach_letter || null;
    const declaration = grad?.declaration  || null;

    // 🔴 Day 21 結業 gate — 未結業不給故事內容.
    if (!coachLetter && !declaration) {
      return res.status(200).json({ ready: false });
    }

    const sql = getSql();

    // students row: name + storyboard + evidence + 21 天 history
    let name = null, evidence = null, storyboard = null, history = null;
    try {
      const rows = await sql`
        SELECT preferred_name, sc_journey_evidence, sc_storyboard, sc_storyboard_history
          FROM students WHERE student_id = ${studentId} LIMIT 1
      `;
      if (rows.length > 0) {
        name       = rows[0].preferred_name        || null;
        evidence   = rows[0].sc_journey_evidence    ?? null;
        storyboard = rows[0].sc_storyboard          ?? null;
        history    = rows[0].sc_storyboard_history  ?? null;
      }
    } catch (e) {
      console.warn('[storyboard-pdf-data] students read fail-soft:', e?.message || e);
    }

    // 每日身分解析卡 (附錄) — 與學員那天看到的同序 (session_date ASC), 每張 sanitize.
    let dailyCards = [];
    try {
      const cardRows = await sql`
        SELECT notebook_page FROM sessions
         WHERE student_id = ${studentId} AND module = ${module}
           AND notebook_page IS NOT NULL
         ORDER BY session_date ASC
      `;
      dailyCards = cardRows.map((r, i) => ({
        day: i + 1,
        card: safeNoteForStudent(r.notebook_page, { observe: () => {} }),
      }));
    } catch (e) {
      console.warn('[storyboard-pdf-data] daily cards fail-soft:', e?.message || e);
    }

    return res.status(200).json({
      ready: true,
      name,
      storyboard: buildScStoryboardSteps(evidence, storyboard),
      history: history || {},
      graduation: { coachLetter, declaration, poem21: projectPoem21(profile?.daily_takeaways) },
      values: { top1: profile?.top1_value ?? null, ranking: profile?.values_ranking ?? [] },
      dailyCards,
    });
  } catch (e) {
    console.error('[storyboard-pdf-data] error:', e?.message || e);
    return res.status(500).json({ error: 'Server error' });
  }
}
