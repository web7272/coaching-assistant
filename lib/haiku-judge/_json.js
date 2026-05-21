// lib/haiku-judge/_json.js
// 共用 JSON 抽取 helper — Haiku 4.5 偶爾會用 markdown code fence 包 JSON
// 或在 JSON 前後加解釋文字、本 helper 統一處理、給 4 個 judge 的 parse() 用。

/**
 * Extract the first complete JSON object from `raw`.
 *
 * Handles:
 *   - leading/trailing whitespace
 *   - markdown code fences (```json ... ``` or ``` ... ```)
 *   - explanation text before/after the JSON
 *   - nested objects (depth-counted brace matching)
 *
 * Throws if no valid JSON object is found OR if JSON.parse fails.
 *
 * @param {string} raw - Raw text from Haiku response
 * @returns {object}
 */
export function extractJSON(raw) {
  if (typeof raw !== 'string') {
    throw new Error(`extractJSON: input must be string, got ${typeof raw}`);
  }

  // Strip markdown code fences if present (```json ... ``` or ``` ... ```)
  let text = raw.trim();
  text = text.replace(/^```(?:json|JSON)?\s*\r?\n?/, '').replace(/\r?\n?```\s*$/, '');

  // Find first '{' and matching '}' via depth counting (skips braces inside strings)
  const start = text.indexOf('{');
  if (start === -1) {
    throw new Error('extractJSON: no JSON object found in response');
  }

  let depth = 0;
  let end = -1;
  let inString = false;
  let escape = false;

  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (escape) { escape = false; continue; }
    if (ch === '\\') { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;

    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) { end = i; break; }
    }
  }

  if (end === -1) {
    throw new Error('extractJSON: unterminated JSON object');
  }

  const jsonStr = text.slice(start, end + 1);
  try {
    return JSON.parse(jsonStr);
  } catch (e) {
    throw new Error(`extractJSON: JSON.parse failed — ${e.message}`);
  }
}

/**
 * Assert that `obj` has every key in `requiredKeys` with the expected type.
 * Throws with a clear message naming the first violation.
 *
 * @param {object} obj
 * @param {Array<[key: string, expectedType: string | string[]]>} requiredKeys
 *   expectedType: 'boolean' | 'string' | 'number' | 'integer' | array of allowed string enum values
 */
export function assertShape(obj, requiredKeys) {
  if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) {
    throw new Error(`assertShape: expected object, got ${Array.isArray(obj) ? 'array' : typeof obj}`);
  }
  for (const [key, expected] of requiredKeys) {
    if (!(key in obj)) {
      throw new Error(`assertShape: missing key "${key}"`);
    }
    const v = obj[key];
    if (Array.isArray(expected)) {
      if (!expected.includes(v)) {
        throw new Error(`assertShape: "${key}" must be one of ${JSON.stringify(expected)}, got ${JSON.stringify(v)}`);
      }
    } else if (expected === 'integer') {
      if (typeof v !== 'number' || !Number.isInteger(v)) {
        throw new Error(`assertShape: "${key}" must be integer, got ${typeof v} (${v})`);
      }
    } else if (typeof v !== expected) {
      throw new Error(`assertShape: "${key}" must be ${expected}, got ${typeof v}`);
    }
  }
}
