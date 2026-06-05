# v5.1 Step 11 — Post-ship Production Smoke (Patrick-executed)

> **角色**: A3 production smoke 在 sandbox 跑不了 (production domain / admin
> auth / DATABASE_URL 都不在 CC 手上). 本檔是 Patrick 在 production env 跑
> 的 4 項 smoke + 對應回報模板.
>
> **建立日期**: 2026-06-05 (after ship merge `b0dd155..216ac7b` to main).
>
> **基準**: main HEAD = `216ac7b964617b78387586235fa410f220904ca8`
>
> **觸發**: Vercel production deploy on push to main (auto-deploy from
> claude/v5-p2-pr4c-4-frontend FF merge).

---

## 前提

1. Vercel production deployment Ready (查 Vercel dashboard 確認 main sha
   `216ac7b` 部署 status = Ready).
2. 不是 #16 preview — 是 production app (正式 domain).

---

## A3.1 — Production app 首頁

```bash
# Production domain (Patrick replace).
PROD_URL="https://<production-domain>"

curl -sI "$PROD_URL/" | head -3
# Expect: HTTP/2 200 OR HTTP/2 307 (redirect to login OK).
```

**Pass 條件**:
- HTTP 200 OR 307 redirect
- 無 502 / 504 / Vercel error page

**Fail → rollback eligible** (main 還可 revert).

---

## A3.2 — `POST /api/chat` smoke

```bash
# Use a test student session cookie (Patrick: from staging session).
STUDENT_COOKIE="<test_student_session>"

curl -sX POST "$PROD_URL/api/chat" \
  -H "Cookie: $STUDENT_COOKIE" \
  -H "Content-Type: application/json" \
  -d '{"sessionId": "<test_session_id>", "message": "hello"}' \
  | jq '.error, .phase, .response | length'
```

**Pass 條件**:
- HTTP 200
- 無 `ReferenceError` (對齊 PR-23s4b hotfix 防線 — isPhaseEntry 事故 PR-23s4b/d0c66ec)
- response body 含 phase (= primary_mode, dual-write frontend compat)
- response.response 非空

**Fail → rollback eligible**.

---

## A3.3 — `GET /api/admin/v5-metrics` smoke

```bash
COACH_COOKIE="<admin_coach_session>"

curl -s "$PROD_URL/api/admin/v5-metrics" \
  -H "Cookie: $COACH_COOKIE" \
  | jq '.profile_count, .m_series_registry_summary.total_registered,
        .six_ten_signals | keys'
```

**Pass 條件**:
- HTTP 200
- `profile_count` ≥ 0 (number)
- `m_series_registry_summary.total_registered` = 47
- `m_series_registry_summary.highest_priority_count` = 4
- `six_ten_signals` 含 4 個 signal_1 ~ signal_4 keys

---

## A3.4 — Cache re-warm 確認 (Step 10 §A3 首日觀測起點)

```sql
-- Latest 5 chat_usage_log entries on production after first turn on main.
SELECT
  student_id,
  session_id,
  turn_count,
  caching_enabled,
  cache_creation,
  cache_read,
  uncached_input,
  output_tokens,
  duration_ms,
  ROUND((cache_read::numeric / NULLIF(cache_read + uncached_input, 0)) * 100, 1)
    AS cache_hit_rate_pct,
  created_at
FROM chat_usage_log
WHERE created_at > NOW() - INTERVAL '30 minutes'
ORDER BY created_at ASC
LIMIT 10;
```

**Pass 條件** (per Step 10 runbook §A3.2):

Cached prefix invalidate ONCE (this is the moment — cached §3 replacement +
v0.2 micro-patch combined). First chat turn on production after main is at
sha `216ac7b`:

- **Turn 1 (first call on new cache)**:
  - `cache_creation ≈ 5920` (new prefix write)
  - `cache_read ≈ 0`
  - `uncached_input` > 0
- **Turn 2+ (steady state on warm cache)**:
  - `cache_creation ≈ 0`
  - `cache_read ≈ 5920`
  - `cache_hit_rate_pct` ≥ 95%

**Fail signals**:
- Turn 2+ still has `cache_creation > 0` → cache breakpoint missing /
  CACHED_PREFIX section order changed
- `cache_read = 0` on Turn 2+ → prefix mismatch on subsequent calls
- `cache_hit_rate_pct` < 90% → re-warm not working

---

## 回報模板

```markdown
### v5.1 Step 11 Production Smoke (Patrick, 2026-06-05)

**Ship summary**:
- main HEAD: `216ac7b964617b78387586235fa410f220904ca8`
- merge type: fast-forward (no merge commit)
- range merged: `b0dd155..216ac7b` (112 commits)

**§A3.1 Production app homepage**:
- HTTP status: <200 / 307 / fail>
- ✅ / ❌

**§A3.2 POST /api/chat**:
- HTTP status: <200 / fail>
- No ReferenceError: ✅ / ❌
- Phase / primary_mode returned: ✅ / ❌
- Response body non-empty: ✅ / ❌

**§A3.3 GET /api/admin/v5-metrics**:
- HTTP 200: ✅ / ❌
- profile_count: <N>
- m_series total = 47: ✅ / ❌
- six_ten_signals keys count = 4: ✅ / ❌

**§A3.4 Cache re-warm (chat_usage_log)**:
- First turn cache_creation: <tokens>
- Turn 2+ cache_read: <tokens>
- Turn 2+ cache_hit_rate_pct: <%>
- Re-warm working: ✅ / ❌

**Anomalies / 500s / rollback assessment**:
- (none) / list
- Rollback required: ✅ / ❌ (if ❌, revert main to b0dd155)
```

---

## Rollback procedure (if A3 catastrophic fail)

```bash
# main was at b0dd155 before ship. To revert:
git push origin b0dd155:refs/heads/main --force-with-lease=main:216ac7b
```

⚠️ Per repo memory: NEVER `--force` on main. Use `--force-with-lease` for
safety — fails if anyone has pushed in the meantime. Only Vivi 拍板 OK to
force-push main (per pinned rule).

If `--force-with-lease` is acceptable to Vivi for this rollback scenario:
- Vercel will auto-redeploy production back to `b0dd155` content.
- Beta on #16 stays on `216ac7b` (preview branch unchanged) — no Beta impact.
- CC raises hotfix PR against the broken commit, re-tests, re-attempts ship.

---

## D. Ship 後 (Patrick 追蹤、不在本 smoke 批)

1. **§A3 Beta 首日觀測** (Vivi 6/5 拍板併入首日):
   - 真實流量看 Sonnet 行為對齊 6 mode 框架
   - Crisis override 觸發無 leaked elicitation
   - Mode 雙向流動正常 (Mode 3 → Mode 2 back, 不誤判 P21 failure)
2. **通知 wire-up** (dashboard alert + C-4 freeze email/Brevo) — 獨立任務.
3. **Phase B0 / v5.2** — 另開 branch、active_context onboarding 接 inject.
