import { neon } from '@neondatabase/serverless';

const DAMON_SYSTEM_PROMPT = `你是 Damon Cart，一個 Self Concept 教練。
你剛完成了一段和學員的對話。

請用教練的視角觀察這段對話，寫下你的 Damon Note。
語氣簡潔、精準、像教練的私房筆記。

格式如下（嚴格按照這個格式，每個區塊用標題分開）：

【今天的模式】
學員今天反覆出現的詞或主題是什麼？用2-3句描述。

【深度層次】
今天最深走到哪裡？（Layer 1-5，Layer 1=表層事件，Layer 2=感受，Layer 3=價值，Layer 4=身份，Layer 5=核心信念）
學員在哪裡停住了？

【關鍵句】
今天學員說出來最重要的一句話。
用學員的原話，加引號，不改動。

【SC 觀察】
從今天的對話，你觀察到學員目前的 Self Concept 是什麼？
她如何看待自己？什麼信念在驅動她的選擇？
這是教練的假設性觀察，不是判斷，不給學員看。

【還沒碰到的】
今天還有哪個地方值得繼續挖，但還沒有碰到？

【明天的入口】
明天建議從哪裡繼續？寫一個具體的問句，可以直接問學員的那種。

注意：
- 不給答案
- 不重寫信念
- SC 觀察是假設，不是判斷
- 用教練的語氣，不是分析師的語氣
- 每個區塊簡短有力，總長度不超過400字`;

export default async function handler(req, res) {
  if (req.method === 'GET') {
    // 取得某天的 Damon Note
    const { studentId, module, week, date } = req.query;
    if (!studentId || !module || !week) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    try {
      const sql = neon(process.env.DATABASE_URL);
      const targetDate = date || new Date().toISOString().split('T')[0];

      const sessions = await sql`
        SELECT damon_note, damon_note_public, day, session_date
        FROM sessions
        WHERE student_id = ${studentId}
          AND module = ${module}
          AND week = ${parseInt(week)}
          AND session_date = ${targetDate}
        LIMIT 1
      `;

      if (sessions.length === 0) {
        return res.status(200).json({ note: null, notePublic: null });
      }

      return res.status(200).json({
        note: sessions[0].damon_note,
        notePublic: sessions[0].damon_note_public,
        day: sessions[0].day,
        date: sessions[0].session_date
      });

    } catch (error) {
      console.error('GET note error:', error);
      return res.status(500).json({ error: error.message });
    }
  }

  if (req.method === 'POST') {
    // 生成今天的 Damon Note
    const { studentId, module, week, day } = req.body;
    if (!studentId || !module || !week) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    try {
      const sql = neon(process.env.DATABASE_URL);
      const today = new Date().toISOString().split('T')[0];

      // 取得今天的 session
      const sessions = await sql`
        SELECT id FROM sessions
        WHERE student_id = ${studentId}
          AND module = ${module}
          AND week = ${parseInt(week)}
          AND session_date = ${today}
        LIMIT 1
      `;

      if (sessions.length === 0) {
        return res.status(404).json({ error: 'Session not found' });
      }

      const sessionId = sessions[0].id;

      // 取得今天所有對話
      const messages = await sql`
        SELECT role, content, created_at
        FROM messages
        WHERE session_id = ${sessionId}
          AND role IN ('user', 'assistant')
        ORDER BY created_at ASC
      `;

      if (messages.length < 2) {
        return res.status(200).json({ note: null, message: 'Not enough messages' });
      }

      // 整理對話記錄給 Claude
      const moduleLabel = module === 'self' ? '自我關係' : module === 'money' ? '金錢關係' : '伴侶關係';
      const conversationText = messages.map(m =>
        `${m.role === 'user' ? '【學員】' : '【AI教練】'} ${m.content}`
      ).join('\n\n');

      const userPrompt = `以下是今天的完整對話記錄。
模組：${moduleLabel}，第 ${week} 週，第 ${day} 天。

${conversationText}

請寫下今天的 Damon Note。`;

      // 呼叫 Claude 生成 Damon Note
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': process.env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-6',
          max_tokens: 800,
          system: DAMON_SYSTEM_PROMPT,
          messages: [{ role: 'user', content: userPrompt }]
        })
      });

      if (!response.ok) {
        throw new Error('Claude API failed');
      }

      const data = await response.json();
      const fullNote = data.content[0].text;

      // 從完整 Note 抽取給學員看的部分（關鍵句 + 明天的入口）
      const keyPhraseMatch = fullNote.match(/【關鍵句】\s*\n([\s\S]*?)(?=\n【|$)/);
      const tomorrowMatch = fullNote.match(/【明天的入口】\s*\n([\s\S]*?)(?=\n【|$)/);

      const keyPhrase = keyPhraseMatch ? keyPhraseMatch[1].trim() : '';
      const tomorrowEntry = tomorrowMatch ? tomorrowMatch[1].trim() : '';

      const publicNote = `今天你說了一句很重要的話：\n${keyPhrase}\n\n明天我們從這裡繼續——\n${tomorrowEntry}`;

      // 存入資料庫
      await sql`
        UPDATE sessions
        SET damon_note = ${fullNote},
            damon_note_public = ${publicNote},
            updated_at = NOW()
        WHERE id = ${sessionId}
      `;

      return res.status(200).json({
        success: true,
        notePublic: publicNote,
        note: fullNote
      });

    } catch (error) {
      console.error('POST note error:', error);
      return res.status(500).json({ error: error.message });
    }
  }

  // 取得昨天的 Note（給隔天 system prompt 用）
  if (req.method === 'PUT') {
    const { studentId, module, week } = req.body;

    try {
      const sql = neon(process.env.DATABASE_URL);
      const today = new Date().toISOString().split('T')[0];

      // 取得最近一天（今天之前）的 Damon Note
      const notes = await sql`
        SELECT damon_note, damon_note_public, day, session_date
        FROM sessions
        WHERE student_id = ${studentId}
          AND module = ${module}
          AND week = ${parseInt(week)}
          AND session_date < ${today}
          AND damon_note IS NOT NULL
        ORDER BY session_date DESC
        LIMIT 1
      `;

      if (notes.length === 0) {
        return res.status(200).json({ note: null });
      }

      return res.status(200).json({
        note: notes[0].damon_note,
        notePublic: notes[0].damon_note_public,
        day: notes[0].day,
        date: notes[0].session_date
      });

    } catch (error) {
      console.error('PUT note error:', error);
      return res.status(500).json({ error: error.message });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
