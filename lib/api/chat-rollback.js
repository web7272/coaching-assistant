// lib/api/chat-rollback.js
// Patrick 5/28 — A006 case fix. Pure helper: decide + execute殭屍 session
// rollback after /api/chat downstream failure (Anthropic credit / timeout /
// Brevo / DB hiccup).
//
// Why a separate module:
//   api/chat.js handler has no test seams for sql / Anthropic, so handler-level
//   unit tests aren't feasible. The decision logic is small + pure though, so
//   extract it here. handler() calls rollbackSessionIfNeeded() in its finally
//   block. Tests pin the 4 decision cases directly.
//
// Rules (each case returns a distinct outcome string for tests to assert):
//   succeeded=true                  → 'skipped:succeeded'  (happy path, never delete)
//   isNew=false (reused row)        → 'skipped:not-new'    (in-progress 對話絕不刪)
//   no sessionId / no sql           → 'skipped:no-target'  (nothing to do)
//   DELETE succeeds                 → 'deleted'
//   DELETE throws                   → 'delete-failed:<message>'  (caller logs, swallows)

/**
 * @typedef {Object} RollbackArgs
 * @property {(strings: TemplateStringsArray, ...values: any[]) => Promise<any>} [sql]
 * @property {number|string|null|undefined} sessionId
 * @property {boolean|undefined} isNew
 * @property {boolean|undefined} succeeded
 */

/**
 * @param {RollbackArgs} args
 * @returns {Promise<string>}  outcome tag for tests
 */
export async function rollbackSessionIfNeeded({ sql, sessionId, isNew, succeeded } = {}) {
  if (succeeded) return 'skipped:succeeded';
  if (!isNew)    return 'skipped:not-new';
  if (!sessionId || !sql) return 'skipped:no-target';
  try {
    await sql`DELETE FROM sessions WHERE id = ${sessionId}`;
    return 'deleted';
  } catch (e) {
    // Caller logs at error level. Don't re-throw — the original downstream
    // error is what the user / observer cares about; a DELETE failure on top
    // is logged but must not mask the root cause.
    return 'delete-failed:' + (e?.message || 'unknown');
  }
}
