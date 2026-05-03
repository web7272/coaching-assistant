import { neon } from '@neondatabase/serverless';

async function generateStudentId(sql) {
  const result = await sql`
    SELECT student_id FROM students ORDER BY created_at DESC LIMIT 1
  `;
  if (result.length === 0) return 'A001';
  const last = result[0].student_id;
  const letter = last[0];
  const num = parseInt(last.slice(1));
  if (num >= 999) {
    return `${String.fromCharCode(letter.charCodeAt(0) + 1)}001`;
  }
  return `${letter}${String(num + 1).padStart(3, '0')}`;
}

export default async function handler(req, res) {
  const sql = neon(process.env.DATABASE_URL);

  if (req.method === 'GET') {
    const { studentId } = req.query;
    try {
      if (studentId) {
        const students = await sql`
          SELECT student_id, email, plan, tier, current_module, current_week, current_day,
                 self_week_completed, money_unlocked, relationship_unlocked
          FROM students WHERE student_id = ${studentId.toUpperCase()} LIMIT 1
        `;
        if (students.length === 0) return res.status(404).json({ error: 'Student not found' });
        return res.status(200).json({ student: students[0] });
      }

      const students = await sql`
        SELECT s.*,
          (SELECT COUNT(*) FROM sessions se WHERE se.student_id = s.student_id AND se.day_complete = TRUE) as days_completed,
          (SELECT MAX(se.session_date) FROM sessions se WHERE se.student_id = s.student_id) as last_active
        FROM students s ORDER BY s.created_at DESC
      `;
      return res.status(200).json({ students });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  }

  if (req.method === 'POST') {
    const { email, plan, tier, notes } = req.body;
    try {
      // 檢查 email 是否已存在（如果有填 email）
      if (email && email.trim()) {
        const existing = await sql`
          SELECT student_id FROM students WHERE email = ${email.trim().toLowerCase()} LIMIT 1
        `;
        if (existing.length > 0) {
          return res.status(400).json({
            error: 'EMAIL_EXISTS',
            message: `這個 email 已經有學員編號了：${existing[0].student_id}`,
            existingId: existing[0].student_id
          });
        }
      }

      const studentId = await generateStudentId(sql);
      const normalizedEmail = email?.trim().toLowerCase() || '';

      await sql`
        INSERT INTO students (student_id, email, plan, tier, current_module, current_week, current_day, notes)
        VALUES (${studentId}, ${normalizedEmail}, ${plan || 'trial'}, ${tier || 0}, 'self', 1, 1, ${notes || ''})
      `;
      return res.status(200).json({ success: true, studentId });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  }

  if (req.method === 'PATCH') {
    const { studentId, plan, tier, current_module, current_week, current_day,
            money_unlocked, relationship_unlocked, notes } = req.body;
    if (!studentId) return res.status(400).json({ error: 'Missing studentId' });
    try {
      await sql`
        UPDATE students SET
          plan = COALESCE(${plan}, plan),
          tier = COALESCE(${tier}, tier),
          current_module = COALESCE(${current_module}, current_module),
          current_week = COALESCE(${current_week}, current_week),
          current_day = COALESCE(${current_day}, current_day),
          money_unlocked = COALESCE(${money_unlocked}, money_unlocked),
          relationship_unlocked = COALESCE(${relationship_unlocked}, relationship_unlocked),
          notes = COALESCE(${notes}, notes),
          updated_at = NOW()
        WHERE student_id = ${studentId.toUpperCase()}
      `;
      return res.status(200).json({ success: true });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  }

  if (req.method === 'DELETE') {
    const { studentId } = req.query;
    if (!studentId) return res.status(400).json({ error: 'Missing studentId' });
    try {
      await sql`DELETE FROM students WHERE student_id = ${studentId.toUpperCase()}`;
      return res.status(200).json({ success: true });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
