// lib/api/admin-students.js
// Patrick 5/29 — /api/admin/students 純函式 layer: derived field 計算 + status filter.
// Daniel 客服 / Vivi 用 → 必須是 live data, 不靠 stale snapshot.
//
// 鐵則:
//   · 不洩漏 messages / damon_note / SC 觀察 / Layer (鐵律 #2 諮商保密).
//   · 只回 metadata (count + per-student status fields).
//   · 純函式抽出來, endpoint handler 只 orchestrate (SQL + auth + response).

import { BETA_WINDOW_DAYS } from './access-gate.js';

// ─── status 預設 filter values ──────────────────────────────────

export const STATUS_FILTERS = Object.freeze([
  'needs_30_day_notice',   // is_beta + !blocked + !finished_21
  'at_risk',               // is_beta + !blocked + !finished_21 + days_since_last_session >= 14
  'finished',              // finished_21=TRUE
  'blocked',               // is_blocked=TRUE
  'active',                // !blocked + days_since_last_session <= 7
]);

export const AT_RISK_DAYS = 14;
export const ACTIVE_DAYS  = 7;

/**
 * 從 raw SQL row (含 days_since_register / last_session_at / finished_21 等
 * SQL-side aggregates) 算出 client-facing 學員 status 物件.
 *
 * @param {object} row
 * @returns {object}
 */
export function shapeStudentRow(row) {
  if (!row || typeof row !== 'object') return null;
  const daysSinceRegister = toInt(row.days_since_register);
  const lastSessionAt     = row.last_session_at || null;
  const daysSinceLast     = row.last_session_at != null
    ? toInt(row.days_since_last_session)
    : null;
  const finished21 = row.finished_21 === true;
  const isBeta     = row.is_beta === true;
  const isBlocked  = row.is_blocked === true;
  const daysRemaining = isBeta && Number.isFinite(daysSinceRegister)
    ? Math.max(0, BETA_WINDOW_DAYS - daysSinceRegister)
    : null;
  return {
    student_id:                     row.student_id,
    email:                          row.email || null,
    preferred_name:                 row.preferred_name || null,
    pace:                           row.pace || null,
    is_beta:                        isBeta,
    is_blocked:                     isBlocked,
    created_at:                     row.created_at || null,
    days_since_register:            Number.isFinite(daysSinceRegister) ? daysSinceRegister : null,
    last_unlocked_day:              toInt(row.last_unlocked_day) || 0,
    last_session_at:                lastSessionAt,
    days_since_last_session:        daysSinceLast,
    finished_21:                    finished21,
    finished_at:                    row.finished_at || null,
    days_remaining_in_beta_window:  daysRemaining,
    is_at_risk:                     computeIsAtRisk({ isBeta, isBlocked, finished21, daysSinceLast }),
  };
}

/**
 * @param {{isBeta:boolean, isBlocked:boolean, finished21:boolean, daysSinceLast:number|null}} args
 */
function computeIsAtRisk({ isBeta, isBlocked, finished21, daysSinceLast }) {
  if (!isBeta || isBlocked || finished21) return false;
  if (daysSinceLast == null) return false;          // 從沒登入過、不算 at_risk (該由 30 天 window 處理)
  return daysSinceLast >= AT_RISK_DAYS;
}

/**
 * 把 shapeStudentRow 出來的 array 依 status filter 過濾.
 *
 * @param {Array<object>} rows
 * @param {string|undefined} status   one of STATUS_FILTERS, 否則 no-op
 * @returns {Array<object>}
 */
export function applyStatusFilter(rows, status) {
  if (!Array.isArray(rows)) return [];
  if (!status || !STATUS_FILTERS.includes(status)) return rows;
  switch (status) {
    case 'needs_30_day_notice':
      return rows.filter(r => r.is_beta && !r.is_blocked && !r.finished_21);
    case 'at_risk':
      return rows.filter(r =>
        r.is_beta && !r.is_blocked && !r.finished_21
        && r.days_since_last_session != null
        && r.days_since_last_session >= AT_RISK_DAYS);
    case 'finished':
      return rows.filter(r => r.finished_21 === true);
    case 'blocked':
      return rows.filter(r => r.is_blocked === true);
    case 'active':
      return rows.filter(r =>
        !r.is_blocked
        && r.days_since_last_session != null
        && r.days_since_last_session <= ACTIVE_DAYS);
    default:
      return rows;
  }
}

/**
 * Parse boolean-ish query parameter ('true' / 'false' / 'TRUE' / undefined).
 * undefined / 不認識的值 → undefined (no filter).
 */
export function parseBoolQuery(v) {
  if (typeof v !== 'string') return undefined;
  const lower = v.trim().toLowerCase();
  if (lower === 'true')  return true;
  if (lower === 'false') return false;
  return undefined;
}

// ─── helpers ────────────────────────────────────────────────────

function toInt(v) {
  if (v === null || v === undefined) return null;
  const n = typeof v === 'number' ? v : parseInt(v, 10);
  return Number.isFinite(n) ? n : null;
}
