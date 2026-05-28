// api/students.js v3
// 升級內容：
//   1. POST action=login — 後端比對 student_id + email，前端不再拿到 email
//   2. PATCH — 教練後台編輯學員（plan / tier / current_module / current_week / current_day / notes）
//   3. GET 單一學員：保留向後相容，但不再回 email（堵住洩漏）
//   4. POST（新增學員）& GET 列表 — 行為與 v2 一致
//
// 安全原則：
//   - GET 列表只給後台（前端有密碼保護），所以列表保留 email 給教練看
//   - 學員端登入只能走 POST action=login
//   - 任何 student_id 找不到 / email 對不上，統一回 401（不洩漏哪一個錯）

import { neon } from '@neondatabase/serverless';
// PR-4c-green Patrick 5/24 — coach-only gate; POST action=login intentionally
// stays open (it validates student_id + email itself, the v4-compat student
// login path). Every other method/action requires a coach OAuth session.
import { guardCoachOr401 } from '../lib/auth/coach-session.js';
// 5/25 (Vivi: 清單每個人都顯示 Day 1) — 用跟 /api/journey 詳情頁同一套天數算法
// (students.current_day 只在註冊設 1 / PATCH 才動、平常不更新).
import { computeUnlockedCurrentDay } from '../lib/api/journey-state.js';

// v3.0 雙方案 plan enum（對齊 migration 007 + DB CHECK constraint students_plan_check）
const VALID_PLANS = new Set(['trial', 'plan_a', 'plan_b']);

// Test seam — inject a mock tag-template sql client.
let _sql = null;
export function _setSqlClient(client) { _sql = client; }
function getSql() {
  if (_sql) return _sql;
  return neon(process.env.DATABASE_URL);
}

export default async function handler(req, res) {
  const sql = getSql();

  try {
    // ===========================================================
    // POST — coach-only (create student).
    //   PR-4c-green Auth rebuild stage 1d retired the v4-compat
    //   `POST action=login` student-login path. Student login is now
    //   handled exclusively by /api/auth/request-link + /api/auth/verify-link
    //   (magic link). Any POST without a coach session → 401.
    // ===========================================================
    if (req.method === 'POST') {
      if (!(await guardCoachOr401(req, res))) return;

      const email = String(req.body.email || '').trim().toLowerCase();
      const plan = req.body.plan || 'trial';
      const tier = parseInt(req.body.tier ?? 0, 10);
      const notes = String(req.body.notes || '').trim();

      // v3.0: plan enum 驗證（DB CHECK 也擋、這層拒絕舊值給 friendly 400）
      if (!VALID_PLANS.has(plan)) {
        return res.status(400).json({
          error: 'INVALID_PLAN',
          message: `plan 必須是 trial / plan_a / plan_b 其中之一（收到：${plan}）`,
        });
      }

      // email 重複檢查
      if (email) {
        const dup = await sql`
          SELECT student_id FROM students WHERE LOWER(email) = ${email}
        `;
        if (dup.length > 0) {
          return res.status(409).json({
            error: 'EMAIL_EXISTS',
            message: `這個 email 已建立過學員（${dup[0].student_id}）`,
          });
        }
      }

      // 自動生成編號（A001, A002, ...）
      const last = await sql`
        SELECT student_id FROM students
        WHERE student_id ~ '^A[0-9]{3}$'
        ORDER BY student_id DESC LIMIT 1
      `;
      let nextId = 'A001';
      if (last.length > 0) {
        const n = parseInt(last[0].student_id.slice(1), 10) + 1;
        nextId = 'A' + String(n).padStart(3, '0');
      }

      await sql`
        INSERT INTO students
          (student_id, email, plan, tier, current_module, current_week, current_day, notes, created_at)
        VALUES
          (${nextId}, ${email || null}, ${plan}, ${tier}, 'self', 1, 1, ${notes || null}, NOW())
      `;

      return res.status(200).json({ success: true, studentId: nextId });
    }

    // ===========================================================
    // PATCH — 教練後台編輯學員
    //   接受 partial update：只送什麼就改什麼
    //   notes 允許清空（傳空字串會存成 null）
    // ===========================================================
    if (req.method === 'PATCH') {
      // PR-4c-green Patrick 5/24 — coach-only.
      if (!(await guardCoachOr401(req, res))) return;
      const studentId = String(req.body.studentId || '').toUpperCase().trim();
      if (!/^[A-Z]\d{3}$/.test(studentId)) {
        return res.status(400).json({ error: 'INVALID_STUDENT_ID' });
      }

      // 取出可更新欄位（undefined 表示前端沒送 → 不動）
      const plan = req.body.plan;
      const tier = req.body.tier !== undefined ? parseInt(req.body.tier, 10) : undefined;
      const cm = req.body.current_module;
      const cw = req.body.current_week !== undefined ? parseInt(req.body.current_week, 10) : undefined;
      const cd = req.body.current_day !== undefined ? parseInt(req.body.current_day, 10) : undefined;
      // notes 特別處理：空字串 → null（允許清空）；undefined → 不動
      const notesRaw = req.body.notes;
      const notes = notesRaw === undefined
        ? undefined
        : (String(notesRaw).trim() || null);

      // 5/27 Patrick — 教練後台「編輯資料」 加 pace / preferred_name / is_beta.
      const pace = req.body.pace;
      const preferredNameRaw = req.body.preferred_name;
      const isBeta = req.body.is_beta !== undefined ? !!req.body.is_beta : undefined;

      // v3.0: plan 如果有送、必須是合法 enum（PATCH 是 partial update、沒送就略過）
      if (plan !== undefined && !VALID_PLANS.has(plan)) {
        return res.status(400).json({
          error: 'INVALID_PLAN',
          message: `plan 必須是 trial / plan_a / plan_b 其中之一（收到：${plan}）`,
        });
      }
      // pace 驗證：合法值只有 'daily' | 'self-paced'.
      if (pace !== undefined && pace !== 'daily' && pace !== 'self-paced') {
        return res.status(400).json({
          error: 'INVALID_PACE',
          message: `pace 必須是 daily / self-paced（收到：${pace}）`,
        });
      }
      // preferred_name：trim、長度 0-50；空字串視為清空（→ null）.
      let prefSan;
      if (preferredNameRaw !== undefined) {
        const trimmed = String(preferredNameRaw).trim();
        if (trimmed.length > 50) {
          return res.status(400).json({ error: 'PREFERRED_NAME_TOO_LONG' });
        }
        prefSan = trimmed.length === 0 ? null : trimmed;
      }

      // 確認學員存在
      const exists = await sql`SELECT student_id FROM students WHERE student_id = ${studentId}`;
      if (exists.length === 0) {
        return res.status(404).json({ error: 'NOT_FOUND' });
      }

      // 用 COALESCE 模擬 partial update
      // 對 notes / preferred_name 來說：傳 null 就是清空、undefined 就保留原值
      // 注意：sql tagged template 不能 dynamic build、這裡一次性更新所有欄位、
      // 沒送的欄位用 COALESCE(送進來的 ?? null, 原值) 維持原樣
      // notes / preferred_name 因為要支援清空、所以另外處理.
      await sql`
        UPDATE students SET
          plan           = COALESCE(${plan ?? null}, plan),
          tier           = COALESCE(${tier ?? null}, tier),
          current_module = COALESCE(${cm ?? null}, current_module),
          current_week   = COALESCE(${cw ?? null}, current_week),
          current_day    = COALESCE(${cd ?? null}, current_day),
          pace           = COALESCE(${pace ?? null}, pace),
          is_beta        = COALESCE(${isBeta ?? null}, is_beta)
        WHERE student_id = ${studentId}
      `;

      // notes 單獨更新（支援清空）
      if (notes !== undefined) {
        await sql`UPDATE students SET notes = ${notes} WHERE student_id = ${studentId}`;
      }
      // preferred_name 單獨更新（支援清空成 null）
      if (prefSan !== undefined) {
        await sql`UPDATE students SET preferred_name = ${prefSan} WHERE student_id = ${studentId}`;
      }

      return res.status(200).json({ success: true });
    }

    // ===========================================================
    // GET
    //   - 無參數 → 後台列表（含 email，因為後台有密碼保護）
    //   - ?studentId=A001 → 單一學員（向後相容；不再回 email）
    // ===========================================================
    if (req.method === 'GET') {
      // PR-4c-green Patrick 5/24 — coach-only (list contains email + can enumerate
      // every student; single-student GET also coach-side, student SPA never
      // hits this — student login uses /api/auth/request-link + verify-link).
      if (!(await guardCoachOr401(req, res))) return;
      const studentId = req.query.studentId
        ? String(req.query.studentId).toUpperCase().trim()
        : null;

      // ---------- 單一學員（向後相容） ----------
      // 5/27 Patrick — 教練後台「編輯資料」 需要 pace / preferred_name / is_beta 回填,
      // SELECT 一併帶回 (仍刻意不回 email / notes、v3 安全設計不動).
      if (studentId) {
        const rows = await sql`
          SELECT student_id, current_module, current_week, current_day,
                 plan, tier, pace, preferred_name, is_beta
          FROM students
          WHERE student_id = ${studentId}
        `;
        if (rows.length === 0) return res.status(404).json({ error: 'NOT_FOUND' });
        return res.status(200).json({ student: rows[0] });
        // 注意：故意不回 email、不回 notes，避免前端洩漏敏感資訊
      }

      // ---------- 後台列表 ----------
      // 主表用 SELECT * 避開欄位猜測——學員列表一定能出來
      let students = [];
      try {
        students = await sql`SELECT * FROM students ORDER BY created_at DESC`;
      } catch (e0) {
        // 連 created_at 都可能不存在，最後降級：完全不排序
        console.warn('students ORDER BY created_at failed, falling back:', e0.message);
        students = await sql`SELECT * FROM students`;
      }

      // 再嘗試補 sessions 統計（schema 可能不同，失敗就降級不補）
      // 實際 schema：sessions 表用 day_complete (boolean) 標記完成
      let stats = {};
      try {
        const rows = await sql`
          SELECT student_id,
                 COUNT(*) FILTER (WHERE day_complete = TRUE) AS days_completed,
                 MAX(updated_at) AS last_active
          FROM sessions
          GROUP BY student_id
        `;
        for (const r of rows) {
          stats[r.student_id] = {
            days_completed: Number(r.days_completed) || 0,
            last_active: r.last_active,
          };
        }
      } catch (e1) {
        // schema 不符，最後降級用 created_at
        try {
          const rows = await sql`
            SELECT student_id,
                   COUNT(*) AS days_completed,
                   MAX(created_at) AS last_active
            FROM sessions
            GROUP BY student_id
          `;
          for (const r of rows) {
            stats[r.student_id] = {
              days_completed: Number(r.days_completed) || 0,
              last_active: r.last_active,
            };
          }
        } catch (e2) {
          console.warn('sessions stats query failed:', e2.message);
        }
      }

      // current_day per student — 跟 /api/journey 詳情頁同一套算法
      // (computeUnlockedCurrentDay). 5/25 (Vivi: 清單每個人都顯示 Day 1) — 不要再讀
      // students.current_day（那欄只在註冊設 1 / 教練手動 PATCH 才動、平常不會更新）.
      let dayInfo = {};   // student_id → { sessionDayCount, lastComplete }
      try {
        // ⚠️ user_profile_evolution 是 keyed by student_id only、無 module 欄位
        // (見 state-manager.js getUserProfile: `WHERE student_id = ...`).
        // 5/26 Patrick 查到的 bug — 上一份 spec 寫 `WHERE module = 'self'` 拋
        // 「column "module" does not exist」、整個 try 被 catch、dayInfo={}、
        // 全部 fallback 到 stale 的 students.current_day(=1) → 全清單都 Day 1.
        const upe = await sql`
          SELECT student_id, session_day_count
          FROM user_profile_evolution
        `;
        for (const r of upe) {
          dayInfo[r.student_id] = {
            sessionDayCount: Number(r.session_day_count) || 0,
            lastComplete: false,
          };
        }
        const lastSess = await sql`
          SELECT DISTINCT ON (student_id) student_id, day_complete
          FROM sessions WHERE module = 'self'
          ORDER BY student_id, created_at DESC
        `;
        for (const r of lastSess) {
          if (!dayInfo[r.student_id]) {
            dayInfo[r.student_id] = { sessionDayCount: 0, lastComplete: false };
          }
          dayInfo[r.student_id].lastComplete = !!r.day_complete;
        }
      } catch (eDay) {
        console.warn('students effective_day compute failed, falling back to stored current_day:', eDay.message);
      }

      const merged = students.map(s => {
        const di = dayInfo[s.student_id];
        const effective_day = di
          ? computeUnlockedCurrentDay({
              pace: s.pace || 'daily',
              sessionDayCount: di.sessionDayCount,
              lastSessionComplete: di.lastComplete,
            })
          : (s.current_day ?? 1);
        return {
          ...s,
          effective_day,
          days_completed: stats[s.student_id]?.days_completed ?? 0,
          last_active: stats[s.student_id]?.last_active ?? null,
        };
      });

      return res.status(200).json({ students: merged });
    }

    return res.status(405).json({ error: 'METHOD_NOT_ALLOWED' });
  } catch (e) {
    console.error('students api error:', e);
    return res.status(500).json({ error: 'SERVER_ERROR', message: e.message });
  }
}
