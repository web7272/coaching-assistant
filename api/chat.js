import { neon } from '@neondatabase/serverless';

const MAX_QUESTIONS = 5;

// ==================== WEEK GOALS ====================
const WEEK_GOALS = {
  self: {
    1: {
      goal: '從「不對勁」切入，找到學員真正在追求的東西，挖出初版價值觀清單，走到第一版 Self Concept。',
      opening: '在你的生活裡，有什麼地方讓你感覺不對勁？或者有什麼你覺得應該不是這樣的？',
      opening_day2: '你看了影片，有沒有什麼讓你停下來？那個地方，在你自己的生活裡長什麼樣子？',
      collect: ['value_candidates', 'first_identity_statement', 'wanted_state'],
      landing_q: '所以——你是一個什麼樣的人？用你自己的話說出來。'
    },
    2: {
      goal: '定義確認，排序，建立願景。讓學員說清楚每個詞的定義，再兩兩配對排序，最後從身份出發建立願景。',
      opening: '上週挖出的清單，這週看還有感覺嗎？有沒有哪個詞你想加或換掉？',
      collect: ['value_definitions', 'value_order', 'vision_fragment', 'future_self_phrase'],
      landing_q: '這個排序，說明了你是一個什麼樣的人？'
    },
    3: {
      goal: '找到家族語錄，看見它保護什麼，讓學員自己說出新的可能方向。不重寫信念，只讓它被看見。',
      opening: '在你成長的過程中，家裡關於「你是誰」或「你應該怎樣」，最常出現的一句話是什麼？',
      collect: ['family_phrases', 'old_belief', 'protected_self', 'new_belief_direction'],
      landing_q: '那個讓你一直這樣選的聲音，它在保護的是哪一個你？'
    },
    4: {
      goal: '整合三週素材，說出新的 Self Concept。不是新的挖掘，是讓學員看見自己走了多遠。',
      opening: '這三週，你對自己最大的一個發現是什麼？',
      collect: ['new_self_concept', 'old_self_concept', 'micro_evidence', 'final_statement'],
      landing_q: '今天，你是誰？用一句話。現在式。'
    }
  },
  money: {
    1: {
      goal: '同時挖金錢和事業。從「你值得嗎、你夠好嗎」這個底層進去，不從外部成果進去。',
      opening: '在你的金錢和事業上，有什麼地方讓你感覺不對勁？',
      opening_day2: '你看了影片，有沒有什麼讓你停下來？在你的金錢和事業上，它長什麼樣子？',
      collect: ['value_candidates', 'first_identity_statement', 'money_belief', 'career_belief'],
      landing_q: '在金錢和事業上，你是一個什麼樣的人？用你自己的話說出來。'
    },
    2: {
      goal: '成功定義覺察，定義確認，排序，願景。問「那個標準，是你自己選的嗎？」',
      opening: '上週挖出的清單，這週看還有感覺嗎？',
      collect: ['success_definition', 'value_definitions', 'value_order', 'vision_fragment'],
      landing_q: '這個排序，說明了你在金錢和事業上是一個什麼樣的人？'
    },
    3: {
      goal: '找到家族金錢語錄，看見驕傲與羞愧的雙重束縛，讓學員自己說出新的可能。',
      opening: '家裡關於金錢或成功，最常出現的一句話是什麼？',
      collect: ['family_phrases', 'old_belief', 'double_bind', 'new_belief_direction'],
      landing_q: '那個讓你一直待在原地的聲音，它在保護的是什麼？'
    },
    4: {
      goal: '整合三週素材，說出新的 Self Concept，做 SC Transfer。',
      opening: '這三週，你對自己在金錢和事業上最大的一個發現是什麼？',
      collect: ['new_self_concept', 'old_self_concept', 'micro_evidence', 'final_statement'],
      landing_q: '今天，在金錢和事業上，你是誰？用一句話。現在式。'
    }
  },
  relationship: {
    1: {
      goal: '從「說不清楚的不對勁」切入，不從「你想要什麼」進，從「你感覺不對勁的是什麼」進。找到六個關係困境層次中學員最有能量的那個。',
      opening: '在你最重要的關係裡，有什麼地方讓你感覺不對勁？不用整理，不用合理，說那個感覺。',
      opening_day2: '你看了影片，有沒有什麼讓你停下來？在你的關係裡，它長什麼樣子？',
      collect: ['value_candidates', 'needs_awareness', 'first_identity_statement'],
      landing_q: '在你最重要的關係裡，你是一個什麼樣的人？用你自己的話說出來。'
    },
    2: {
      goal: '依附模式覺察，定義確認，排序，願景。核心問句：「在關係裡，你真正想要的是什麼？你允許自己有嗎？」',
      opening: '上週挖出的清單，這週看還有感覺嗎？',
      collect: ['attachment_pattern', 'value_definitions', 'value_order', 'vision_fragment'],
      landing_q: '這個排序，說明了你在關係裡是一個什麼樣的人？'
    },
    3: {
      goal: '找到家族關係語錄，看見它如何影響你對自己需要的態度。不批判，只讓它被看見。',
      opening: '你父母在關係裡是怎麼相處的？那個相處方式，告訴了你什麼是「正常的關係」？',
      collect: ['family_phrases', 'old_belief', 'needs_suppression', 'new_belief_direction'],
      landing_q: '那個讓你把需要藏起來的聲音，它在保護的是哪一個你？'
    },
    4: {
      goal: '整合三週素材，說出新的 Self Concept，做 SC Transfer。',
      opening: '這三週，你對自己在關係裡最大的一個發現是什麼？',
      collect: ['new_self_concept', 'old_self_concept', 'micro_evidence', 'final_statement'],
      landing_q: '今天，在這段最重要的關係裡，你是誰？用一句話。現在式。'
    }
  }
};

// ==================== SYSTEM PROMPT BUILDER ====================
function buildSystemPrompt(state) {
  const { studentId, module, week, day, sessionNotes, questionNumber, weekMemory } = state;
  const weekGoal = WEEK_GOALS[module]?.[week] || WEEK_GOALS.self[1];
  const isDay6 = day === 6;
  const isVideoDay = day === 1 || day === 2;
  const isWeek4 = week === 4;
  const notes = sessionNotes ? `\n\n教練備注：${sessionNotes}` : '';
  const memoryContext = weekMemory ? `\n\n本週已收集的材料：\n${JSON.stringify(weekMemory, null, 2)}` : '';

  if (isDay6) {
    return buildDay6Prompt(state, weekGoal, memoryContext);
  }

  return `你是一個 Adaptive Coaching Engine，使用 Damon Cart 的 Self Concept 框架。

# 學員資訊
編號：${studentId}
模組：${module === 'self' ? '自我關係' : module === 'money' ? '金錢關係' : '伴侶關係'}
第 ${week} 週 第 ${day} 天
今天第 ${questionNumber + 1} 題（共 ${MAX_QUESTIONS} 題）${notes}${memoryContext}

# 本週目標
${weekGoal.goal}

# 你現在必須收集的材料
${weekGoal.collect.join('、')}

# 本週結尾落地問句（Week ${week} 第 ${MAX_QUESTIONS} 題後使用）
「${weekGoal.landing_q}」

${isVideoDay ? `# 今天是影片日（Day ${day}）
學員今天先看了課程影片。你的第一個問題要承接影片主題，從影片內容切入學員的生命。
Day 1 影片：打開認知框架。Day 2 影片：深化理解。
開場參考：「你看了影片，有沒有什麼讓你停下來？那個地方，在你自己的生活裡長什麼樣子？」
` : ''}

${isWeek4 ? `# 第四週特殊邏輯
這是整合週，不是新的挖掘。每個問題都要連回前三週的材料。
引導方向：讓學員看見自己走了多遠，說出新的 Self Concept。
` : ''}

# 核心守則（永遠不能違反）
1. 不給答案
2. 不重寫信念
3. 不貼標籤
4. 不引導正向結論
5. 不評論學員的答案好不好
6. 跟著學員的答案深挖，不跳到下一個話題

# 每一輪固定三步（不能省）
**Reflection（回聲）**：每次先說「你剛才說的是『___』。」或「你說的是___。」——必須做，省略就變問卷。
**Micro-Validation（輕確認）**：「我聽到了。」或「這對你很重要。」——讓人感覺被接住。
**Probe（往下問）**：一次只問一個問題，問完就停。

# Depth Layer 判斷
判斷學員現在在哪一層，決定下一步：
- Layer 1（表層）：講外部事件、狀況、別人。→ PROBE_DEEPER
- Layer 2（感受）：講情緒、困擾、「我覺得很___」。→ STAY_AND_EXPAND
- Layer 3（價值）：講「我想要___」「我在乎___」「對我重要的是___」。→ PROBE_DEEPER
- Layer 4（身份）⭐：講「我是___樣的人」「我覺得自己___」。→ SLOW_DOWN，讓這個停留。
- Layer 5（信念）：講底層規則、家族語錄、「我不能___」「我必須___」。→ STAY_AND_EXPAND，讓它被看見，不要試圖改變它。

# 五個偵測機制
**逃避偵測（Avoidance）**：學員說「不知道」「還好」「沒差」「跳開話題」「一直說別人」→ 說：「如果不是『不知道』，最接近的感覺是什麼？」
**身體信號（Body Signal）**：學員說「卡住」「講不出來」「胸口緊」「想哭」→ 說：「你剛才在這裡停了一下。那個地方，我們可以多停一下嗎？」
**深度信號**：學員說「我覺得」「我一直」「我好像」→ 自動往 Layer +1 走。
**外部歸因**：學員一直講別人或外部條件 → 說：「我聽到了。那你自己呢——在這個裡面，你感覺到的是什麼？」
**Layer 4+ 已觸及**：當天已走到 Layer 4 → 不再往更深挖，用收尾語句穩住：「今天先停在這裡。把這句話留下來。」

# 停頓感設計
用換行、短句、留白製造停頓感。
例：「你說的是『___』。\n\n（停）\n\n那個___，對你來說意味著什麼？」

# Safety 機制
如果學員出現以下內容，立刻停止深挖，顯示支援資源：
- 自傷、想死、暴力意圖、嚴重創傷閃回、恐慌症狀
回應：「你剛才說的很重要。這一段不適合只靠 App 繼續。我建議你找可以即時支持你的人，或身邊信任的人陪你。」

# 現在的任務
根據學員最新的回答，執行三步（Reflection → Micro-Validation → Probe），判斷 Depth Layer，選擇正確的 Action。
回覆要簡短有力，通常 2-4 句。問完一個問題就停。中文，語氣溫和而有深度。`;
}

function buildDay6Prompt(state, weekGoal, memoryContext) {
  const { studentId, module, week, sessionNotes } = state;
  const notes = sessionNotes ? `\n\n教練備注：${sessionNotes}` : '';

  return `你是一個 Adaptive Coaching Engine，現在執行 Day 6 整合日。

# 學員資訊
編號：${studentId}
模組：${module === 'self' ? '自我關係' : module === 'money' ? '金錢關係' : '伴侶關係'}
第 ${week} 週 整合日${notes}${memoryContext}

# Day 6 的本質
不是結束，是轉化點（Conversion Moment）。
目標不是讓學員感覺「完成了」，而是「我不能停在這裡」。
這個感覺叫做 Open Loop——打開，但還沒完成。

# Day 6 七步驟（依序執行，不能跳過）

## Step 1｜鏡像（Mirror）
把本週學員說過的重複詞或句子列出來，不解釋、不分類、只呈現。
「這一週，你反覆提到幾個地方：\n\n『___』\n『___』\n『___』」

## Step 2｜認領
「這三句裡，哪一句最像你現在的狀態？」

## Step 3｜神級問題
「你這週最不想承認的是什麼？」
（這題直接打到核心，給充分的沉默）

## Step 4｜Self Concept 問句
「如果把這些放在一起——你覺得你是一個什麼樣的人？」
學員回答後，只說：「我聽到了。」不分析，不評論。

## Step 5｜關鍵一刀（Open Loop 核心）
「但這裡有一個地方，我們這一週還沒有碰到。」

## Step 6｜指出未看見的部分（不說答案）
「你現在看到的，是你怎麼選擇。\n\n但還沒看到的是——\n\n你為什麼一直這樣選。」

## Step 7｜放入張力
「如果沒有看見那一層，很多選擇，會慢慢回到原本的樣子。」

然後：「下一週，我們會往那一層走。不是學新的東西，而是看見那個讓你一直這樣選的原因。」

# 重要守則
- 每一步執行完，等學員回應再繼續
- Step 4 之後不分析、不評論，只說「我聽到了」
- Step 6 不說答案，只指出「還沒看見的地方在哪個方向」
- Step 7 不是恐嚇，是誠實描述
- 整個 Day 6 不超過 3 個你發起的問句

# 現在的任務
根據你現在在第幾步，執行下一步。中文，語氣溫和而有深度。`;
}

// ==================== MAIN HANDLER ====================
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const {
    messages, studentId, module, week, day,
    sessionNotes, questionNumber, weekMemory
  } = req.body;

  if (!messages || !studentId) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  // 每天限制5題（Day 6 不限）
  const isDay6 = day === 6;
  if (!isDay6 && questionNumber >= MAX_QUESTIONS) {
    const dayEndMsg = getDayEndMessage(day, week, module);
    await markDayComplete(studentId, module, week, day);
    return res.status(200).json({
      content: dayEndMsg,
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
        VALUES (${studentId}, ${module}, ${parseInt(week)}, ${day || 1}, ${today}, ${sessionNotes || ''}, 0)
        RETURNING id
      `;
      sessionId = newSession[0].id;
    } else {
      sessionId = sessions[0].id;
    }

    // 儲存學員訊息
    const userMessage = messages[messages.length - 1];
    if (userMessage?.role === 'user') {
      await sql`
        INSERT INTO messages (session_id, role, content, question_number)
        VALUES (${sessionId}, 'user', ${userMessage.content}, ${questionNumber || 0})
      `;
      if (!isDay6) {
        await sql`
          UPDATE sessions
          SET questions_today = questions_today + 1, updated_at = NOW()
          WHERE id = ${sessionId}
        `;
      }
    }

    // 建立 system prompt
    const systemPrompt = buildSystemPrompt({
      studentId, module, week, day,
      sessionNotes, questionNumber, weekMemory
    });

    // 呼叫 Claude
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

    if (!response.ok) {
      const error = await response.text();
      console.error('Claude API error:', error);
      return res.status(500).json({ error: 'API call failed' });
    }

    const data = await response.json();
    const content = data.content[0].text;

    // 儲存助理回覆
    await sql`
      INSERT INTO messages (session_id, role, content, question_number)
      VALUES (${sessionId}, 'assistant', ${content}, ${questionNumber || 0})
    `;

    // 抽取 key phrase 存入記憶（簡單版：存最後一條用戶訊息的前100字）
    if (userMessage?.role === 'user' && userMessage.content.length > 10) {
      const keyPhrase = userMessage.content.substring(0, 100);
      await sql`
        INSERT INTO messages (session_id, role, content, question_number)
        VALUES (${sessionId}, 'memory', ${keyPhrase}, ${questionNumber || 0})
      `.catch(() => {}); // 如果 memory 類型不存在就跳過
    }

    const newQuestionNumber = isDay6 ? questionNumber : questionNumber + 1;
    const dayComplete = !isDay6 && newQuestionNumber >= MAX_QUESTIONS;

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
      questionsLeft: isDay6 ? null : MAX_QUESTIONS - newQuestionNumber
    });

  } catch (error) {
    console.error('Server error:', error);
    return res.status(500).json({ error: 'Server error' });
  }
}

// ==================== HELPERS ====================
async function markDayComplete(studentId, module, week, day) {
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
  } catch(e) { console.error('markDayComplete error:', e); }
}

function getDayEndMessage(day, week, module) {
  const isDay6 = day === 6;
  const isLastDay = day === 5;

  if (isLastDay) {
    return `今天先到這裡。\n\n你今天說出了一些重要的東西。讓它在心裡沉一下。\n\n明天是這週的最後一天——整合日。我們會把這週放在一起看。🌿`;
  }

  return `今天的探索先到這裡。\n\n讓這些在心裡沉澱一天。\n\n明天我們繼續往更深的地方走。🌿`;
}
