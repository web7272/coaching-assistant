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

/**
 * PR-4c-2 — Atomically append a {day, term} entry to user_profile_evolution.daily_takeaways.
 *
 * Idempotent dedup-by-day: re-running with the same `day` REPLACES that day's entry
 * (lets finalize-day re-run safely with corrected term, e.g. after Damon Note regen).
 * Array is kept sorted by `day` ASC after the merge.
 *
 * @param {string} student_id
 * @param {{ day: number, term: string }} entry
 */
export async function appendDailyTakeaway(student_id, { day, term } = {}) {
  if (typeof student_id !== 'string' || student_id.length === 0) {
    throw new TypeError('appendDailyTakeaway: student_id must be non-empty string');
  }
  if (typeof day !== 'number' || !Number.isFinite(day) || day < 1) {
    throw new TypeError('appendDailyTakeaway: day must be positive number');
  }
  if (typeof term !== 'string' || term.length === 0) {
    throw new TypeError('appendDailyTakeaway: term must be non-empty string');
  }
  const sql = getSql();
  const seed = JSON.stringify([{ day, term }]);
  await sql`
    INSERT INTO user_profile_evolution (student_id, daily_takeaways)
    VALUES (${student_id}, ${seed}::jsonb)
    ON CONFLICT (student_id) DO UPDATE SET
      daily_takeaways = (
        SELECT COALESCE(jsonb_agg(e ORDER BY (e->>'day')::int), '[]'::jsonb)
        FROM (
          SELECT e FROM jsonb_array_elements(
            COALESCE(user_profile_evolution.daily_takeaways, '[]'::jsonb)
          ) e
          WHERE (e->>'day')::int <> ${day}::int
          UNION ALL
          SELECT jsonb_build_object('day', ${day}::int, 'term', ${term}::text)
        ) merged(e)
      ),
      updated_at = now()
  `;
}

/**
 * ⭐ v5.2 第三塊 PR-a (Vivi 6/5) — append per-category active_context summary entry.
 *
 * Source: v52_context_anchored_spec §5.2. Fixes Beta bug #7 (跨天重問同 value/example)
 * by giving AI cross-session memory bucket per active_context_category.
 *
 * Schema (per-category key into JSONB):
 *   {
 *     "<category 1-5>": {
 *       surfaced_values: string[]     — unique, append-only
 *       surfaced_examples: [{day, value, example}]  — unique-by-day, latest wins
 *       last_updated_day: number
 *     }
 *   }
 *
 * Idempotent semantics (per Vivi 6/5 spec §5.2):
 * - surfaced_values: de-dup by value string (Set-like).
 * - surfaced_examples: unique by day (re-running same day REPLACES that day's entry —
 *   same idempotency rationale as appendDailyTakeaway).
 * - last_updated_day: max of existing + supplied day.
 *
 * Fail-soft behavior: when migration 030 hasn't been applied yet, swallow the
 * column-missing error so caller (finalize-day) doesn't block Damon Note flow.
 * Same pattern as appendReframeInvocationHistory (migration 027).
 *
 * @param {string} student_id
 * @param {number} category — 1-5 per ACTIVE_CONTEXT_CATEGORIES
 * @param {object} entry
 * @param {number} entry.day — positive integer (1-21)
 * @param {string} [entry.value] — surfaced value (optional; if absent, only example added)
 * @param {string} [entry.example] — surfaced example string (optional)
 */
export async function appendActiveContextSummary(student_id, category, { day, value, example } = {}) {
  if (typeof student_id !== 'string' || student_id.length === 0) {
    throw new TypeError('appendActiveContextSummary: student_id must be non-empty string');
  }
  const cat = Number(category);
  if (!Number.isInteger(cat) || cat < 1 || cat > 5) {
    throw new TypeError('appendActiveContextSummary: category must be integer 1-5');
  }
  if (typeof day !== 'number' || !Number.isFinite(day) || day < 1) {
    throw new TypeError('appendActiveContextSummary: day must be positive number');
  }
  // Either value or example must be provided (graceful no-op if both missing).
  const hasValue = typeof value === 'string' && value.trim().length > 0;
  const hasExample = typeof example === 'string' && example.trim().length > 0;
  if (!hasValue && !hasExample) return;

  const sql = getSql();
  const catKey = String(cat);
  const cleanValue = hasValue ? value.trim() : null;
  // Truncate defensively — per spec §5.2 inject limit ≤100 chars per example.
  const cleanExample = hasExample
    ? example.trim().slice(0, 200)   // store up to 200; inject layer further trims to ~100
    : null;

  // Build the per-category JSON for the UPSERT seed.
  const seedCategoryObj = {
    surfaced_values: cleanValue ? [cleanValue] : [],
    surfaced_examples: cleanExample
      ? [{ day, value: cleanValue, example: cleanExample }]
      : [],
    last_updated_day: day,
  };
  const seedFull = { [catKey]: seedCategoryObj };
  const seedJson = JSON.stringify(seedFull);

  try {
    // ON CONFLICT path: merge per-category bucket atomically using JSON manipulation.
    //   - For existing category bucket: dedupe surfaced_values, replace example for same day,
    //     bump last_updated_day to max.
    //   - For new category bucket: just set the seed object.
    await sql`
      INSERT INTO user_profile_evolution (student_id, active_context_session_summary)
      VALUES (${student_id}, ${seedJson}::jsonb)
      ON CONFLICT (student_id) DO UPDATE SET
        active_context_session_summary = jsonb_set(
          COALESCE(user_profile_evolution.active_context_session_summary, '{}'::jsonb),
          ARRAY[${catKey}::text],
          jsonb_build_object(
            'surfaced_values', (
              SELECT COALESCE(jsonb_agg(DISTINCT v), '[]'::jsonb)
              FROM (
                SELECT jsonb_array_elements_text(
                  COALESCE(user_profile_evolution.active_context_session_summary -> ${catKey} -> 'surfaced_values', '[]'::jsonb)
                ) AS v
                UNION
                SELECT ${cleanValue}::text WHERE ${cleanValue}::text IS NOT NULL
              ) merged
              WHERE v IS NOT NULL
            ),
            'surfaced_examples', (
              SELECT COALESCE(jsonb_agg(e ORDER BY (e->>'day')::int), '[]'::jsonb)
              FROM (
                SELECT e FROM jsonb_array_elements(
                  COALESCE(user_profile_evolution.active_context_session_summary -> ${catKey} -> 'surfaced_examples', '[]'::jsonb)
                ) e
                WHERE (e->>'day')::int <> ${day}::int
                UNION ALL
                SELECT jsonb_build_object('day', ${day}::int, 'value', ${cleanValue}::text, 'example', ${cleanExample}::text)
                WHERE ${cleanExample}::text IS NOT NULL
              ) merged(e)
            ),
            'last_updated_day', GREATEST(
              COALESCE(
                (user_profile_evolution.active_context_session_summary -> ${catKey} ->> 'last_updated_day')::int,
                0
              ),
              ${day}::int
            )
          ),
          true
        ),
        updated_at = now()
    `;
  } catch (err) {
    if (err && /column .*active_context_session_summary.* does not exist/i.test(String(err.message || ''))) {
      // eslint-disable-next-line no-console
      console.warn('[appendActiveContextSummary] migration 030 not applied yet, skipping');
      return;
    }
    throw err;
  }
}

/**
 * PR-4c-2 — Shallow-merge keys into user_profile_evolution.last_session_day_summary JSONB.
 * Existing top-level keys preserved; provided keys overwritten / added.
 * Creates the row (with the supplied summary) if it doesn't exist yet.
 *
 * @param {string} student_id
 * @param {object} summary - keys to merge (e.g. { graduation: { coach_letter, declaration } })
 */
export async function setLastSessionDaySummary(student_id, summary) {
  if (typeof student_id !== 'string' || student_id.length === 0) {
    throw new TypeError('setLastSessionDaySummary: student_id must be non-empty string');
  }
  if (!summary || typeof summary !== 'object' || Array.isArray(summary)) {
    throw new TypeError('setLastSessionDaySummary: summary must be a plain object');
  }
  const sql = getSql();
  const json = JSON.stringify(summary);
  await sql`
    INSERT INTO user_profile_evolution (student_id, last_session_day_summary)
    VALUES (${student_id}, ${json}::jsonb)
    ON CONFLICT (student_id) DO UPDATE SET
      last_session_day_summary =
        COALESCE(user_profile_evolution.last_session_day_summary, '{}'::jsonb) || ${json}::jsonb,
      updated_at = now()
  `;
}

/**
 * v5.1 Step 6 PR-6b — Write crisis_state_carry_forward (full schema per
 * v51_checkpoint1_v2_turn2b.md §10.3 step 7.3 + landing errata §2.2).
 *
 * Idempotent UPSERT — replaces top-level fields each session close. We REPLACE
 * (not merge) because the carry_forward object represents the most recent
 * crisis state snapshot; per spec §10.4 + landing errata, fields like
 * landing_page_reminder_delivered are cumulative-by-design within carry_forward
 * itself (caller composes the new state from prior + this session before passing
 * here). The history of all crisis events lives separately in
 * user_profile_evolution.crisis_history (TODO Step 8 dashboard).
 *
 * @param {string} student_id
 * @param {object|null} carryForward — full carry_forward object OR null to clear
 */
export async function setCrisisStateCarryForward(student_id, carryForward) {
  if (typeof student_id !== 'string' || student_id.length === 0) {
    throw new TypeError('setCrisisStateCarryForward: student_id must be non-empty string');
  }
  if (carryForward !== null && (typeof carryForward !== 'object' || Array.isArray(carryForward))) {
    throw new TypeError('setCrisisStateCarryForward: carryForward must be object or null');
  }
  const sql = getSql();
  const payload = carryForward === null ? null : JSON.stringify(carryForward);
  if (payload === null) {
    await sql`
      UPDATE user_profile_evolution
      SET crisis_state_carry_forward = NULL,
          updated_at = now()
      WHERE student_id = ${student_id}
    `;
    return;
  }
  await sql`
    INSERT INTO user_profile_evolution (student_id, crisis_state_carry_forward)
    VALUES (${student_id}, ${payload}::jsonb)
    ON CONFLICT (student_id) DO UPDATE SET
      crisis_state_carry_forward = ${payload}::jsonb,
      updated_at = now()
  `;
}

/**
 * v5.1 Step 5c errata Patch 4 — Append a reframe invocation entry to
 * user_profile_evolution.reframe_invocation_history (cross-session JSONB array).
 *
 * Fail-open: if migration 027 hasn't run on this DB yet (column missing),
 * we swallow the error and emit a warn so callers don't have to wrap.
 * Mirrors the resilience pattern used by passive-death-wish-tracker.
 *
 * @param {string} student_id
 * @param {object} entry — { reframe_id, invoked_at_turn, session_id, outcome,
 *                            anchor_phrase_if_success?, invoked_at }
 */
export async function appendReframeInvocationHistory(student_id, entry) {
  if (typeof student_id !== 'string' || student_id.length === 0) {
    throw new TypeError('appendReframeInvocationHistory: student_id must be non-empty string');
  }
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
    throw new TypeError('appendReframeInvocationHistory: entry must be a plain object');
  }
  if (typeof entry.reframe_id !== 'string' || !/^R[1-7]$/.test(entry.reframe_id)) {
    throw new TypeError('appendReframeInvocationHistory: reframe_id must be R1-R7');
  }
  const sql = getSql();
  const seed = JSON.stringify([entry]);
  try {
    await sql`
      INSERT INTO user_profile_evolution (student_id, reframe_invocation_history)
      VALUES (${student_id}, ${seed}::jsonb)
      ON CONFLICT (student_id) DO UPDATE SET
        reframe_invocation_history =
          COALESCE(user_profile_evolution.reframe_invocation_history, '[]'::jsonb)
            || ${seed}::jsonb,
        updated_at = now()
    `;
  } catch (err) {
    // Migration 027 not yet applied → column missing. Fail-open per repo pattern.
    if (err && /column .*reframe_invocation_history.* does not exist/i.test(String(err.message || ''))) {
      // eslint-disable-next-line no-console
      console.warn('[appendReframeInvocationHistory] migration 027 not applied yet, skipping');
      return;
    }
    throw err;
  }
}

/**
 * PR-4c-2 — Stamp user_profile_evolution.export_prompt_generated_at = now().
 * Marker for "Day 21 export prompt已 generated + sent". Idempotent.
 *
 * @param {string} student_id
 */
export async function markExportEmailed(student_id) {
  if (typeof student_id !== 'string' || student_id.length === 0) {
    throw new TypeError('markExportEmailed: student_id must be non-empty string');
  }
  const sql = getSql();
  await sql`
    INSERT INTO user_profile_evolution (student_id, export_prompt_generated_at)
    VALUES (${student_id}, now())
    ON CONFLICT (student_id) DO UPDATE SET
      export_prompt_generated_at = now(),
      updated_at = now()
  `;
}

/**
 * Atomically bump user_profile_evolution lifecycle counters on a session turn.
 *
 * Why a dedicated method (not updateUserProfile):
 *   - updateUserProfile uses COALESCE-merge semantics → cannot do atomic
 *     increments (read-modify-write would race across concurrent turns).
 *   - updateUserProfile predates migration 015's `last_active_date` column.
 * This keeps every user_profile_evolution write behind one module (state-manager).
 *
 * Effects (idempotent upsert — creates the row on a first-ever session):
 *   - last_active_date   → always set to now()
 *   - calendar_day_count → += gapDays   (only when isNewDay)
 *   - session_day_count  → += 1         (only when isNewDay)
 *
 * @param {string} student_id
 * @param {{ gapDays?: number, isNewDay?: boolean }} opts
 */
export async function incrementUserProfileCounters(student_id, {
  gapDays = 0,
  isNewDay = false,
  // ⭐ §3 patch 6/4 (safety patch #23) — Cross-session passive death wish
  //   accumulator. Handler emits per-turn delta (typically 1 when detected);
  //   here we atomic-increment so concurrent turns don't lose counts. Column
  //   added by migration 024; before migration runs the UPDATE will fail and
  //   we swallow + log — fail-open so safety detection still fires this turn
  //   (handler already routed C-1/C-2 from regex match, count just isn't
  //   persisted yet).
  passiveDwIncrement = 0,
  // ⭐ v5.1 Step 5a — 5 cross-session signal counters (migration 026).
  //   Same fail-open pattern: per-signal UPDATE wrapped in try/catch so a
  //   missing column doesn't break the main counter upsert above.
  signalIncrements = {},
} = {}) {
  if (typeof student_id !== 'string' || student_id.length === 0) {
    throw new TypeError('incrementUserProfileCounters: student_id must be non-empty string');
  }
  const sql = getSql();
  const calInc = isNewDay ? gapDays : 0;
  const sessInc = isNewDay ? 1 : 0;
  await sql`
    INSERT INTO user_profile_evolution
      (student_id, calendar_day_count, session_day_count, last_active_date)
    VALUES
      (${student_id}, ${calInc}, ${sessInc}, now())
    ON CONFLICT (student_id) DO UPDATE SET
      calendar_day_count = user_profile_evolution.calendar_day_count + ${calInc},
      session_day_count  = user_profile_evolution.session_day_count + ${sessInc},
      last_active_date   = now(),
      updated_at         = now()
  `;
  // §3 patch #23 — Bump passive_death_wish_count cross-session. Separate UPDATE
  // so a missing column (migration 024 not yet run) only affects this delta,
  // not the main counter upsert above. Fail-open: log + continue.
  if (passiveDwIncrement > 0) {
    try {
      await sql`
        UPDATE user_profile_evolution
           SET passive_death_wish_count = COALESCE(passive_death_wish_count, 0) + ${passiveDwIncrement},
               updated_at = now()
         WHERE student_id = ${student_id}
      `;
    } catch (e) {
      console.warn('[passive-dw counter] UPDATE failed (migration 024 not run?):', e?.message || e);
    }
  }
  // ⭐ v5.1 Step 5a — 5 cross-session signal counters (migration 026).
  //   Allowed signal names hardcoded for SQL injection safety (column names
  //   cannot be parameterized in tagged template).
  const ALLOWED_SIGNALS = {
    external_locus_signals:          'external_locus_signals_count_cumulative',
    passive_hope_signals:            'passive_hope_signals_count_cumulative',
    frequency_illusion_signals:      'frequency_illusion_signals_count_cumulative',
    conditional_worth_signals:       'conditional_worth_signals_count_cumulative',
    negative_generalization_signals: 'negative_generalization_signals_count_cumulative',
    // ⭐ Step 7 PR-7b — S6 modal_operator (migration 028).
    modal_operator_signals:          'modal_operator_signals_count_cumulative',
  };
  for (const [signal, delta] of Object.entries(signalIncrements || {})) {
    if (!Number.isFinite(delta) || delta <= 0) continue;
    const col = ALLOWED_SIGNALS[signal];
    if (!col) continue;   // unknown signal — silently skip (defensive)
    try {
      // Use template branches per column (SQL tagged templates can't parameterize identifiers).
      if (col === 'external_locus_signals_count_cumulative') {
        await sql`UPDATE user_profile_evolution SET external_locus_signals_count_cumulative = COALESCE(external_locus_signals_count_cumulative, 0) + ${delta}, updated_at = now() WHERE student_id = ${student_id}`;
      } else if (col === 'passive_hope_signals_count_cumulative') {
        await sql`UPDATE user_profile_evolution SET passive_hope_signals_count_cumulative = COALESCE(passive_hope_signals_count_cumulative, 0) + ${delta}, updated_at = now() WHERE student_id = ${student_id}`;
      } else if (col === 'frequency_illusion_signals_count_cumulative') {
        await sql`UPDATE user_profile_evolution SET frequency_illusion_signals_count_cumulative = COALESCE(frequency_illusion_signals_count_cumulative, 0) + ${delta}, updated_at = now() WHERE student_id = ${student_id}`;
      } else if (col === 'conditional_worth_signals_count_cumulative') {
        await sql`UPDATE user_profile_evolution SET conditional_worth_signals_count_cumulative = COALESCE(conditional_worth_signals_count_cumulative, 0) + ${delta}, updated_at = now() WHERE student_id = ${student_id}`;
      } else if (col === 'negative_generalization_signals_count_cumulative') {
        await sql`UPDATE user_profile_evolution SET negative_generalization_signals_count_cumulative = COALESCE(negative_generalization_signals_count_cumulative, 0) + ${delta}, updated_at = now() WHERE student_id = ${student_id}`;
      } else if (col === 'modal_operator_signals_count_cumulative') {
        // ⭐ Step 7 PR-7b — S6 modal_operator (migration 028).
        await sql`UPDATE user_profile_evolution SET modal_operator_signals_count_cumulative = COALESCE(modal_operator_signals_count_cumulative, 0) + ${delta}, updated_at = now() WHERE student_id = ${student_id}`;
      }
    } catch (e) {
      console.warn(`[engine1-signal counter] ${signal} UPDATE failed (migration 026 not run?):`, e?.message || e);
    }
  }
}

// Exported for tests only.
export const _internal = { escapePathSegment };
