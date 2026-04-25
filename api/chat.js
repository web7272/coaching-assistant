import { neon } from '@neondatabase/serverless';

const MAX_QUESTIONS = 8;

// 週五的特殊問句邏輯
function getDayFivePromptAddition(questionNumber, module) {
  if (questionNumber === 6) {
    return `\n\n重要：這是今天第7題（週五落地問句）。請問這個問題：「在${module}這個面向裡，你是一個什麼樣的人？用你自己的話說出來。」不要問其他問題，就問這一個。`;
  }
  if (questionNumber === 7) {
    return `\n\n重要：這是今天第8題（週五作業題）。請給學員一個這週末要思考的作業問題，格式是：「這週的作業是：___」然後給一個讓他帶著走的深度問題，讓他週末思考。問完之後說：「我們下週一繼續。」`;
  }
  return '';
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const {
    systemPrompt, messages, studentId, module, week,
    sessionNotes, questionNumber, dayNumber
  } = req.body;

  if (!systemPrompt || !messages) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  // 每天限制8題
  if (questionNumber >= MAX_QUESTIONS) {
    // 標記今天完成
    if (studentId && module && week) {
      try {
        const sql = neon(process.env.DATABASE_URL);
        const today = new Date().toISOString().split('T')[0];
        await sql`
          UPDATE sessions 
          SET day_complete = TRUE, updated_at = NOW()
          WHERE student_id = ${studentId}
            AND module = ${module}
            AND week = ${parseInt(week)}
            AND session_date = ${today}
        `;
      } catch(e) { console.error('Update error:', e); }
    }

    return res.status(200).json({
      content: getDayEndMessage(questionNumber, dayNumber),
      dayComplete: true,
      questionNumber
    });
  }

  try {
    const sql = neon(process.env.DATABASE_URL);
    const today = new Date().toISOString().split('T')[0];

    // 找或建立今天的 session
    let sessions = await sql`
      SELECT id FROM sessions
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
    }

    // 儲存學員訊息
    const userMessage = messages[messages.length - 1];
    if (userMessage && userMessage.role === 'user') {
      await sql`
        INSERT INTO messages (session_id, role, content, question_number)
        VALUES (${sessionId}, 'user', ${userMessage.content}, ${questionNumber})
      `;
      await sql`
        UPDATE sessions 
        SET questions_today = questions_today + 1, updated_at = NOW()
        WHERE id = ${sessionId}
      `;
    }

    // 週五特殊邏輯
    const isFriday = dayNumber === 5;
    const dayFiveAddition = isFriday ? getDayFivePromptAddition(questionNumber, module) : '';
    const finalSystemPrompt = systemPrompt + dayFiveAddition;

    // 呼叫 Claude API
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 1000,
        system: finalSystemPrompt,
        messages: messages
      })
    });

    if (!response.ok) {
      const error = await response.text();
      console.error('Anthropic API error:', error);
      return res.status(500).json({ error: 'API call failed' });
    }

    const data = await response.json();
    const content = data.content[0].text;

    // 儲存助理回覆
    await sql`
      INSERT INTO messages (session_id, role, content, question_number)
      VALUES (${sessionId}, 'assistant', ${content}, ${questionNumber})
    `;

    const newQuestionNumber = questionNumber + 1;
    const dayComplete = newQuestionNumber >= MAX_QUESTIONS;

    // 如果今天完成，標記完成
    if (dayComplete) {
      await sql`
        UPDATE sessions 
        SET day_complete = TRUE, updated_at = NOW()
        WHERE id = ${sessionId}
      `;
    }

    return res.status(200).json({
      content,
      questionNumber: newQuestionNumber,
      dayComplete,
      questionsLeft: MAX_QUESTIONS - newQuestionNumber
    });

  } catch (error) {
    console.error('Server error:', error);
    return res.status(500).json({ error: 'Server error' });
  }
}

function getDayEndMessage(questionNumber, dayNumber) {
  const isWeekEnd = dayNumber === 5;

  if (isWeekEnd) {
    return `今天是本週最後一天的探索。\n\n你這週走了很深的路。讓這些答案在週末沉澱，帶著作業去思考。\n\n下週一，我們從你想到的開始繼續。🌿`;
  }

  return `今天的探索先到這裡。\n\n你今天挖出了很多重要的東西。讓這些答案在心裡沉澱一天。\n\n明天我們繼續往更深的地方走。🌿`;
}
