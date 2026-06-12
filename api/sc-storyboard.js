// api/sc-storyboard.js
// v5.3 件3 PR-J1 — 頁 Y「我的人生旅途」(七步故事頁) endpoint 骨架.
//
// GET /api/sc-storyboard?module=self&audience=student
//      ?audience=coach&studentId=A001     (coach 看任何學員)
//
// v2 對齊契約 (Vivi 6/11 拍板, 覆寫原 spec §2.6):
//   - 每步 2 段: brain_state (PR-J2 生成) + sovereign_action (PR-J3 生成).
//   - 無 turning_lines / lines[].
//   - reviewed_by_coach 廢除, 不在契約.
//   - safety_flag 不外送前端 (internal LLM weight 用, J2/J3 內部用).
//
// PR-J1 純讀骨架:
//   - 讀 students.sc_journey_step + sc_journey_evidence (七步 errata live).
//   - state = evidence[step_N] 非空 → 'filled' ; 空 / 缺欄 → 'empty'.
//   - currentStep = sc_journey_step (null → null).
//   - brain_state / sovereign_action 全回 null (PR-J2/J3 才生成).
//
// Auth: 比照 api/journey.js (Vivi 6/11 ruling).
//   - audience='coach' → guardCoachOr401 + ?studentId from query.
//   - audience='student' (default) → guardStudentOr401, sid from cookie ONLY
//     (鐵則: ?studentId 完全忽略, 防 client-side privilege escalation).

import { neon } from '@neondatabase/serverless';
import { guardStudentOr401 } from '../lib/auth/student-session.js';
import { guardCoachOr401 }   from '../lib/auth/coach-session.js';

export const maxDuration = 10;

// ────────────────────────────────────────────────────────────────
// Test seam — inject mock sql client (mirrors api/day1-quota.js).
// ────────────────────────────────────────────────────────────────
let _sql = null;
export function _setSqlClient(client) { _sql = client; }
function getSql() {
  if (_sql) return _sql;
  return neon(process.env.DATABASE_URL);
}

// ────────────────────────────────────────────────────────────────
// Fixed 7-step identity (order locked per spec).
// ────────────────────────────────────────────────────────────────
export const SC_STORYBOARD_STEPS = Object.freeze([
  { no: '01', name_zh: '發現匱乏',   name_en: 'The Void' },
  { no: '02', name_zh: '承認渴望',   name_en: 'The Longing' },
  { no: '03', name_zh: '挖掘數據',   name_en: 'Mining the Database' },
  { no: '04', name_zh: '認領身份',   name_en: 'Claiming the Identity' },
  { no: '05', name_zh: '發現資源',   name_en: 'Resource Retrieval' },
  { no: '06', name_zh: '奪回裁判權', name_en: 'Reclaiming the Sovereignty' },
  { no: '07', name_zh: '標籤定錨',   name_en: 'Anchoring the Concept' },
]);

/**
 * Build the 7-step skeleton.
 *
 * PR-J1: pure skeleton from sc_journey_evidence (state empty/filled).
 *        brain_state / sovereign_action always null.
 * PR-J2 (this PR): reads precomputed sc_storyboard column to populate
 *        per-step `brain_state` = { description, quote|null }. sovereign_action
 *        still null (PR-J3 fills later). brain_state stays null when:
 *          - step state='empty' (no evidence yet), OR
 *          - sc_storyboard[step_N].brain_state missing / null (finalize hasn't
 *            generated yet, or generation failed fail-soft).
 *        Endpoint stays PURE READ — writes happen in finalize-day.
 *
 * @param {object|null} evidence    students.sc_journey_evidence  ({step_1..step_7: []})
 * @param {object|null} storyboard  students.sc_storyboard       ({step_N: {brain_state, sovereign_action}})
 * @returns {Array<{no, name_zh, name_en, state, brain_state, sovereign_action}>}
 */
export function buildScStoryboardSteps(evidence, storyboard = null) {
  const ev = (evidence && typeof evidence === 'object' && !Array.isArray(evidence))
    ? evidence : {};
  const sb = (storyboard && typeof storyboard === 'object' && !Array.isArray(storyboard))
    ? storyboard : {};
  return SC_STORYBOARD_STEPS.map((meta, idx) => {
    const stepKey = `step_${idx + 1}`;
    const arr = Array.isArray(ev[stepKey]) ? ev[stepKey] : [];
    const state = arr.length > 0 ? 'filled' : 'empty';
    // PR-J2 wire: pull pre-computed brain_state from sc_storyboard.
    // PR-J3 wire: pull pre-computed sovereign_action from sc_storyboard.
    // Only surface for filled steps (empty step → null even if column dirty).
    let brain_state      = null;
    let sovereign_action = null;
    if (state === 'filled') {
      const stepNode = sb[stepKey];
      if (stepNode && typeof stepNode === 'object') {
        // J2: brain_state strict shape {description, quote}.
        if (stepNode.brain_state && typeof stepNode.brain_state === 'object'
            && typeof stepNode.brain_state.description === 'string'
            && stepNode.brain_state.description.length > 0) {
          brain_state = {
            description: stepNode.brain_state.description,
            quote:       (typeof stepNode.brain_state.quote === 'string'
                          && stepNode.brain_state.quote.length > 0)
                          ? stepNode.brain_state.quote : null,
          };
        }
        // J3: sovereign_action — plain string. Null when not generated yet.
        if (typeof stepNode.sovereign_action === 'string'
            && stepNode.sovereign_action.length > 0) {
          sovereign_action = stepNode.sovereign_action;
        }
      }
    }
    return {
      no:      meta.no,
      name_zh: meta.name_zh,
      name_en: meta.name_en,
      state,
      brain_state,
      sovereign_action,
    };
  });
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const module   = String(req.query?.module   || 'self').trim();
  const audience = String(req.query?.audience || 'student').toLowerCase();

  // Resolve studentId by audience — IDENTICAL to api/journey.js pattern.
  let studentId;
  if (audience === 'coach') {
    if (!(await guardCoachOr401(req, res))) return;
    studentId = String(req.query?.studentId || '').trim();
    if (!studentId) {
      return res.status(400).json({ error: 'Missing required query: studentId' });
    }
  } else {
    studentId = await guardStudentOr401(req, res);
    if (!studentId) return;
  }

  try {
    const sql = getSql();

    // Fail-soft read: any failure (col missing pre-PR-1/J2 deploy / connection
    // drop / row absent) → currentStep null + all steps 'empty'.
    let currentStep    = null;
    let evidence       = null;
    let storyboard     = null;
    try {
      const rows = await sql`
        SELECT sc_journey_step, sc_journey_evidence, sc_storyboard
          FROM students
         WHERE student_id = ${studentId}
         LIMIT 1
      `;
      if (rows.length > 0) {
        const stepRaw = rows[0].sc_journey_step;
        if (Number.isInteger(stepRaw) && stepRaw >= 1 && stepRaw <= 7) {
          currentStep = stepRaw;
        }
        evidence   = rows[0].sc_journey_evidence ?? null;
        storyboard = rows[0].sc_storyboard       ?? null;
      }
    } catch (e) {
      console.warn('[sc-storyboard] sc_journey lookup failed (fail-soft):',
        e?.message || e);
    }

    return res.status(200).json({
      module,
      currentStep,
      steps: buildScStoryboardSteps(evidence, storyboard),
    });
  } catch (e) {
    console.error('[sc-storyboard] error:', e?.message || e);
    return res.status(500).json({ error: 'Server error' });
  }
}
