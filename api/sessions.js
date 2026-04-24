import { neon } from '@neondatabase/serverless';

export default async function handler(req, res) {
  const sql = neon(process.env.DATABASE_URL);

  // GET - 取得所有學員或特定學員的對話
  if (req.method === 'GET') {
    const { studentName, module, week, action } = req.query;

    try {
      // 取得特定session的完整對話
      if (action === 'messages' && studentName && module && week) {
        const sessions = await sql`
          SELECT s.id, s.student_name, s.module, s.week, s.session_notes, s.updated_at
          FROM sessions s
          WHERE s.student_name = ${studentName}
            AND s.module = ${module}
            AND s.week = ${parseInt(week)}
          ORDER BY s.updated_at DESC
          LIMIT 1
        `;

        if (sessions.length === 0) {
          return res.status(200).json({ session: null, messages: [] });
        }

        const session = sessions[0];
        const messages = await sql`
          SELECT role, content, question_number, created_at
          FROM messages
          WHERE session_id = ${session.id}
          ORDER BY created_at ASC
        `;

        return res.status(200).json({ session, messages });
      }

      // 取得所有學員列表
      const sessions = await sql`
        SELECT 
          s.id,
          s.student_name,
          s.module,
          s.week,
          s.updated_at,
          COUNT(m.id) FILTER (WHERE m.role = 'user') as answer_count,
          MAX(m.content) FILTER (WHERE m.role = 'user') as last_answer
        FROM sessions s
        LEFT JOIN messages m ON m.session_id = s.id
        GROUP BY s.id, s.student_name, s.module, s.week, s.updated_at
        ORDER BY s.updated_at DESC
      `;

      return res.status(200).json({ sessions });

    } catch (error) {
      console.error('GET error:', error);
      return res.status(500).json({ error: error.message });
    }
  }

  // POST - 儲存訊息
  if (req.method === 'POST') {
    const { studentName, module, week, sessionNotes, role, content, questionNumber } = req.body;

    try {
      // 找或建立session
      let sessions = await sql`
        SELECT id FROM sessions
        WHERE student_name = ${studentName}
          AND module = ${module}
          AND week = ${parseInt(week)}
        LIMIT 1
      `;

      let sessionId;
      if (sessions.length === 0) {
        const newSession = await sql`
          INSERT INTO sessions (student_name, module, week, session_notes)
          VALUES (${studentName}, ${module}, ${parseInt(week)}, ${sessionNotes || ''})
          RETURNING id
        `;
        sessionId = newSession[0].id;
      } else {
        sessionId = sessions[0].id;
        await sql`
          UPDATE sessions SET updated_at = NOW()
          WHERE id = ${sessionId}
        `;
      }

      // 儲存訊息
      await sql`
        INSERT INTO messages (session_id, role, content, question_number)
        VALUES (${sessionId}, ${role}, ${content}, ${questionNumber || 0})
      `;

      return res.status(200).json({ success: true, sessionId });

    } catch (error) {
      console.error('POST error:', error);
      return res.status(500).json({ error: error.message });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
