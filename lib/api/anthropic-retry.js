// lib/api/anthropic-retry.js
// Patrick 6/3 — Anthropic API 429 / 5xx 友善 handling + smart retry.
//
// 背景 (Vivi 6/3): 第一波 1000 leads → 100 名額; YouTube 影片爆紅 burst 可能 50-200
// 人同時打 Day 1. Anthropic tier rate limit 超過會 429. 沒 retry → user 撞鐵牆
// (500 / chat 永遠 loading).
//
// 策略:
//   429 rate limit  → 走完 maxRetries 個 attempt (預設 3), 每 attempt 之間
//                     exponential backoff (1s → 2s → 4s, cap 8s).
//                     respect retry-after header (cap 8s — 避免燒掉整個
//                     60s timeout).
//   5xx server      → 只在 attempt 0 retry 一次 (1s wait). attempt 1 又 5xx → throw.
//   其他 error      → throw immediately.
//
// 全部 attempt 跑完仍 429 → return { ok: false, reason: 'overload' }.
// caller (api/chat.js) 看到 overload → cleanup turn-level INSERT + 回 503.
//
// 純函式 (client + sleep 可注入) → unit-test 不用 real Anthropic / 不用 setTimeout 等真實秒數.

export const ANTHROPIC_RETRY_MAX     = 3;     // 預設 attempt 上限 (3 = 1 + 2 retries 概念)
export const ANTHROPIC_BACKOFF_CAP   = 8000;  // 單次 wait 上限 (ms), 防 retry-after 超大值
export const ANTHROPIC_5XX_RETRY_MS  = 1000;  // 5xx 第 0 次 attempt 的 retry wait

/**
 * Call Anthropic with retry for 429 + 1-shot retry for 5xx.
 *
 * @param {object} client            — Anthropic SDK instance (or any object with
 *                                     `messages.create(payload) → Promise`).
 * @param {object} payload           — messages.create payload (model/messages/system/...).
 * @param {object} [opts]
 * @param {number} [opts.maxRetries=3]
 * @param {(ms:number)=>Promise<void>} [opts.sleep]  — injectable sleep (tests 用).
 * @param {(msg:string)=>void}         [opts.log]    — injectable logger (預設 console.warn).
 * @returns {Promise<{ok:true, data:any, attempts:number}
 *                  | {ok:false, reason:'overload', attempts:number}>}
 * @throws  原始 err 物件 — 4xx (非 429) / 5xx (attempt > 0) / 其他.
 */
export async function callAnthropicWithRetry(client, payload, opts = {}) {
  const maxRetries = opts.maxRetries ?? ANTHROPIC_RETRY_MAX;
  const sleep      = opts.sleep ?? ((ms) => new Promise(r => setTimeout(r, ms)));
  const log        = opts.log   ?? ((msg) => console.warn(msg));

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const data = await client.messages.create(payload);
      return { ok: true, data, attempts: attempt + 1 };
    } catch (err) {
      const status = err?.status || err?.response?.status;

      // 429 rate limit → exponential backoff, retry through full window.
      if (status === 429) {
        const ra = err?.headers?.['retry-after'];
        const fromHeader = ra ? parseInt(ra, 10) * 1000 : NaN;
        const fromBackoff = Math.min(1000 * Math.pow(2, attempt), ANTHROPIC_BACKOFF_CAP);
        const wait = Number.isFinite(fromHeader) && fromHeader > 0
          ? Math.min(fromHeader, ANTHROPIC_BACKOFF_CAP)
          : fromBackoff;
        log(`[chat:429] attempt ${attempt + 1}/${maxRetries}, wait ${wait}ms`);
        await sleep(wait);
        continue;
      }

      // 5xx server error → 1 retry on attempt 0 only. attempt 1+ throw.
      if (status >= 500 && status < 600 && attempt === 0) {
        log(`[chat:5xx] status=${status} attempt ${attempt + 1}, wait ${ANTHROPIC_5XX_RETRY_MS}ms then retry`);
        await sleep(ANTHROPIC_5XX_RETRY_MS);
        continue;
      }

      // 其他 (4xx 非 429 / 5xx after retry / 網路錯誤) → throw to caller.
      throw err;
    }
  }

  // All attempts exhausted (only 429 path lands here — 5xx-after-retry already threw).
  return { ok: false, reason: 'overload', attempts: maxRetries };
}
