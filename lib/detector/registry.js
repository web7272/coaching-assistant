// lib/detector/registry.js
// v5.0 detector registry — 統一註冊 + 觸發優先序 + Sequential cascade
//
// 設計（spec 03-v40-adaptation §2 + Patrick 5/21）：
//   - 5 個 detector type（分類用、registry 不依此 dispatch）
//   - 5 個 trigger_event type（registry 依此 dispatch）
//   - user_turn 用 Sequential cascade（依 priority 升序、任一 handled → 停）
//   - lifecycle events 用 parallel（new_session_day / session_end / program_milestone）
//   - paired：primary detector handled 後 in-line 觸發 paired detector
//   - handler throw → log + 降級、繼續下一個（不 break session）
//
// 本模組是 dispatcher 機制；實際 detector handlers 由 chat.js (P2) 註冊。

// ─────────────────────────────────────────────────────────
// constants — type 分類 (spec 03 §2)
// ─────────────────────────────────────────────────────────

export const DETECTOR_TYPES = Object.freeze([
  'always_on_cached',    // cached prefix（Layer 0、token 0、永久載入）
  'conditional_inject',  // state 觸發後 inject prompt 段落
  'detector_only',       // 純 regex + state mutation、token 0、無 inject
  'pipeline',            // 鏈式（detector → classifier → sub-inject）
  'tool_call',           // Haiku 4.5 SDK 獨立 call、structured output
]);

// ─────────────────────────────────────────────────────────
// trigger_event types — registry dispatches by these
// ─────────────────────────────────────────────────────────

export const TRIGGER_EVENTS = Object.freeze([
  'user_turn',           // per-turn Sequential cascade
  'new_session_day',     // lifecycle: 第一個 turn of a new day
  'session_end',         // lifecycle: session 結束（soft / hard / 學員主動）
  'paired',              // 跟著 primary detector 一起 fire（E4_cascade_down_reference 模式）
  'program_milestone',   // Day 21 等 program-level milestone
]);

// ─────────────────────────────────────────────────────────
// Default cascade priorities (spec 03 §2 7-step chain)
// 低數字 = 高優先（先 dispatch）。chat.js (P2) 用這個 constant 註冊 detectors。
// ─────────────────────────────────────────────────────────

export const CASCADE_PRIORITY = Object.freeze({
  E1_deviation_pipeline:        10,  // E1 master + classifier + E1a/b/c/d（最優先）
  E3_deep_signal_detector:      20,  // 深創傷訊號（不能被 elicitation 吞）
  // PR-23s4b — task 1 renames (per v51_engine_3_errata_v02.md):
  E3_elicitation_router:        30,  // elicitation mode 分流 (前 E3_opening_branch_router)
  E3_top1_judge:                40,  // Top 1 判定 Containment + Goal Alignment (前 E3_top1_determination)
  E3_mode_transition_router:    50,  // mode transition 判定 + emit log (前 E3_status_router)
  E3_cascade_mode_validator:    60,  // cascade mode 內 Top 2/3 驗證 (前 E3_cascade_down_validator)
  E2_identity_test_pipeline:    70,  // E2 master + aggregator（skip if E1 handled）
});

// ─────────────────────────────────────────────────────────
// validation
// ─────────────────────────────────────────────────────────

function isValidType(t) { return DETECTOR_TYPES.includes(t); }
function isValidEvent(e) { return TRIGGER_EVENTS.includes(e); }

function validateDef(def) {
  if (!def || typeof def !== 'object') {
    throw new TypeError('register: detector def must be object');
  }
  if (typeof def.id !== 'string' || !def.id) {
    throw new TypeError('register: id (non-empty string) required');
  }
  if (!isValidType(def.type)) {
    throw new TypeError(`register: type must be one of ${JSON.stringify(DETECTOR_TYPES)}, got ${def.type}`);
  }
  if (!isValidEvent(def.trigger_event)) {
    throw new TypeError(`register: trigger_event must be one of ${JSON.stringify(TRIGGER_EVENTS)}, got ${def.trigger_event}`);
  }
  if (typeof def.handler !== 'function') {
    throw new TypeError('register: handler (async function) required');
  }
  if (def.trigger_event === 'user_turn') {
    if (typeof def.priority !== 'number' || Number.isNaN(def.priority)) {
      throw new TypeError(`register: detector "${def.id}" with trigger_event=user_turn requires numeric priority`);
    }
  }
  if (def.trigger_event === 'paired') {
    if (typeof def.paired_with !== 'string' || !def.paired_with) {
      throw new TypeError(`register: detector "${def.id}" with trigger_event=paired requires paired_with (primary id)`);
    }
  }
  if (def.skip_if != null && typeof def.skip_if !== 'function') {
    throw new TypeError(`register: skip_if (if provided) must be function`);
  }
}

// ─────────────────────────────────────────────────────────
// DetectorRegistry — main class
// ─────────────────────────────────────────────────────────

export class DetectorRegistry {
  constructor({ logger } = {}) {
    /** @type {Map<string, object>} id → detector def */
    this.detectors = new Map();
    /** @type {Map<string, object[]>} event → detector defs sorted by priority */
    this.byEvent = new Map();
    /** @type {Map<string, string[]>} primary id → paired detector ids */
    this.pairedWith = new Map();
    /** Optional logger; defaults to console.warn for error logging */
    this.logger = logger || ((event, payload) => {
      if (event === 'detector_error') {
        // eslint-disable-next-line no-console
        console.warn(`[detector ${payload.detector_id} error]`, payload.error?.message ?? payload.error);
      }
    });
  }

  /**
   * Register a detector.
   *
   * @param {object} def
   * @param {string} def.id
   * @param {string} def.type - one of DETECTOR_TYPES
   * @param {string} def.trigger_event - one of TRIGGER_EVENTS
   * @param {number} [def.priority] - required when trigger_event=user_turn
   * @param {string} [def.paired_with] - required when trigger_event=paired
   * @param {(ctx: object) => Promise<object> | object} def.handler
   * @param {(ctx: object) => boolean} [def.skip_if]
   */
  register(def) {
    validateDef(def);
    if (this.detectors.has(def.id)) {
      throw new Error(`register: duplicate detector id "${def.id}"`);
    }
    this.detectors.set(def.id, Object.freeze({ ...def }));

    if (def.trigger_event === 'paired') {
      const arr = this.pairedWith.get(def.paired_with) || [];
      arr.push(def.id);
      this.pairedWith.set(def.paired_with, arr);
      return;
    }

    const arr = this.byEvent.get(def.trigger_event) || [];
    arr.push(def);
    if (def.trigger_event === 'user_turn') {
      arr.sort((a, b) => a.priority - b.priority);
    }
    this.byEvent.set(def.trigger_event, arr);
  }

  unregister(id) {
    const det = this.detectors.get(id);
    if (!det) return false;
    this.detectors.delete(id);
    if (det.trigger_event === 'paired') {
      const arr = this.pairedWith.get(det.paired_with) || [];
      this.pairedWith.set(det.paired_with, arr.filter(x => x !== id));
    } else {
      const arr = this.byEvent.get(det.trigger_event) || [];
      this.byEvent.set(det.trigger_event, arr.filter(d => d.id !== id));
    }
    return true;
  }

  has(id) { return this.detectors.has(id); }
  size() { return this.detectors.size; }
  getDetector(id) { return this.detectors.get(id); }

  /**
   * Snapshot the registered detector ids for a given event, in dispatch order.
   * Diagnostic helper for chat.js / dashboard.
   */
  listForEvent(event) {
    if (event === 'paired') {
      // Flatten the paired map for visibility
      const out = [];
      for (const [primary, paired] of this.pairedWith) {
        for (const pid of paired) out.push({ id: pid, paired_with: primary });
      }
      return out;
    }
    return (this.byEvent.get(event) || []).map(d => ({ id: d.id, priority: d.priority }));
  }

  /**
   * Dispatch for a given event with a context object.
   *
   * - user_turn → Sequential cascade
   * - other events → parallel (all matching detectors fire, order = registration)
   *
   * @param {string} event
   * @param {object} ctx - passed to each handler + skip_if
   * @returns {Promise<DispatchResult[]>}
   */
  async dispatch(event, ctx) {
    if (!isValidEvent(event)) {
      throw new TypeError(`dispatch: unknown event "${event}"`);
    }
    if (event === 'user_turn') {
      return this._dispatchSequential(ctx);
    }
    if (event === 'paired') {
      // paired detectors don't fire directly via dispatch — they fire via
      // their primary's handled result. Surface this as a clear error.
      throw new Error(`dispatch: "paired" event is not dispatched directly; it fires via primary detector`);
    }
    return this._dispatchParallel(event, ctx);
  }

  async _dispatchSequential(ctx) {
    const dets = this.byEvent.get('user_turn') || [];
    const results = [];
    for (const det of dets) {
      if (det.skip_if) {
        let skip = false;
        try {
          skip = !!det.skip_if(ctx);
        } catch (e) {
          // skip_if throw is treated as "don't skip" but logged
          this.logger('detector_skip_if_error', { detector_id: det.id, error: e });
          skip = false;
        }
        if (skip) {
          results.push({ id: det.id, skipped: true });
          continue;
        }
      }
      try {
        const r = await det.handler(ctx);
        results.push({ id: det.id, ok: true, result: r });
        if (r && r.handled === true) {
          // Fire paired detectors after primary handles
          const pairedIds = this.pairedWith.get(det.id) || [];
          for (const pid of pairedIds) {
            const pDet = this.detectors.get(pid);
            if (!pDet) continue;
            await this._runOne(pDet, ctx, results, /* paired */ true);
          }
          break; // Sequential cascade: stop at first handled
        }
      } catch (e) {
        this.logger('detector_error', { detector_id: det.id, error: e });
        results.push({ id: det.id, ok: false, error: e });
        // continue cascade — throw degrades, doesn't break session
      }
    }
    return results;
  }

  async _dispatchParallel(event, ctx) {
    const dets = this.byEvent.get(event) || [];
    const results = [];
    for (const det of dets) {
      await this._runOne(det, ctx, results, /* paired */ false);
    }
    return results;
  }

  async _runOne(det, ctx, results, isPaired) {
    if (det.skip_if) {
      let skip = false;
      try {
        skip = !!det.skip_if(ctx);
      } catch (e) {
        this.logger('detector_skip_if_error', { detector_id: det.id, error: e });
        skip = false;
      }
      if (skip) {
        results.push({ id: det.id, skipped: true, ...(isPaired ? { paired: true } : {}) });
        return;
      }
    }
    try {
      const r = await det.handler(ctx);
      results.push({ id: det.id, ok: true, result: r, ...(isPaired ? { paired: true } : {}) });
    } catch (e) {
      this.logger('detector_error', { detector_id: det.id, error: e });
      results.push({ id: det.id, ok: false, error: e, ...(isPaired ? { paired: true } : {}) });
    }
  }
}

/**
 * @typedef {object} DispatchResult
 * @property {string} id - detector id
 * @property {boolean} [ok] - handler ran without throwing
 * @property {boolean} [skipped] - skip_if returned truthy
 * @property {boolean} [paired] - this result was a paired detector
 * @property {object} [result] - handler return value; should include { handled: bool }
 * @property {Error} [error] - if ok === false
 */

/**
 * Reusable skip_if for E2 master detector — spec engine 2 §4.1 contextual_filter:
 *   skip if engine 1 has handled deviation this turn.
 *
 * Exposed here so chat.js (P2) can simply set:
 *   { ..., skip_if: skipIfDeviationHandled }
 */
export function skipIfDeviationHandled(ctx) {
  return ctx?.session_state?.deviation_handled_this_turn != null;
}
