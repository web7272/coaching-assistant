// api/auth/email-login.js
// POST /api/auth/email-login   body: { email }
// Per docs/v5-spec/engineering/07-pr4c §3-G — 封閉測試專用 (無 ID、無密碼、email 即身分).
//
// Response: { studentId, module, currentDay }
//
// ⚠️ 測試期專用。正式版認證 UI 階段再做（Vivi 已交代先記下）。
// 不要把這個 endpoint 當生產驗證 — 任何 email 都會 find / build a student row.

import { neon } from '@neondatabase/serverless';

export const maxDuration = 10;

/**
 * Allocate next student_id of form A### given the highest existing one.
 * Pure helper (exported for testing).
 *
 * @param {string|null} lastId  highest existing student_id matching /^A\d{3}$/, or null if none
 * @returns {string}            next id, e.g. 'A001', 'A042'
 */
export function nextStudentId(lastId) {
  if (typeof lastId !== 'string' || !/^A\d{3}$/.test(lastId)) return 'A001';
  const n = parseInt(lastId.slice(1), 10) + 1;
  return 'A' + String(n).padStart(3, '0');
}

/**
 * Normalize/validate an email for lookup. Strict-enough (no full RFC 5322).
 * Pure helper (exported for testing).
 *
 * @param {string} email
 * @returns {string|null}
 */
export function normalizeEmail(email) {
  if (typeof email !== 'string') return null;
  const e = email.trim().toLowerCase();
  if (e.length < 3 || !e.includes('@') || !e.includes('.')) return null;
  return e;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const email = normalizeEmail(req.body?.email);
  if (!email) return res.status(400).json({ error: 'INVALID_EMAIL' });

  try {
    const sql = neon(process.env.DATABASE_URL);

    // 1. lookup existing student by email (case-insensitive — col is VARCHAR、實際 email 已 lowercase)
    const found = await sql`
      SELECT student_id, current_module, current_day
      FROM students WHERE LOWER(email) = ${email}
      LIMIT 1
    `;
    if (found.length > 0) {
      return res.status(200).json({
        studentId:  found[0].student_id,
        module:     found[0].current_module || 'self',
        currentDay: found[0].current_day || 1,
      });
    }

    // 2. create new student — allocate next A### id
    const last = await sql`
      SELECT student_id FROM students
      WHERE student_id ~ '^A[0-9]{3}$'
      ORDER BY student_id DESC LIMIT 1
    `;
    const newId = nextStudentId(last[0]?.student_id ?? null);

    await sql`
      INSERT INTO students
        (student_id, email, plan, tier, current_module, current_week, current_day,
         self_week_completed, money_unlocked, relationship_unlocked)
      VALUES
        (${newId}, ${email}, 'trial', 0, 'self', 1, 1,
         0, FALSE, FALSE)
    `;

    return res.status(200).json({
      studentId:  newId,
      module:     'self',
      currentDay: 1,
    });
  } catch (e) {
    console.error('[email-login] error:', e);
    return res.status(500).json({ error: 'Server error' });
  }
}
