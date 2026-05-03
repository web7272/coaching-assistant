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

export default async function handler(req, res) {
  const sql = neon(process.env.DATABASE_URL);

  try {
    // ===========================================================
    // POST
    //   - body.action === 'login' → 學員登入驗證
    //   - 其他 → 新增學員（教練後台）
    // ===========================================================
    if (req.method === 'POST') {
      const action = (req.body && req.body.action) || null;

      // ---------- 學員登入 ----------
      if (action === 'login') {
        const studentId = String(req.body.studentId || '').toUpperCase().trim();
        const email = String(req.body.email || '').toLowerCase().trim();

        // 格式檢查
        if (!/^[A-Z]\d{3}$/.test(studentId) || !email || !email.includes('@')) {
          return res.status(400).json({ error: 'INVALID_INPUT' });
        }

        const rows = await sql`
          SELECT student_id, email, current_module, current_week, current_day, plan, tier
          FROM students
          WHERE student_id = ${studentId}
        `;

        // 統一錯誤訊息：不告訴對方是 ID 錯還是 email 錯
        if (rows.length === 0) {
          return res.status(401).json({ error: 'AUTH_FAILED' });
        }

        const stored = String(rows[0].email || '').toLowerCase().trim();

        // 強制要求學員必須有 email 並完全比對
        if (!stored || stored !== email) {
          return res.status(401).json({ error: 'AUTH_FAILED' });
        }

        // 通過：回學員資料（不回 email，前端不需要存）
        const s = rows[0];
        return res.status(200).json({
          student: {
            student_id: s.student_id,
            current_module: s.current_module,
            current_week: s.current_week,
            current_day: s.current_day,
            plan: s.plan,
            tier: s.tier,
          },
        });
      }

      // ---------- 新增學員（教練後台） ----------
      const email = String(req.body.email || '').trim().toLowerCase();
      const plan = req.body.plan || 'trial';
      const tier = parseInt(req.body.tier ?? 0, 10);
      const notes = String(req.body.notes || '').trim();

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

      // 確認學員存在
      const exists = await sql`SELECT student_id FROM students WHERE student_id = ${studentId}`;
      if (exists.length === 0) {
        return res.status(404).json({ error: 'NOT_FOUND' });
      }

      // 用 COALESCE 模擬 partial update
      // 對 notes 來說：傳 null 就是清空、undefined 就保留原值
      // 注意：sql tagged template 不能 dynamic build，這裡一次性更新所有欄位，
      // 沒送的欄位用 COALESCE(送進來的 ?? null, 原值) 維持原樣
      // notes 因為要支援清空，所以另外處理
      await sql`
        UPDATE students SET
          plan           = COALESCE(${plan ?? null}, plan),
          tier           = COALESCE(${tier ?? null}, tier),
          current_module = COALESCE(${cm ?? null}, current_module),
          current_week   = COALESCE(${cw ?? null}, current_week),
          current_day    = COALESCE(${cd ?? null}, current_day)
        WHERE student_id = ${studentId}
      `;

      // notes 單獨更新（支援清空）
      if (notes !== undefined) {
        await sql`UPDATE students SET notes = ${notes} WHERE student_id = ${studentId}`;
      }

      return res.status(200).json({ success: true });
    }

    // ===========================================================
    // GET
    //   - 無參數 → 後台列表（含 email，因為後台有密碼保護）
    //   - ?studentId=A001 → 單一學員（向後相容；不再回 email）
    // ===========================================================
    if (req.method === 'GET') {
      const studentId = req.query.studentId
        ? String(req.query.studentId).toUpperCase().trim()
        : null;

      // ---------- 單一學員（向後相容） ----------
      if (studentId) {
        const rows = await sql`
          SELECT student_id, current_module, current_week, current_day, plan, tier
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

      const merged = students.map(s => ({
        ...s,
        days_completed: stats[s.student_id]?.days_completed ?? 0,
        last_active: stats[s.student_id]?.last_active ?? null,
      }));

      return res.status(200).json({ students: merged });
    }

    return res.status(405).json({ error: 'METHOD_NOT_ALLOWED' });
  } catch (e) {
    console.error('students api error:', e);
    return res.status(500).json({ error: 'SERVER_ERROR', message: e.message });
  }
}
