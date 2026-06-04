// lib/detector-handlers/index.js
// 全部 detector handler 聚合、chat.js v5.0 用此 register 進 DetectorRegistry。

import { E1_DETECTOR } from './engine-1.js';
import { E2_DETECTOR } from './engine-2.js';
import { E3_DETECTORS } from './engine-3.js';
import { E4_DETECTORS } from './engine-4.js';
// PR-23s4c task 4 — passive hope cascade (E3-adjacent at priority 25, fires
// AFTER deep_signal_detector so dedup-vs-deep-signal guard works).
import { PASSIVE_HOPE_CASCADE_DETECTOR } from './passive-hope-cascade.js';
import { skipIfDeviationHandled } from '../detector/registry.js';

/**
 * All detectors with handlers attached, ready for registry.register().
 * E2 master gets skip_if = skipIfDeviationHandled (engine 2 §4.1: E1 處理偏離時 E2 跳過).
 */
export const ALL_DETECTORS = Object.freeze([
  // user_turn cascade (priority 升序; PR-23s4c task 4 inserts passive-hope at 25)
  E1_DETECTOR,                                        // 10
  ...E3_DETECTORS,                                    // 20/30/40/45/50/60/65
  PASSIVE_HOPE_CASCADE_DETECTOR,                      // 25 (PR-23s4c, after deep_signal 20)
  { ...E2_DETECTOR, skip_if: skipIfDeviationHandled }, // 70
  // lifecycle (new_session_day / session_end / paired / program_milestone)
  ...E4_DETECTORS,
]);

/**
 * Register all detectors into a DetectorRegistry instance.
 * @param {import('../detector/registry.js').DetectorRegistry} registry
 */
export function registerAllDetectors(registry) {
  for (const det of ALL_DETECTORS) {
    registry.register(det);
  }
  return registry;
}

export { E1_DETECTOR, E2_DETECTOR, E3_DETECTORS, E4_DETECTORS };
