// lib/haiku-judge/_base.js
// 共用基底：4 個 Haiku 4.5 judge instance（P1：sensory-detail / depth-signal /
// containment-logic / takeaway-sentiment）都透過 runJudge() 呼叫。
//
// 設計：
//   - latency target 200ms（spec 02 §1）— 超時 throw JudgeTimeoutError
//   - 超時降級到主對話 LLM inline judge → 由 chat.js（P2）catch 處理、本模組不負責 fallback
//   - parse 函式注入：每個 judge instance 自帶 schema validator、parse 失敗 throw JudgeSchemaError
//
// SDK：@anthropic-ai/sdk ^0.95.2、Haiku 4.5 model id 'claude-haiku-4-5-20251001'

import Anthropic from '@anthropic-ai/sdk';

export const HAIKU_MODEL = 'claude-haiku-4-5-20251001';
export const DEFAULT_TIMEOUT_MS = 200;
export const DEFAULT_MAX_TOKENS = 400;

let _client = null;

function getClient() {
  if (_client) return _client;
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error('haiku-judge: ANTHROPIC_API_KEY not set');
  }
  _client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return _client;
}

// Test seam: inject a mock Anthropic-shaped client { messages: { create(...) } }
export function _setClient(client) {
  _client = client;
}

// ─────────────────────────────────────────────────────────
// Error types — chat.js（P2）依此分流：timeout → inline LLM fallback；schema → log + skip
// ─────────────────────────────────────────────────────────

export class JudgeTimeoutError extends Error {
  constructor(elapsed_ms, timeout_ms) {
    super(`Haiku judge timed out after ${elapsed_ms}ms (limit ${timeout_ms}ms)`);
    this.name = 'JudgeTimeoutError';
    this.elapsed_ms = elapsed_ms;
    this.timeout_ms = timeout_ms;
  }
}

export class JudgeSchemaError extends Error {
  constructor(message, raw) {
    super(message);
    this.name = 'JudgeSchemaError';
    this.raw = raw;
  }
}

// ─────────────────────────────────────────────────────────
// runJudge — 共用呼叫器
// ─────────────────────────────────────────────────────────

/**
 * Run a Haiku judge call with timeout + structured-output validation.
 *
 * @param {object} opts
 * @param {string} opts.system - judge persona + output schema description
 * @param {string} opts.prompt - the judging task input
 * @param {(rawText: string) => object} opts.parse - parse + validate raw text to structured object;
 *   should throw on schema violation (caller wraps in JudgeSchemaError)
 * @param {number} [opts.timeoutMs=200]
 * @param {number} [opts.maxTokens=400]
 * @returns {Promise<object>} parsed structured output
 * @throws {JudgeTimeoutError} when the SDK call exceeds timeoutMs
 * @throws {JudgeSchemaError} when response has no text content, or parse() throws
 */
export async function runJudge({
  system,
  prompt,
  parse,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  maxTokens = DEFAULT_MAX_TOKENS,
}) {
  if (typeof system !== 'string' || system.length === 0) {
    throw new TypeError('runJudge: system must be non-empty string');
  }
  if (typeof prompt !== 'string' || prompt.length === 0) {
    throw new TypeError('runJudge: prompt must be non-empty string');
  }
  if (typeof parse !== 'function') {
    throw new TypeError('runJudge: parse must be a function');
  }

  const client = getClient();
  const start = Date.now();

  let timer;
  const timeoutPromise = new Promise((_, reject) => {
    timer = setTimeout(() => {
      reject(new JudgeTimeoutError(Date.now() - start, timeoutMs));
    }, timeoutMs);
  });

  let response;
  try {
    response = await Promise.race([
      client.messages.create({
        model: HAIKU_MODEL,
        max_tokens: maxTokens,
        system,
        messages: [{ role: 'user', content: prompt }],
      }),
      timeoutPromise,
    ]);
  } finally {
    clearTimeout(timer);
  }

  const raw = extractText(response);
  if (raw === null) {
    throw new JudgeSchemaError('Haiku response had no text content block', response);
  }

  try {
    return parse(raw);
  } catch (e) {
    throw new JudgeSchemaError(`parse failed: ${e.message}`, raw);
  }
}

/**
 * Extract the first text content block from an Anthropic Messages response.
 * Returns null if no text block found.
 */
function extractText(response) {
  if (!response || !Array.isArray(response.content)) return null;
  for (const block of response.content) {
    if (block && block.type === 'text' && typeof block.text === 'string' && block.text.length > 0) {
      return block.text;
    }
  }
  return null;
}

// Exposed for tests
export const _internal = { extractText };
