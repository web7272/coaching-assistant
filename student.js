/* student.js — v5.0 紙感 student SPA
   Routes: #/entry, #/journey, #/conversation, #/note?day=N, #/week?week=N, #/graduation
   ⚠️ Hard rules respected (UI §六/§九):
     no streak / no X-of-21 counter / no progress bar / no typing dots /
     no loading spinner / no red error / no auto-scroll / no greeting名稱
*/
'use strict';

// ─── state ─────────────────────────────────────────────────────────
const LS_KEY = 'sy.v5.student';
const state = {
  studentId: null,
  email:     null,
  preferredName: null,        // PR-4c-4e — 「{preferredName} 的旅程」
  pace:      'daily',         // PR-4c-4e — 'daily' | 'self-paced'
  module:    'self',
  currentDay: 0,
  conversation: [],          // {role: 'user'|'assistant', content}
  closure: false,
  finalizing: false,
};
function loadState() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return;
    const o = JSON.parse(raw);
    if (o && typeof o === 'object') {
      Object.assign(state, o);
      // ensure conversation always an array
      if (!Array.isArray(state.conversation)) state.conversation = [];
    }
  } catch {}
}
function saveState() {
  try {
    // PR-4c-4c: persist conversation too so refresh on the conversation page
    // doesn't double-fire kickoff and re-emit the opening.
    // PR-4c-4e: also persist preferredName + pace (collected once at entry).
    const { studentId, email, preferredName, pace, module, currentDay, conversation, _lastSessionId } = state;
    localStorage.setItem(LS_KEY, JSON.stringify({
      studentId, email, preferredName, pace, module, currentDay, conversation, _lastSessionId,
    }));
  } catch {}
}
function clearState() {
  try { localStorage.removeItem(LS_KEY); } catch {}
  Object.assign(state, {
    studentId: null, email: null, preferredName: null, pace: 'daily',
    currentDay: 0, conversation: [], closure: false, finalizing: false, _lastSessionId: null,
  });
}

// ─── HTTP ──────────────────────────────────────────────────────────
async function api(path, opts) {
  const init = Object.assign({ headers: { 'Content-Type': 'application/json' } }, opts || {});
  if (init.body && typeof init.body !== 'string') init.body = JSON.stringify(init.body);
  const res = await fetch(path, init);
  if (!res.ok) {
    let body = '';
    try { body = await res.text(); } catch {}
    const err = new Error('http_' + res.status);
    err.status = res.status;
    err.body = body;
    throw err;
  }
  const ct = res.headers.get('content-type') || '';
  if (ct.includes('application/json')) return res.json();
  return res.text();
}

// ─── view router ───────────────────────────────────────────────────
const VIEWS = ['entry', 'journey', 'conversation', 'note', 'week-report', 'graduation'];

function showView(name) {
  for (const v of VIEWS) {
    const el = document.getElementById('view-' + v);
    if (!el) continue;
    if (v === name) {
      el.classList.add('active');
      // §5.3 page fade-in (250ms, gentle — not the §5.2 收尾 transition)
      el.classList.add('fade-in');
      // double-rAF to ensure transition fires
      requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('shown')));
    } else {
      el.classList.remove('active', 'fade-in', 'shown', 'fade-out');
    }
  }
}

function parseHash() {
  const h = location.hash || '#/entry';
  const [routePart, qsPart] = h.replace(/^#\/?/, '').split('?');
  const route = routePart || 'entry';
  const params = {};
  if (qsPart) {
    for (const kv of qsPart.split('&')) {
      const [k, v] = kv.split('=');
      params[decodeURIComponent(k)] = decodeURIComponent(v || '');
    }
  }
  return { route, params };
}

async function route() {
  const { route, params } = parseHash();

  // gating: any view other than entry needs studentId
  if (!state.studentId && route !== 'entry') {
    location.hash = '#/entry';
    return;
  }

  switch (route) {
    case 'entry':        showView('entry');        renderEntry(); break;
    case 'journey':      showView('journey');      await renderJourney(); break;
    case 'conversation': showView('conversation'); await renderConversation(); break;
    case 'note':         showView('note');         await renderNote(parseInt(params.day) || state.currentDay); break;
    case 'week':         showView('week-report');  await renderWeekReport(parseInt(params.week) || 1); break;
    case 'graduation':   showView('graduation');   await renderGraduation(); break;
    default:             location.hash = '#/entry';
  }
}

// ─── §4.1 entry ────────────────────────────────────────────────────
function renderEntry() {
  const form = document.getElementById('entry-form');
  const emailEl = document.getElementById('entry-email');
  const nameEl = document.getElementById('entry-name');
  const btn = document.getElementById('entry-btn');
  const err = document.getElementById('entry-error');
  err.classList.add('hidden');

  // pre-fill (returning visitor)
  if (state.email) emailEl.value = state.email;
  if (state.preferredName) nameEl.value = state.preferredName;
  if (state.pace) {
    const radio = form.querySelector(`input[name="pace"][value="${state.pace}"]`);
    if (radio) radio.checked = true;
  }

  form.onsubmit = async (e) => {
    e.preventDefault();
    err.classList.add('hidden');
    const email = (emailEl.value || '').trim().toLowerCase();
    if (!email || !email.includes('@') || !email.includes('.')) {
      err.textContent = '這個 email 看起來不太對，再看一下。';   // §六: 米棕色平靜措辭
      err.classList.remove('hidden');
      return;
    }
    const preferredName = (nameEl.value || '').trim() || null;
    const paceChoice = (form.querySelector('input[name="pace"]:checked')?.value === 'self-paced')
      ? 'self-paced' : 'daily';

    btn.disabled = true;
    try {
      const r = await api('/api/auth/email-login', {
        method: 'POST',
        body: { email, preferredName, pace: paceChoice },
      });
      state.studentId     = r.studentId;
      state.email         = email;
      state.preferredName = r.preferredName ?? preferredName ?? null;
      state.pace          = r.pace || paceChoice || 'daily';
      state.module        = r.module || 'self';
      state.currentDay    = r.currentDay || 1;
      saveState();
      location.hash = '#/journey';
    } catch (e2) {
      err.textContent = '沒能送出，我們再試一次。';
      err.classList.remove('hidden');
    } finally {
      btn.disabled = false;
    }
  };
}

// ─── §4.2 journey ──────────────────────────────────────────────────
async function renderJourney() {
  document.getElementById('journey-header-label').textContent = `看見自己 · 第${state.currentDay || 1}天`;

  // PR-4c-4e — personalised title「{preferredName} 的旅程」 (Vivi 拍板 override of UI §六)
  const titleEl = document.getElementById('journey-title');
  if (titleEl) {
    titleEl.textContent = state.preferredName ? `${state.preferredName} 的旅程` : '你的旅程';
  }

  let j;
  try {
    j = await api(`/api/journey?studentId=${encodeURIComponent(state.studentId)}&module=${encodeURIComponent(state.module)}`);
  } catch (e) {
    j = { module: state.module, moduleLabel: '看見自己', currentDay: state.currentDay || 0, days: [], weeks: [], graduation: { state: 'future' } };
  }

  state.currentDay = j.currentDay || 0;
  saveState();
  document.getElementById('journey-header-label').textContent = `看見自己 · 第${j.currentDay || 1}天`;

  // grid: 3 rows of 8 cells (7 daily + 1 weekly each)
  const grid = document.getElementById('journey-grid');
  grid.innerHTML = '';
  const days = (j.days || []).slice();
  while (days.length < 21) days.push({ day: days.length + 1, state: 'future', phrase: null });
  const weeks = (j.weeks || []).slice();
  while (weeks.length < 3) weeks.push({ week: weeks.length + 1, state: 'future' });

  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 7; col++) {
      const cell = days[row * 7 + col];
      grid.appendChild(renderDailyCell(cell));
    }
    grid.appendChild(renderWeeklyCell(weeks[row]));
  }

  // graduation cell (full grid width)
  const gradWrap = document.getElementById('graduation-cell-wrap');
  gradWrap.innerHTML = '';
  gradWrap.appendChild(renderGraduationCell(j.graduation || { state: 'future' }));

  // bottom prompt only on Day 1
  const prompt = document.getElementById('journey-prompt');
  if ((j.currentDay || 0) <= 1) prompt.classList.remove('hidden');
  else prompt.classList.add('hidden');
}

function renderDailyCell(c) {
  // B2 (PR-4c-4d, Vivi decision): cells show ONLY the day number.
  // No phrase, no 「今天」 label — states purely visual:
  //   future        → transparent bg + faint border + faint day#
  //   active-empty  → paper bg + active border + ✦ corner + 今天-coloured day#
  //   active-filled → same visual as active-empty (no text differentiation),
  //                   but click routes to that day's note (just-finished)
  //   revealed      → paper bg + revealed border + no ✦, click → that day's note
  // The phrase still lives in c.phrase (server returns it) — used for aria-label only.
  const div = document.createElement('div');
  div.setAttribute('role', 'listitem');
  div.className = `cell cell--${c.state}`;
  div.tabIndex = (c.state === 'future') ? -1 : 0;
  div.setAttribute('aria-label', `第 ${c.day} 天，${ariaState(c.state)}${c.phrase ? '，' + c.phrase : ''}`);
  div.innerHTML = `<span class="cell__day">${c.day}</span>`;
  // ✦ corner mark only on active states (today)
  if (c.state === 'active-empty' || c.state === 'active-filled') {
    div.innerHTML += `<span class="cell__star" aria-hidden="true">✦</span>`;
  }
  if (c.state !== 'future') {
    const handler = () => {
      if (c.state === 'active-empty') {
        location.hash = '#/conversation';
      } else {
        // active-filled (today, just finished) OR revealed (past day) → that day's note
        location.hash = `#/note?day=${c.day}`;
      }
    };
    div.addEventListener('click', handler);
    div.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handler(); } });
  }
  return div;
}
function renderWeeklyCell(w) {
  const div = document.createElement('div');
  div.className = `cell cell--weekly cell--${w.state}`;
  div.tabIndex = (w.state === 'future') ? -1 : 0;
  div.setAttribute('aria-label', `第 ${w.week} 週，${ariaState(w.state)}`);
  div.innerHTML = `<span class="roman">${roman(w.week)}</span>`;
  if (w.state !== 'future') {
    const handler = () => { location.hash = `#/week?week=${w.week}`; };
    div.addEventListener('click', handler);
    div.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handler(); } });
  }
  return div;
}
function renderGraduationCell(g) {
  const div = document.createElement('div');
  div.className = `cell cell--graduation cell--${g.state}`;
  div.tabIndex = (g.state === 'future') ? -1 : 0;
  div.setAttribute('aria-label', `結業 · 第 21 天，${ariaState(g.state)}`);
  div.innerHTML = `<span class="label">結業 · 第 21 天</span>`;
  if (g.state !== 'future') {
    const handler = () => { location.hash = '#/graduation'; };
    div.addEventListener('click', handler);
    div.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handler(); } });
  }
  return div;
}

function roman(n) { return ['I', 'II', 'III'][n - 1] || ''; }
function ariaState(s) {
  return s === 'future'        ? '還沒到'
       : s === 'active-empty'  ? '今天，點開進入對話'
       : s === 'active-filled' ? '今天，已完成'
       : s === 'revealed'      ? '已揭開' : s;
}
function escapeText(s) { const d = document.createElement('div'); d.textContent = String(s ?? ''); return d.innerHTML; }

// ─── §4.3 conversation ────────────────────────────────────────────
async function renderConversation() {
  document.getElementById('conv-header-label').textContent = `看見自己 · 第${state.currentDay || 1}天`;
  const scroll = document.getElementById('conv-scroll');
  scroll.innerHTML = '';
  // Re-render persisted conversation (localStorage survives refresh)
  for (const m of state.conversation) appendMessage(m.role, m.content, /*scroll=*/false);

  const inputBar = document.getElementById('conv-input-bar');
  const input = document.getElementById('conv-input');
  const closure = document.getElementById('conv-closure');
  inputBar.classList.remove('exiting', 'hidden');
  closure.classList.add('hidden');
  closure.classList.remove('shown');
  state.closure = false;
  state.finalizing = false;
  input.placeholder = '寫一句、什麼都好';   // §六: no example placeholders

  // PR-4c-4c: fresh conversation → kickoff handshake so AI 起手式 appears first
  // (per UI spec + storyboard "Day 1 對話 第一個問句"). The 起手式 text comes from
  // the phase-context opening variant in the server's system prompt — frontend
  // does NOT hard-code the question.
  if (state.conversation.length === 0) {
    await requestKickoffOpening();
  }

  // auto-resize textarea + manage send-button disabled state
  input.value = '';
  input.style.height = 'auto';
  const sendBtn = document.getElementById('conv-send-btn');
  const syncSendBtn = () => {
    if (!sendBtn) return;
    const hasText = (input.value || '').trim().length > 0;
    sendBtn.disabled = !hasText || state.closure;
  };
  input.oninput = () => {
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 200) + 'px';
    syncSendBtn();
  };

  // Submit handler — shared between Enter (§六 keyboard) + 送出 button (F1 Vivi override)
  const submit = async () => {
    const text = (input.value || '').trim();
    if (!text || state.closure) return;
    input.value = '';
    input.style.height = 'auto';
    syncSendBtn();
    await sendUserMessage(text);
  };

  // Enter to send; Shift+Enter newline (per §六 keyboard convention)
  input.onkeydown = async (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      await submit();
    }
  };
  // F1 (PR-4c-4d): explicit 送出 button — Vivi override of UI §六 「無 Send 鈕」
  if (sendBtn) sendBtn.onclick = async (e) => { e.preventDefault(); await submit(); };

  syncSendBtn();
  input.focus();
}

function appendMessage(role, content, doScroll = true) {
  const scroll = document.getElementById('conv-scroll');
  if (role === 'assistant') {
    const div = document.createElement('div');
    div.className = 'msg-ai';
    div.textContent = content;
    scroll.appendChild(div);
  } else {
    const wrap = document.createElement('div');
    wrap.className = 'msg-user-wrap';
    const bubble = document.createElement('div');
    bubble.className = 'msg-user';
    bubble.textContent = content;
    wrap.appendChild(bubble);
    scroll.appendChild(wrap);
  }
  if (doScroll) {
    // §五.四 NO auto-scroll —— 但學員剛送出自己的訊息時、把那則送進可見範圍是合理的、
    // 用 smooth scroll 只滑到剛新增的那則底端、不強制把 AI 後續訊息都拉到底.
    scroll.scrollTo({ top: scroll.scrollHeight, behavior: 'smooth' });
  }
}

async function sendUserMessage(text) {
  state.conversation.push({ role: 'user', content: text });
  appendMessage('user', text);
  try {
    const r = await api('/api/chat', {
      method: 'POST',
      body: {
        messages: state.conversation,
        studentId: state.studentId,
        module: state.module,
        today: new Date().toLocaleDateString('sv'),
      },
    });
    if (r && r.sessionId) state._lastSessionId = r.sessionId;
    const aiContent = r.content || '';
    state.conversation.push({ role: 'assistant', content: aiContent });
    appendMessage('assistant', aiContent);
    if (r.dayComplete) await startClosureTransition();
  } catch (e) {
    // §六: 米棕色平靜 inline message (not red banner)
    const div = document.createElement('div');
    div.className = 'hint-italic';
    div.style.marginBottom = '22px';
    div.textContent = '沒能送出，我們再試一次。';
    document.getElementById('conv-scroll').appendChild(div);
  }
}

/**
 * PR-4c-4c — Fire the session-start kickoff so the AI 起手式 appears first.
 *
 * Renders a paper-aesthetic 「✦ 教練在打開今天」placeholder while waiting (no
 * spinner, no typing dots — §五.四 / §六). Replaces the placeholder with the AI
 * opening when it arrives. Persists the opening to state.conversation so refresh
 * doesn't double-fire.
 */
async function requestKickoffOpening() {
  const scroll = document.getElementById('conv-scroll');
  const placeholder = document.createElement('div');
  placeholder.className = 'conv-waiting';
  placeholder.innerHTML = '<span class="star">✦</span><span class="text">教練在打開今天</span>';
  scroll.appendChild(placeholder);

  try {
    const r = await api('/api/chat', {
      method: 'POST',
      body: {
        kickoff: true,
        // messages: [] — chat.js will synthesize the sentinel internally
        studentId: state.studentId,
        module: state.module,
        today: new Date().toLocaleDateString('sv'),
      },
    });
    if (r && r.sessionId) state._lastSessionId = r.sessionId;
    const aiContent = r.content || '';
    state.conversation.push({ role: 'assistant', content: aiContent });
    saveState();
    placeholder.remove();
    appendMessage('assistant', aiContent);
  } catch (e) {
    placeholder.remove();
    const div = document.createElement('div');
    div.className = 'hint-italic';
    div.style.marginBottom = '22px';
    div.textContent = '沒能打開今天，待會再試。';
    scroll.appendChild(div);
  }
}

// §5.2 對話收尾轉場
//   T+0     AI message already shown (fade-in handled by paint)
//   T+1500  input fade out + translateY 8px
//   T+1700  「✦ 教練在寫今天的字」appears + fire finalize-day
//   wait    max(2800ms-from-T+1700, finalize-day promise) for serenity
//   T+resolve  fade-out conversation view, fade-in note view
async function startClosureTransition() {
  state.closure = true;
  const inputBar = document.getElementById('conv-input-bar');
  const closure  = document.getElementById('conv-closure');

  await sleep(1500);
  inputBar.classList.add('exiting');
  await sleep(200);
  inputBar.classList.add('hidden');
  closure.classList.remove('hidden');
  // double rAF for transition kick
  requestAnimationFrame(() => requestAnimationFrame(() => closure.classList.add('shown')));

  // fire finalize-day NOW (in parallel with the 2.8s hold)
  // sessionId comes from the last /api/chat response (stashed in state._lastSessionId)
  state.finalizing = true;
  const finalizeP = api('/api/finalize-day', {
    method: 'POST',
    body: {
      sessionId:  state._lastSessionId,
      studentId:  state.studentId,
      module:     state.module,
      sessionDay: state.currentDay,
    },
  }).catch(e => ({ ok: false, _err: e }));

  const [finalizeResult] = await Promise.all([
    finalizeP,
    sleep(2800),  // §5.2 minimum stillness (T+1700 → T+4500)
  ]);

  // T+4500: fade out conversation view, fade in note
  const convView = document.getElementById('view-conversation');
  convView.classList.add('fade-out');
  await sleep(400);

  // route to note for today, with the body if finalize returned it
  state._pendingNote = (finalizeResult && finalizeResult.ok)
    ? { day: state.currentDay, body: finalizeResult.damonNotePublic || '（教練筆記稍後送達）' }
    : { day: state.currentDay, body: '（教練筆記稍後送達）' };

  state.finalizing = false;
  state.conversation = [];           // next day starts fresh in memory
  state.currentDay = (state.currentDay || 0) + 1;   // optimistic — server is the source of truth on next /api/journey load
  saveState();

  location.hash = `#/note?day=${state._pendingNote.day}`;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ─── §4.5 note ─────────────────────────────────────────────────────
async function renderNote(day) {
  document.getElementById('note-header-label').textContent = `看見自己 · 第${day}天`;
  const body = document.getElementById('note-body');
  body.innerHTML = '';

  // if we have a pendingNote from the §5.2 transition, use it; else fetch
  let text = null;
  if (state._pendingNote && state._pendingNote.day === day) {
    text = state._pendingNote.body;
    state._pendingNote = null;
  } else {
    try {
      const r = await api(`/api/note?studentId=${encodeURIComponent(state.studentId)}&module=${encodeURIComponent(state.module)}&day=${day}`);
      text = r.exists ? r.noteText : '（這一天的筆記還沒有。）';
    } catch (e) {
      text = '（沒能取回今天的筆記，待會再試。）';
    }
  }
  // render paragraphs (split by blank line)
  const paras = String(text || '').split(/\n\s*\n/);
  for (const p of paras) {
    const el = document.createElement('p');
    el.textContent = p;
    body.appendChild(el);
  }
}

// ─── §4.6 week report ──────────────────────────────────────────────
async function renderWeekReport(week) {
  document.getElementById('week-header-label').textContent = `看見自己 · 第${weekZh(week)}週`;
  document.getElementById('week-subtitle').textContent = `第${weekZh(week)}週`;
  const title = document.getElementById('week-title');
  const body  = document.getElementById('week-body');
  title.textContent = '—';
  body.innerHTML = '';
  try {
    const r = await api(`/api/week-report?studentId=${encodeURIComponent(state.studentId)}&module=${encodeURIComponent(state.module)}&week=${week}`);
    if (!r.exists) {
      title.textContent = '—';
      const p = document.createElement('p'); p.textContent = '（這一週的整理還沒有。）'; body.appendChild(p);
      return;
    }
    title.textContent = r.title || '—';
    const paras = String(r.body || '').split(/\n\s*\n/);
    for (const p of paras) {
      const el = document.createElement('p'); el.textContent = p; body.appendChild(el);
    }
  } catch (e) {
    const el = document.createElement('p'); el.textContent = '（沒能取回這一週的整理，待會再試。）'; body.appendChild(el);
  }
}
function weekZh(n) { return ['一', '二', '三'][n - 1] || String(n); }

// ─── §4.7 graduation ───────────────────────────────────────────────
async function renderGraduation() {
  const letter   = document.getElementById('grad-letter');
  const poem     = document.getElementById('grad-poem');
  const decl     = document.getElementById('grad-declaration');
  const notice   = document.getElementById('grad-export-notice');
  letter.innerHTML = ''; poem.innerHTML = ''; decl.textContent = '—'; notice.classList.add('hidden');

  let g;
  try { g = await api(`/api/graduation?studentId=${encodeURIComponent(state.studentId)}&module=${encodeURIComponent(state.module)}`); }
  catch (e) { g = { exists: false }; }
  if (!g.exists) {
    const p = document.createElement('p'); p.textContent = '（結業內容還沒生成。）'; letter.appendChild(p);
    return;
  }
  // coach letter (paragraphs)
  for (const p of String(g.coachLetter || '').split(/\n\s*\n/)) {
    const el = document.createElement('p'); el.textContent = p; letter.appendChild(el);
  }
  // 21 句詩 → group into 3 lines (7 terms each, separator ·)
  const terms = (Array.isArray(g.poem21) ? g.poem21 : []).slice(0, 21);
  for (let i = 0; i < 3; i++) {
    const line = terms.slice(i * 7, (i + 1) * 7).filter(s => s && s.length > 0).join(' · ');
    if (line) {
      const el = document.createElement('div'); el.className = 'poem-line'; el.textContent = line; poem.appendChild(el);
    }
  }
  // declaration
  decl.textContent = g.declaration || '—';
  // email notice — 紙感平靜文字, NO download button (硬傷 2)
  if (g.exportedToEmail) notice.classList.remove('hidden');
}

// ─── nav handlers ──────────────────────────────────────────────────
document.addEventListener('click', (e) => {
  const t = e.target.closest('[data-nav]');
  if (!t) return;
  e.preventDefault();
  const nav = t.getAttribute('data-nav');
  if (nav === 'journey')      location.hash = '#/journey';
  if (nav === 'conversation') location.hash = '#/conversation';
  if (nav === 'note')         location.hash = '#/note';
  if (nav === 'week')         location.hash = '#/week';
  if (nav === 'graduation')   location.hash = '#/graduation';
  if (nav === 'logout')       { clearState(); location.hash = '#/entry'; }
});

// ─── boot ──────────────────────────────────────────────────────────
loadState();
window.addEventListener('hashchange', route);
window.addEventListener('DOMContentLoaded', () => {
  if (!state.studentId && (!location.hash || location.hash === '#/' || location.hash === '#/entry')) {
    location.hash = '#/entry';
  } else if (!location.hash || location.hash === '#/') {
    location.hash = '#/journey';
  }
  route();
});
