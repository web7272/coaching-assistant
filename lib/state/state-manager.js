// lib/state/state-manager.js
// v5.0 session_state JSONB CRUD + user_profile_evolution upsert
// spec:
//   docs/v5-spec/engineering/01-migration-014-state-schema.md
//   docs/v5-spec/engineering/02-lib-modules-spec.md §2
//
// JSONB merge 規約（Patrick 5/21 決策）：
//   updateState(session_id, patch)              → SQL: session_state || patch::jsonb（淺合併、top-level）
//   updateStatePath(session_id, path, value)    → SQL: jsonb_set(session_state, path, value)（巢狀單一 field）
//
// 巢狀 object 同層多 field 整包替換 → updateState（會吃掉同層 sibling key、預期行為）
// 巢狀 object 單一 field 增量更新 → updateStatePath（jsonb_set 不動 sibling）

import { neon } from '@neondatabase/serverless';

let _sql = null;

function getSql() {
  if (_sql) return _sql;
  if (!process.env.DATABASE_URL) {
    throw new Error('state-manager: DATABASE_URL not set');
  }
  _sql = neon(process.env.DATABASE_URL);
  return _sql;
}

// Test seam: inject a mock SQL tag-template client (e.g. from node:test files).
export function _setSqlClient(client) {
  _sql = client;
}

// ─────────────────────────────────────────────────────────
// session_state (per-session JSONB on sessions.session_state)
// ─────────────────────────────────────────────────────────

export async function getState(session_id) {
  const sql = getSql();
  const rows = await sql`
    SELECT session_state FROM sessions WHERE id = ${session_id} LIMIT 1
  `;
  return rows[0]?.session_state ?? null;
}

/**
 * Shallow merge top-level keys via Postgres `||`.
 * Race-safe: the merge happens atomically at DB level.
 *
 * @param {number} session_id
 * @param {object} patch - top-level keys to merge into session_state
 */
export async function updateState(session_id, patch) {
  if (patch === null || typeof patch !== 'object' || Array.isArray(patch)) {
    throw new TypeError('updateState: patch must be a plain object');
  }
  const sql = getSql();
  const patchJson = JSON.stringify(patch);
  await sql`
    UPDATE sessions
    SET session_state = session_state || ${patchJson}::jsonb
    WHERE id = ${session_id}
  `;
}

/**
 * Set a single nested field via jsonb_set (does not touch sibling keys).
 *
 * @param {number} session_id
 * @param {string[]} path - non-empty, e.g. ['phase_progress', 'phase_3a', 'step']
 * @param {*} value - JSON-serializable
 */
export async function updateStatePath(session_id, path, value) {
  if (!Array.isArray(path) || path.length === 0) {
    throw new TypeError('updateStatePath: path must be non-empty array');
  }
  const pgPath = '{' + path.map(escapePathSegment).join(',') + '}';
  const valueJson = JSON.stringify(value);
  const sql = getSql();
  await sql`
    UPDATE sessions
    SET session_state = jsonb_set(session_state, ${pgPath}::text[], ${valueJson}::jsonb, true)
    WHERE id = ${session_id}
  `;
}

function escapePathSegment(seg) {
  if (typeof seg !== 'string' && typeof seg !== 'number') {
    throw new TypeError(`path segment must be string or number, got: ${typeof seg}`);
  }
  const s = String(seg);
  if (/^[a-zA-Z0-9_]+$/.test(s)) return s;
  // Postgres text[] literal: wrap unusual segments in double quotes.
  return '"' + s.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
}

/**
 * Apply a cross-day reset patch (the patch is owned by day-boundary).
 * Thin wrapper over updateState — semantic alias for call sites that want
 * to express intent ("this is a reset, not a routine update").
 */
export async function resetTransient(session_id, reset_patch) {
  return updateState(session_id, reset_patch);
}

// ─────────────────────────────────────────────────────────
// user_profile_evolution (cross-session persistent, keyed by student_id)
// ─────────────────────────────────────────────────────────

export async function getUserProfile(student_id) {
  const sql = getSql();
  const rows = await sql`
    SELECT * FROM user_profile_evolution WHERE student_id = ${student_id} LIMIT 1
  `;
  return rows[0] ?? null;
}

/**
 * Upsert pattern (idempotent): INSERT ... ON CONFLICT (student_id) DO UPDATE.
 * Only keys present in `patch` are written; missing keys keep existing values
 * (via COALESCE(EXCLUDED.col, existing.col)).
 *
 * Note: COALESCE means you cannot explicitly set a column to NULL via this API.
 * For the 16 UPE columns that's acceptable — they are accumulators (lists / counters / non-nullable progress).
 *
 * @param {string} student_id - e.g. 'A001'
 * @param {object} patch - subset of UPE columns
 */
export async function updateUserProfile(student_id, patch) {
  if (typeof student_id !== 'string' || student_id.length === 0) {
    throw new TypeError('updateUserProfile: student_id must be non-empty string');
  }
  if (patch === null || typeof patch !== 'object' || Array.isArray(patch)) {
    throw new TypeError('updateUserProfile: patch must be a plain object');
  }
  const sql = getSql();

  // Serialise each column to its expected SQL type. Missing keys → null → COALESCE keeps existing.
  // JSONB columns get JSON.stringify; scalars pass through.
  const jsonbCol = (k) => patch[k] != null ? JSON.stringify(patch[k]) : null;
  const scalarCol = (k) => patch[k] != null ? patch[k] : null;

  await sql`
    INSERT INTO user_profile_evolution (
      student_id,
      anchors, quality_focus_history,
      values_collected_list, top1_value, values_ranking,
      last_session_day_summary, export_prompt_generated_at,
      phase_history, calendar_day_count, session_day_count,
      program_completed_at, topic_refusal_areas,
      negative_takeaway_count, consecutive_amnesia_sessions,
      e1c_trigger_count_total, consecutive_hard_limit_sessions,
      updated_at
    ) VALUES (
      ${student_id},
      ${jsonbCol('anchors')}::jsonb, ${jsonbCol('quality_focus_history')}::jsonb,
      ${jsonbCol('values_collected_list')}::jsonb, ${scalarCol('top1_value')}, ${jsonbCol('values_ranking')}::jsonb,
      ${jsonbCol('last_session_day_summary')}::jsonb, ${scalarCol('export_prompt_generated_at')},
      ${jsonbCol('phase_history')}::jsonb, ${scalarCol('calendar_day_count')}, ${scalarCol('session_day_count')},
      ${scalarCol('program_completed_at')}, ${jsonbCol('topic_refusal_areas')}::jsonb,
      ${scalarCol('negative_takeaway_count')}, ${scalarCol('consecutive_amnesia_sessions')},
      ${scalarCol('e1c_trigger_count_total')}, ${scalarCol('consecutive_hard_limit_sessions')},
      now()
    )
    ON CONFLICT (student_id) DO UPDATE SET
      anchors                = COALESCE(EXCLUDED.anchors,                user_profile_evolution.anchors),
      quality_focus_history  = COALESCE(EXCLUDED.quality_focus_history,  user_profile_evolution.quality_focus_history),
      values_collected_list  = COALESCE(EXCLUDED.values_collected_list,  user_profile_evolution.values_collected_list),
      top1_value             = COALESCE(EXCLUDED.top1_value,             user_profile_evolution.top1_value),
      values_ranking         = COALESCE(EXCLUDED.values_ranking,         user_profile_evolution.values_ranking),
      last_session_day_summary   = COALESCE(EXCLUDED.last_session_day_summary,   user_profile_evolution.last_session_day_summary),
      export_prompt_generated_at = COALESCE(EXCLUDED.export_prompt_generated_at, user_profile_evolution.export_prompt_generated_at),
      phase_history          = COALESCE(EXCLUDED.phase_history,          user_profile_evolution.phase_history),
      calendar_day_count     = COALESCE(EXCLUDED.calendar_day_count,     user_profile_evolution.calendar_day_count),
      session_day_count      = COALESCE(EXCLUDED.session_day_count,      user_profile_evolution.session_day_count),
      program_completed_at   = COALESCE(EXCLUDED.program_completed_at,   user_profile_evolution.program_completed_at),
      topic_refusal_areas    = COALESCE(EXCLUDED.topic_refusal_areas,    user_profile_evolution.topic_refusal_areas),
      negative_takeaway_count          = COALESCE(EXCLUDED.negative_takeaway_count,          user_profile_evolution.negative_takeaway_count),
      consecutive_amnesia_sessions     = COALESCE(EXCLUDED.consecutive_amnesia_sessions,     user_profile_evolution.consecutive_amnesia_sessions),
      e1c_trigger_count_total          = COALESCE(EXCLUDED.e1c_trigger_count_total,          user_profile_evolution.e1c_trigger_count_total),
      consecutive_hard_limit_sessions  = COALESCE(EXCLUDED.consecutive_hard_limit_sessions,  user_profile_evolution.consecutive_hard_limit_sessions),
      updated_at = now()
  `;
}

// Exported for tests only.
export const _internal = { escapePathSegment };
