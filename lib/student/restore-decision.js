// lib/student/restore-decision.js
//
// Pure decision function: when entering the conversation view, what should we
// do with the local-storage cache vs the server's authoritative in-progress
// session?
//
// ⭐ Patrick 6/6 P0 hotfix root-cause: pre-fix student.js gated server
//    restore on `state.conversation.length === 0` only. Any stale message in
//    localStorage (even a 1-line opening) blocked the fetch → student saw the
//    stale cache forever, never reconciled with the real in-progress session.
//
//    A015 repro: localStorage conversation=[1 opening] / _lastSessionId=47.
//    DB in-progress = session 51 (4 msgs). reload → stale shown, session 51
//    invisible. Manually clearing conversation cache → reload → 200, session
//    51 restored.
//
// Fix semantics (Patrick spec verbatim):
//   1. Always ask server (authoritative); reconcile by sessionId.
//   2. Server has in-progress + (local empty OR stale sid OR localShorter)
//      → use server.
//   3. Server has in-progress + local matches → no-op (avoid flicker).
//   4. Server has nothing + local empty → kickoff (request opening).
//   5. Server has nothing + local non-empty → no-op (closure-just-happened edge).
//   6. Server fetch failed (5xx/network) → fail-open: local empty → kickoff;
//      local non-empty → keep local (don't lock student out).
//
// ⚠️ DECISION LOGIC SYNC NOTE
//    student.js is a non-module browser script and cannot ES-import this file.
//    The decision logic is INLINED there inside `decideRestoreActionInline()`.
//    Any change here MUST be mirrored there. The cross-check test below
//    (restore-decision.test.js) covers BOTH implementations via dynamic source
//    extraction so divergence is caught by CI.

/**
 * @param {object} args
 * @param {object} args.local
 * @param {Array<{role:string, content:string}>} args.local.conversation
 * @param {string|number|null} args.local.lastSessionId
 * @param {boolean} args.serverFetchOk - did /api/conversation-today succeed?
 * @param {object|null} args.server - response body when serverFetchOk
 * @param {boolean} [args.server.hasInProgress]
 * @param {string|number|null} [args.server.sessionId]
 * @param {Array<{role:string, content:string}>} [args.server.messages]
 * @returns {{
 *   action: 'use-server' | 'no-op' | 'kickoff',
 *   reason: string,
 *   messages?: Array<{role:string,content:string}>,
 *   sessionId?: string|number,
 *   prevLocalCount?: number
 * }}
 */
export function decideRestoreAction({ local, serverFetchOk, server } = {}) {
  const localConv = (local && Array.isArray(local.conversation)) ? local.conversation : [];
  const localCount = localConv.length;
  const localSid   = (local && local.lastSessionId != null) ? local.lastSessionId : null;

  // ── Path A: server fetch failed → fail-open ──────────────────────
  if (!serverFetchOk) {
    if (localCount === 0) {
      return { action: 'kickoff', reason: 'server_fetch_failed_and_local_empty' };
    }
    return { action: 'no-op', reason: 'server_fetch_failed_keep_local' };
  }

  // ── Path B: server has no in-progress session ────────────────────
  const hasInProgress = !!(server
    && server.hasInProgress === true
    && Array.isArray(server.messages)
    && server.messages.length > 0);
  if (!hasInProgress) {
    if (localCount === 0) {
      return { action: 'kickoff', reason: 'no_server_session_and_local_empty' };
    }
    return { action: 'no-op', reason: 'no_server_session_keep_local' };
  }

  // ── Path C: server HAS in-progress → reconcile ───────────────────
  const serverSid   = server.sessionId;
  const serverCount = server.messages.length;
  const stale       = localSid != null && localSid !== serverSid;
  const localShorter = localCount < serverCount;

  if (localCount === 0 || stale || localShorter) {
    return {
      action: 'use-server',
      sessionId: serverSid,
      messages: server.messages,
      prevLocalCount: localCount,
      reason: localCount === 0 ? 'local_empty'
            : stale            ? 'stale_session_id'
            :                    'local_shorter',
    };
  }

  // local in sync with server (same sid, length >= server) → don't redraw.
  return { action: 'no-op', reason: 'local_in_sync' };
}
