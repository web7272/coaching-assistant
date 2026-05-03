import { neon } from '@neondatabase/serverless';

const MAX_TURNS = 10;
const MAX_MINUTES = 15;

const WEEK_GOALS = {
  self: {
    1: {
      goal: '從「不對勁」切入，找到學員真正在追求的東西，挖出初版價值觀清單，走到第一版 Self Concept。',
      collect: ['value_candidates', 'first_identity_statement', 'wanted_state'],
      landing_q: '你會怎麼形容這樣的人？'
    },
    2: {
      goal: '定義確認，排序，建立願景。讓學員說清楚每個詞的定義，再兩兩配對排序，最後從身份出發建立願景。',
      collect: ['value_definitions', 'value_order', 'vision_fragment', 'future_self_phrase'],
      landing_q: '這個排序，說明了你是一個什麼樣的人？'
    },
    3: {
      goal: '找到家族語錄，看見它保護什麼，讓學員自己說出新的可能方向。不重寫信念，只讓它被看見。',
      collect: ['family_phrases', 'old_belief', 'protected_self', 'new_belief_direction'],
      landing_q: '那個聲音，在保護的是哪一個你？'
    },
    4: {
      goal: '整合三週素材，說出新的 Self Concept。不是新的挖掘，是讓學員看見自己走了多遠。',
      collect: ['new_self_concept', 'old_self_concept', 'micro_evidence', 'final_statement'],
      landing_q: '今天，你是誰？用一句話。現在式。'
    }
  },
  money: {
    1: {
      goal: '同時挖金錢和事業。從「你值得嗎、你夠好嗎」這個底層進去，不從外部成果進去。',
      collect: ['value_candidates', 'first_identity_statement', 'money_belief', 'career_belief'],
      landing_q: '你會怎麼形容這樣的人？'
    },
    2: {
      goal: '成功定義覺察，定義確認，排序，願景。',
      collect: ['success_definition', 'value_definitions', 'value_order', 'vision_fragment'],
      landing_q: '這個排序，說明了你在金錢和事業上是一個什麼樣的人？'
    },
    3: {
      goal: '找到家族金錢語錄，看見驕傲與羞愧的雙重束縛，讓學員自己說出新的可能。',
      collect: ['family_phrases', 'old_belief', 'double_bind', 'new_belief_direction'],
      landing_q: '那個聲音，在保護的是哪一個你？'
    },
    4: {
      goal: '整合三週素材，說出新的 Self Concept，做 SC Transfer。',
      collect: ['new_self_concept', 'old_self_concept', 'micro_evidence', 'final_statement'],
      landing_q: '今天，在金錢和事業上，你是誰？用一句話。現在式。'
    }
  },
  relationship: {
    1: {
      goal: '從「說不清楚的不對勁」切入，找到六個關係困境層次中學員最有能量的那個。',
      collect: ['value_candidates', 'needs_awareness', 'first_identity_statement'],
      landing_q: '你會怎麼形容這樣的人？'
    },
    2: {
      goal: '依附模式覺察，定義確認，排序，願景。',
      collect: ['attachment_pattern', 'value_definitions', 'value_order', 'vision_fragment'],
      landing_q: '這個排序，說明了你在關係裡是一個什麼樣的人？'
    },
    3: {
      goal: '找到家族關係語錄，看見它如何影響你對自己需要的態度。',
      collect: ['family_phrases', 'old_belief', 'needs_suppression', 'new_belief_direction'],
      landing_q: '那個聲音，在保護的是哪一個你？'
    },
    4: {
      goal: '整合三週素材，說出新的 Self Concept，做 SC Transfer。',
      collect: ['new_self_concept', 'old_self_concept', 'micro_evidence', 'final_statement'],
      landing_q: '今天，在這段最重要的關係裡，你是誰？用一句話。現在式。'
    }
  }
};

// 偵測學員回答是否到達 Layer 4（身份層）——擴展版
function detectLayer4(text) {
  if (!text) return false;
  const layer4Patterns = [
    // 「我是」開頭
    '我是一個', '我是那種', '我覺得自己是', '我一直是',
    '我本來就是', '我其實是', '我好像是', '我算是',
    '我就是那種', '我是會', '我是喜歡', '我是不喜歡',
    // 不含「我是」的身份陳述
    '一個有', '一個很', '一個會', '一個喜歡', '一個不喜歡',
    '一個能', '一個想', '那種會', '那種人', '那種喜歡',
    '有愛的人', '有能力的人', '願意的人', '懂得的人',
    // 形容詞型
    '我很', '我挺', '我比較', '我算是比較'
  ];
  return layer4Patterns.some(p => text.includes(p));
}

// 偵測上一輪 Claude 是否已經問了落地問句
function detectLandingQAsked(messages, landingQ) {
  if (!messages || messages.length < 2) return false;
  // 找最後一條 assistant 訊息（不含最新的）
  const assistantMessages = messages
    .filter(m => m.role === 'assistant')
    .slice(0, -1); // 排除最新的
  if (assistantMessages.length === 0) return false;
  const lastAssistant = assistantMessages[assistantMessages.length - 1];
  return lastAssistant.content.includes(landingQ) ||
         lastAssistant.content.includes('你會怎麼形容') ||
         lastAssistant.content.includes('說明了你是') ||
         lastAssistant.content.includes('在保護的是哪一個你') ||
         lastAssistant.content.includes('你是誰？用一句話');
}

function buildSystemPrompt(state) {
  const { studentId, module, week, day, sessionNotes, turnCount, yesterdayNote,
          shouldClose, timeUp, lastUserMessage, layer4Detected, landingQAsked } = state;
  const weekGoal = WEEK_GOALS[module]?.[week] || WEEK_GOALS.self[1];
  const isDay6 = day === 6;
  const isVideoDay = day === 1 || day === 2;
  const notes = sessionNotes ? `\n\n教練備注：${sessionNotes}` : '';

  const damonContext = yesterdayNote ? `\n\n# 昨天的 Damon Note（上下文記憶）
${yesterdayNote}

今天從「明天的入口」那個問句開始，承接昨天的脈絡繼續深挖。不要說「你好」或重新介紹自己。直接說：「歡迎回來。」然後從昨天的入口問句進去。` : '';

  if (isDay6) return buildDay6Prompt(state, weekGoal, damonContext);

  const turnsLeft = MAX_TURNS - turnCount;

  let closureInstruction = '';

  if (landingQAsked) {
    // 落地問句已問過，學員剛回答了——直接說結束語
    closureInstruction = `

# 收尾指令（落地問句已問過，現在說結束語）
學員剛才回答了落地問句，說了：「${lastUserMessage || ''}」
現在只做兩件事：
1. Reflection：「你說的是『___』。」
2. 說：「今天先到這裡。把這句話留下來。🌿」
不要再問任何問題。`;

  } else if (layer4Detected) {
    // 偵測到 Layer 4 句型——接住然後問落地問句
    closureInstruction = `

# 收尾指令（偵測到 Layer 4）
學員剛才說了：「${lastUserMessage || ''}」
這是身份層的答案。現在執行收尾：
1. Reflection：「你說的是『___』。」
2. 說：「我聽到了。」
3. 問落地問句：「${weekGoal.landing_q}」
問完就停，等學員回答。下一輪收到回答後說結束語。`;

  } else if (shouldClose || timeUp) {
    closureInstruction = `

# 收尾指令（回合或時間已到）
學員剛才說了：「${lastUserMessage || ''}」
這是今天最後一輪。請按這個順序：
1. Reflection：「你說的是『___』。」
2. 說「我聽到了。」
3. 問落地問句：「${weekGoal.landing_q}」
問完就停，等學員回答。下一輪收到回答後說結束語。`;
  }

  return `你是一個 Adaptive Coaching Engine，使用 Damon Cart 的 Self Concept 框架。

# 學員資訊
編號：${studentId}
模組：${module === 'self' ? '自我關係' : module === 'money' ? '金錢關係' : '伴侶關係'}
第 ${week} 週 第 ${day} 天
已進行 ${turnCount} 個回合，剩餘 ${turnsLeft} 個回合${notes}${damonContext}

# 本週目標
${weekGoal.goal}

# 要收集的材料
${weekGoal.collect.join('、')}

# 落地問句
「${weekGoal.landing_q}」

${isVideoDay ? `# 今天是影片日（Day ${day}）
學員今天先看了課程影片。如果沒有昨天的 Damon Note，第一個問題要承接影片主題。
` : ''}

# 核心守則（永遠不能違反）
1. 不給答案
2. 不重寫信念
3. 不貼標籤
4. 不引導正向結論
5. 跟著學員的答案深挖

# 每一輪固定三步
① Reflection：「你說的是『___』。」——必須做，不能省。
② Micro-Validation：「我聽到了。」或「這對你很重要。」
③ Probe：一次只問一個問題，問完就停。

# Depth Layer 判斷
- Layer 1（表層）：講外部事件、狀況、別人 → PROBE_DEEPER
- Layer 2（感受）：講情緒、「我覺得很___」→ STAY_AND_EXPAND
- Layer 3（價值）：講「我想要___」「我在乎___」→ PROBE_DEEPER
- Layer 4（身份）⭐：講「一個___的人」「我是___」→ 接住，問落地問句，然後收尾
- Layer 5（信念）：講底層規則、家族語錄 → STAY_AND_EXPAND

# 收尾規則（重要）
當學員說出身份層答案（「一個___的人」「我是___」）：
→ Reflection + 「我聽到了。」+ 落地問句
→ 落地問句問完，等學員回答
→ 學員回答後：Reflection + 「今天先到這裡。把這句話留下來。🌿」
→ 不要再問任何問題

# 偵測機制
- 逃避（不知道/還好/沒差）→「如果不是『不知道』，最接近的感覺是什麼？」
- 身體信號（卡住/講不出來/想哭）→「你剛才在這裡停了一下。那個地方，我們可以多停一下嗎？」
- 深度信號（我覺得/我一直/我好像）→ 往 Layer +1
- 外部歸因（一直講別人）→「我聽到了。那你自己呢——在這個裡面，你感覺到的是什麼？」

# Safety
自傷/想死/嚴重創傷 → 停止深挖：「你說的很重要。這一段不適合只靠 App 繼續。我建議你找身邊信任的人陪你。」${closureInstruction}`;
}

function buildDay6Prompt(state, weekGoal, damonContext) {
  const { studentId, module, week } = state;
  return `你是一個 Adaptive Coaching Engine，現在執行 Day 6 整合日。

# 學員資訊
編號：${studentId}
模組：${module === 'self' ? '自我關係' : module === 'money' ? '金錢關係' : '伴侶關係'}
第 ${week} 週 整合日${damonContext}

# Day 6 七步驟（依序執行，每步等學員回應再繼續）
Step 1｜鏡像：列出本週學員重複出現的詞或句子，不解釋只呈現。
Step 2｜認領：「這三句裡，哪一句最像你現在的狀態？」
Step 3｜神級問題：「你這週最不想承認的是什麼？」
Step 4｜SC 問句：「如果把這些放在一起——你覺得你是一個什麼樣的人？」學員回答後只說：「我聽到了。」
Step 5｜關鍵一刀：「但這裡有一個地方，我們這一週還沒有碰到。」
Step 6｜指出未看見：「你現在看到的，是你怎麼選擇。但還沒看到的是——你為什麼一直這樣選。」
Step 7｜張力＋方向：「如果沒有看見那一層，很多選擇，會慢慢回到原本的樣子。下一週，我們會往那一層走。今天先到這裡。🌿」

# 守則
- 每步等學員回應再繼續
- Step 4 後不分析不評論，只說「我聽到了」
- Step 6 不說答案，只指方向`;
}

async function generateDamonNote(sql, sessionId, module, week, day) {
  try {
    const messages = await sql`
      SELECT role, content FROM messages
      WHERE session_id = ${sessionId}
        AND role IN ('user', 'assistant')
      ORDER BY created_at ASC
    `;
    if (messages.length < 2) return null;

    const moduleLabel = module === 'self' ? '自我關係' : module === 'money' ? '金錢關係' : '伴侶關係';
    const conversationText = messages.map(m =>
      `${m.role === 'user' ? '【學員】' : '【AI教練】'} ${m.content}`
    ).join('\n\n');

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
        system: `你是 Damon Cart，一個 Self Concept 教練。你剛完成了一段和學員的對話。請用教練的視角寫下今天的 Damon Note。

格式（嚴格按照，每個標題獨立一行）：

【今天的模式】
學員今天反覆出現的詞或主題（2-3句）

【深度層次】
今天最深走到哪裡（Layer 1-5）？學員在哪裡停住了？

【關鍵句】
今天學員說出來最重要的一句話（用學員原話，加引號）

【SC 觀察】
教練的假設性觀察——學員目前的 Self Concept 是什麼？什麼信念在驅動她？（不給學員看）

【還沒碰到的】
今天還有哪個地方值得繼續挖，但還沒碰到？

【明天的入口】
一個具體的問句，明天可以直接問學員的那種。

注意：簡短有力，總長度不超過400字。不給答案，不重寫信念，SC觀察是假設不是判斷。`,
        messages: [{
          role: 'user',
          content: `模組：${moduleLabel}，第 ${week} 週，第 ${day} 天。\n\n${conversationText}\n\n請寫下今天的 Damon Note。`
        }]
      })
    });

    if (!response.ok) return null;
    const data = await response.json();
    const fullNote = data.content[0].text;

    const keyPhraseMatch = fullNote.match(/【關鍵句】\s*\n([\s\S]*?)(?=\n【|$)/);
    const tomorrowMatch = fullNote.match(/【明天的入口】\s*\n([\s\S]*?)(?=\n【|$)/);
    const keyPhrase = keyPhraseMatch ? keyPhraseMatch[1].trim() : '';
    const tomorrowEntry = tomorrowMatch ? tomorrowMatch[1].trim() : '';
    const publicNote = keyPhrase
      ? `今天你說了一句很重要的話：\n${keyPhrase}\n\n明天我們從這裡繼續——\n${tomorrowEntry}`
      : '';

    await sql`
      UPDATE sessions
      SET damon_note = ${fullNote}, damon_note_public = ${publicNote}, updated_at = NOW()
      WHERE id = ${sessionId}
    `;

    return { fullNote, publicNote };
  } catch (e) {
    console.error('Damon Note error:', e);
    return null;
  }
}

async function advanceStudentDay(sql, studentId, module, week, day) {
  try {
    if (day === 6) {
      const nextWeek = week + 1;
      if (nextWeek > 4) {
        await sql`
          UPDATE students
          SET self_week_completed = CASE WHEN ${module} = 'self' THEN 4 ELSE self_week_completed END,
              updated_at = NOW()
          WHERE student_id = ${studentId}
        `;
      } else {
        await sql`
          UPDATE students SET current_week = ${nextWeek}, current_day = 1, updated_at = NOW()
          WHERE student_id = ${studentId}
        `;
      }
    } else {
      await sql`
        UPDATE students SET current_day = ${day + 1}, updated_at = NOW()
        WHERE student_id = ${studentId}
      `;
    }
  } catch (e) {
    console.error('Advance student day error:', e);
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { messages, studentId, module, week, day, sessionNotes, today } = req.body;
  if (!messages || !studentId) return res.status(400).json({ error: 'Missing required fields' });

  const sessionDate = today || new Date().toLocaleDateString('sv');
  const isDay6 = day === 6;

  try {
    const sql = neon(process.env.DATABASE_URL);

    // 取得昨天的 Damon Note
    let yesterdayNote = null;
    try {
      const notes = await sql`
        SELECT damon_note FROM sessions
        WHERE student_id = ${studentId} AND module = ${module}
          AND week = ${parseInt(week)} AND session_date < ${sessionDate}
          AND damon_note IS NOT NULL
        ORDER BY session_date DESC LIMIT 1
      `;
      if (notes.length > 0) yesterdayNote = notes[0].damon_note;
    } catch(e) {}

    // 找或建立今天的 session
    let sessions = await sql`
      SELECT id, questions_today, created_at FROM sessions
      WHERE student_id = ${studentId} AND module = ${module}
        AND week = ${parseInt(week)} AND session_date = ${sessionDate}
      LIMIT 1
    `;

    let sessionId, turnCount = 0, sessionStart = new Date();

    if (sessions.length === 0) {
      const newSession = await sql`
        INSERT INTO sessions (student_id, module, week, day, session_date, session_notes, questions_today)
        VALUES (${studentId}, ${module}, ${parseInt(week)}, ${day || 1}, ${sessionDate}, ${sessionNotes || ''}, 0)
        RETURNING id, created_at
      `;
      sessionId = newSession[0].id;
      sessionStart = new Date(newSession[0].created_at);
    } else {
      sessionId = sessions[0].id;
      turnCount = sessions[0].questions_today || 0;
      sessionStart = new Date(sessions[0].created_at);
    }

    const minutesElapsed = (new Date() - sessionStart) / 1000 / 60;
    const timeUp = !isDay6 && minutesElapsed >= MAX_MINUTES;

    const userMessage = messages[messages.length - 1];
    const lastUserMessage = userMessage?.role === 'user' ? userMessage.content : '';

    // 偵測 Layer 4
    const layer4Detected = !isDay6 && detectLayer4(lastUserMessage);

    // 偵測落地問句是否已問過
    const weekGoal = WEEK_GOALS[module]?.[week] || WEEK_GOALS.self[1];
    const landingQAsked = !isDay6 && detectLandingQAsked(messages, weekGoal.landing_q);

    if (userMessage?.role === 'user') {
      await sql`
        INSERT INTO messages (session_id, role, content, question_number)
        VALUES (${sessionId}, 'user', ${userMessage.content}, ${turnCount})
      `;
      if (!isDay6) {
        await sql`
          UPDATE sessions SET questions_today = questions_today + 1, updated_at = NOW()
          WHERE id = ${sessionId}
        `;
        turnCount++;
      }
    }

    const shouldClose = !isDay6 && turnCount >= MAX_TURNS;

    const systemPrompt = buildSystemPrompt({
      studentId, module, week, day,
      sessionNotes, turnCount, yesterdayNote,
      shouldClose, timeUp, lastUserMessage,
      layer4Detected, landingQAsked
    });

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 600,
        system: systemPrompt,
        messages: messages
      })
    });

    if (!response.ok) throw new Error('Claude API failed');

    const data = await response.json();
    const content = data.content[0].text;

    await sql`
      INSERT INTO messages (session_id, role, content, question_number)
      VALUES (${sessionId}, 'assistant', ${content}, ${turnCount})
    `;

    const dayComplete = !isDay6 && (
      content.includes('今天先到這裡') ||
      content.includes('把這句話留下來') ||
      content.includes('明天我們繼續') ||
      content.includes('今天就到這裡')
    );

    const day6Complete = isDay6 && (
      content.includes('今天先到這裡') ||
      content.includes('下一週，我們會往那一層走')
    );

    let damonNotePublic = null;

    if (dayComplete || day6Complete) {
      await sql`UPDATE sessions SET day_complete = TRUE, updated_at = NOW() WHERE id = ${sessionId}`;
      const noteResult = await generateDamonNote(sql, sessionId, module, week, day);
      if (noteResult) damonNotePublic = noteResult.publicNote;
      await advanceStudentDay(sql, studentId, module, parseInt(week), day);
    }

    return res.status(200).json({
      content, turnCount,
      dayComplete: dayComplete || day6Complete,
      damonNotePublic,
      turnsLeft: Math.max(0, MAX_TURNS - turnCount)
    });

  } catch (error) {
    console.error('Server error:', error);
    return res.status(500).json({ error: 'Server error' });
  }
}
