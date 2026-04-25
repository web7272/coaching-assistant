import { neon } from '@neondatabase/serverless';

export default async function handler(req, res) {
  const sql = neon(process.env.DATABASE_URL);

  // GET - 取得學員資料
  if (req.method === 'GET') {
    const { studentId, module, week, action } = req.query;

    try {
      // 取得今天的 session 狀態
      if (action === 'today' && studentId && module && week) {
        const today = new Date().toISOString().split('T')[0];
        const sessions = await sql`
          SELECT s.*, 
            (SELECT COUNT(*) FROM messages m WHERE m.session_id = s.id AND m.role = 'user') as message_count
          FROM sessions s
          WHERE s.student_id = ${studentId}
            AND s.module = ${module}
            AND s.week = ${parseInt(week)}
            AND s.session_date = ${today}
          LIMIT 1
        `;

        if (sessions.length === 0) {
          // 計算今天是第幾天
          const allDays = await sql`
            SELECT COUNT(*) as day_count
            FROM sessions
            WHERE student_id = ${studentId}
              AND module = ${module}
              AND week = ${parseInt(week)}
          `;
          const dayNumber = parseInt(allDays[0].day_count) + 1;
          return res.status(200).json({ session: null, dayNumber, questionsToday: 0 });
        }

        return res.status(200).json({
          session: sessions[0],
          dayNumber: sessions[0].day,
          questionsToday: parseInt(sessions[0].questions_today),
          dayComplete: sessions[0].day_complete
        });
      }

      // 取得完整對話歷史（跨所有天）
      if (action === 'history' && studentId && module && week) {
        const allSessions = await sql`
          SELECT s.id, s.day, s.session_date, s.questions_today, s.day_complete
          FROM sessions s
          WHERE s.student_id = ${studentId}
            AND s.module = ${module}
            AND s.week = ${parseInt(week)}
          ORDER BY s.session_date ASC
        `;

        if (allSessions.length === 0) {
          return res.status(200).json({ sessions: [], messages: [] });
        }

        const sessionIds = allSessions.map(s => s.id);
        const messages = await sql`
          SELECT m.*, s.day, s.session_date
          FROM messages m
          JOIN sessions s ON m.session_id = s.id
          WHERE m.session_id = ANY(${sessionIds})
          ORDER BY m.created_at ASC
        `;

        return res.status(200).json({ sessions: allSessions, messages });
      }

      // 取得所有學員列表（教練後台用）
      const allStudents = await sql`
        SELECT 
          s.student_id,
          s.module,
          s.week,
          MAX(s.session_date) as last_active,
          COUNT(DISTINCT s.session_date) as days_completed,
          SUM(s.questions_today) as total_questions,
          (
            SELECT m.content 
            FROM messages m 
            JOIN sessions s2 ON m.session_id = s2.id 
            WHERE s2.student_id = s.student_id 
              AND s2.module = s.module 
              AND s2.week = s.week
              AND m.role = 'user'
            ORDER BY m.created_at DESC 
            LIMIT 1
          ) as last_answer
        FROM sessions s
        GROUP BY s.student_id, s.module, s.week
        ORDER BY last_active DESC
      `;

      return res.status(200).json({ sessions: allStudents });

    } catch (error) {
      console.error('GET error:', error);
      return res.status(500).json({ error: error.message });
    }
  }

  // POST - 建立或更新今天的 session
  if (req.method === 'POST') {
    const { studentId, module, week, sessionNotes, role, content, questionNumber, dayNumber } = req.body;

    try {
      const today = new Date().toISOString().split('T')[0];

      // 找或建立今天的 session
      let sessions = await sql`
        SELECT id, questions_today FROM sessions
        WHERE student_id = ${studentId}
          AND module = ${module}
          AND week = ${parseInt(week)}
          AND session_date = ${today}
        LIMIT 1
      `;

      let sessionId;
      if (sessions.length === 0) {
        const newSession = await sql`
          INSERT INTO sessions (student_id, module, week, day, session_date, session_notes, questions_today)
          VALUES (${studentId}, ${module}, ${parseInt(week)}, ${dayNumber || 1}, ${today}, ${sessionNotes || ''}, 0)
          RETURNING id
        `;
        sessionId = newSession[0].id;
      } else {
        sessionId = sessions[0].id;
        await sql`UPDATE sessions SET updated_at = NOW() WHERE id = ${sessionId}`;
      }

      // 儲存訊息
      await sql`
        INSERT INTO messages (session_id, role, content, question_number)
        VALUES (${sessionId}, ${role}, ${content}, ${questionNumber || 0})
      `;

      // 如果是學員回答，更新今日題數
      if (role === 'user') {
        await sql`
          UPDATE sessions 
          SET questions_today = questions_today + 1,
              updated_at = NOW()
          WHERE id = ${sessionId}
        `;
      }

      return res.status(200).json({ success: true, sessionId });

    } catch (error) {
      console.error('POST error:', error);
      return res.status(500).json({ error: error.message });
    }
  }

  // PATCH - 標記今天完成
  if (req.method === 'PATCH') {
    const { studentId, module, week } = req.body;
    const today = new Date().toISOString().split('T')[0];

    try {
      await sql`
        UPDATE sessions 
        SET day_complete = TRUE, updated_at = NOW()
        WHERE student_id = ${studentId}
          AND module = ${module}
          AND week = ${parseInt(week)}
          AND session_date = ${today}
      `;
      return res.status(200).json({ success: true });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
