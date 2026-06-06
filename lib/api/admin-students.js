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

// ─── v5.2 active_context enum (Vivi 6/5 + spec §1.3) ────────────
//   後台下拉 + pill label 顯示用. enum int → 中文 label.

export const ACTIVE_CONTEXT_CATEGORIES = Object.freeze({
  1: { code: 'career_work_money',       label: '事業 / 工作 / 金錢' },
  2: { code: 'intimate_relationship',   label: '親密關係 (伴侶 / 戀愛)' },
  3: { code: 'family',                  label: '家庭 (原生家庭 / 子女)' },
  4: { code: 'health',                  label: '健康 / 身體' },
  5: { code: 'self_internal',           label: '自我 / 內在狀態 / 心理' },
});

export const ACTIVE_CONTEXT_SHORT_LABELS = Object.freeze({
  1: '事業', 2: '親密關係', 3: '家庭', 4: '健康', 5: '自我',
});

/**
 * Get the label for an active_context_category int. Defaults to 事業 (category 1)
 * if missing/invalid (per Vivi 6/5: all migrated rows default to 事業).
 */
export function activeContextLabel(cat) {
  const n = Number(cat);
  if (!Number.isInteger(n) || !ACTIVE_CONTEXT_SHORT_LABELS[n]) return '事業';
  return ACTIVE_CONTEXT_SHORT_LABELS[n];
}

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
  // ⭐ v5.2 active_context 欄位 — student-level program-scope context (Vivi 6/5).
  //   migration 029 在 DB 預設 1 (事業) + CHECK constraint 1-5.
  //   此處 fallback: 缺欄 / 非 integer / 越界 (0 / 6+) → 1 事業 (Vivi 6/5 預設).
  const acCatRaw = Number(row.active_context_category);
  const acCat = (Number.isInteger(acCatRaw) && acCatRaw >= 1 && acCatRaw <= 5)
    ? acCatRaw : 1;
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
    // v5.2 active_context (post-shape; UI consumers read these).
    active_context_category:        acCat,
    active_context_label:           activeContextLabel(acCat),
    active_context_name:            row.active_context_name || null,
    active_context_definition:      row.active_context_definition || null,
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
