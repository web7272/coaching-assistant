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
const VIEWS = ['entry', 'journey', 'conversation', 'note', 'week-report', 'graduation', 'phase-report'];

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
    case 'phase-report': showView('phase-report'); await renderPhaseReport(parseInt(params.phase) || 1); break;
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

  // helper: spec §5.1 — invalid input gets a --green-walked border (not red), explainer below
  const setInvalid = (el, msg) => {
    el?.classList.add('invalid');
    err.textContent = msg;
    err.classList.remove('hidden');
  };
  const clearInvalid = () => {
    emailEl.classList.remove('invalid');
    nameEl.classList.remove('invalid');
    err.classList.add('hidden');
  };
  emailEl.addEventListener('input', clearInvalid);
  nameEl.addEventListener('input', clearInvalid);

  form.onsubmit = async (e) => {
    e.preventDefault();
    clearInvalid();
    const email = (emailEl.value || '').trim().toLowerCase();
    if (!email || !email.includes('@') || !email.includes('.')) {
      setInvalid(emailEl, '這個 email 看起來不太對，再看一下。');
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
      setInvalid(emailEl, '沒能送出，我們再試一次。');
    } finally {
      btn.disabled = false;
    }
  };
}

// ─── §5.2 journey (v2.1-green: 3-col snake + plant tiles + snake path + treasures) ───
async function renderJourney() {
  document.getElementById('journey-header-label').textContent = `看見自己 · 第${state.currentDay || 1}天`;

  // P2 (PR-4c-green) §5.2 — personalised title「{name} 的看見自己之旅」(Vivi 拍板)
  const titleEl = document.getElementById('journey-title');
  if (titleEl) {
    titleEl.textContent = state.preferredName ? `${state.preferredName} 的看見自己之旅` : '你的看見自己之旅';
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

  // 21 day-tiles in 3-col snake order. Inline grid-row/column placement so
  // DOM stays day-1..21 (a11y / tab order) while visual layout snakes.
  const grid = document.getElementById('journey-grid');
  grid.innerHTML = '';
  const days = (j.days || []).slice();
  while (days.length < 21) days.push({ day: days.length + 1, state: 'future', phrase: null });

  for (const cell of days) {
    grid.appendChild(renderDayTile(cell));
  }

  // 5 treasure boxes (one per phase). P2 hardcodes all locked — phases[] endpoint
  // is P4. Click is no-op until then. Visible labels = roman; full names in title.
  renderTreasureShelf(j.phases /* may be undefined at P2 */);

  // Day-1 bottom prompt
  const prompt = document.getElementById('journey-prompt');
  if ((j.currentDay || 0) <= 1) prompt.classList.remove('hidden');
  else prompt.classList.add('hidden');

  // Draw snake path AFTER layout — wait a paint to get correct getBoundingClientRect.
  requestAnimationFrame(() => requestAnimationFrame(() => drawSnakePath()));

  setupJourneyResizeObserver();
}

/** v2.1-green DayTile — 4 visually distinct states (Vivi correction A: never collapse). */
function renderDayTile(c) {
  // map server "revealed" → frontend "completed" (same semantics, new name)
  const stateName = c.state === 'revealed' ? 'completed' : c.state;
  const isFuture = stateName === 'future';

  const div = document.createElement('div');
  div.className = `day-tile day-tile--${stateName}`;
  div.setAttribute('role', 'listitem');
  div.dataset.day = String(c.day);
  div.dataset.state = stateName;
  div.tabIndex = isFuture ? -1 : 0;
  div.setAttribute('aria-label', `第 ${c.day} 天，${ariaState(stateName)}`);

  // snake positioning — DOM order stays day-1..21, visual order snakes
  const { row, col } = snakeRowCol(c.day);
  div.style.gridRow = String(row + 1);
  div.style.gridColumn = String(col + 1);

  // content
  // PR-4c-green Patrick 5/24 — new「角色旅程」插畫 (WebP, full-bleed scenes,
  // not去背). Every tile now carries the scene; future tiles get a grayscale +
  // dark overlay treatment via CSS for the locked-puzzle feel. Old class name
  // .day-tile__plant retired (植物 metaphor is gone) → .day-tile__scene.
  div.innerHTML = `
    <img class="day-tile__scene" src="/assets/days/day${c.day}.webp" alt="" loading="lazy">
    <span class="day-tile__day">${c.day}</span>
    ${isFuture ? FOOTPRINT_SVG : ''}
    ${stateName === 'completed' || stateName === 'active-filled'
      ? `<span class="day-tile__check" aria-hidden="true">${CHECK_SVG}</span>`
      : ''}
    ${stateName === 'active-empty'
      ? `<span class="day-tile__start-pill">開始</span>`
      : ''}
  `;

  if (!isFuture) {
    const handler = () => {
      if (stateName === 'active-empty') {
        // today, still going → into conversation
        location.hash = '#/conversation';
      } else {
        // completed (past) OR active-filled (today, just done) → that day's note
        location.hash = `#/note?day=${c.day}`;
      }
    };
    div.addEventListener('click', handler);
    div.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handler(); }
    });
  }
  return div;
}

/** 21 days in 3 cols, snake order:
 *    row 0 (D1-3):   cols 0,1,2 left→right
 *    row 1 (D4-6):   cols 2,1,0 right→left
 *    row 2 (D7-9):   cols 0,1,2 left→right
 *    …alternating through row 6 (D19-21)
 */
function snakeRowCol(day) {
  const idx = day - 1;
  const row = Math.floor(idx / 3);
  const col = (row % 2 === 0) ? (idx % 3) : (2 - (idx % 3));
  return { row, col };
}

const PHASE_NAMES = [
  '找到你真正要的',
  '你是誰',
  '擴大地圖',
  '串連起來',
  '放手帶著走',
];
const PHASE_ROMAN = ['I', 'II', 'III', 'IV', 'V'];

function renderTreasureShelf(phases /* /api/journey returns this at P4+ */) {
  const shelf = document.getElementById('treasure-shelf');
  if (!shelf) return;
  shelf.innerHTML = '';

  // P4: phases[] now comes from /api/journey (computePhaseReportStates(currentPhase))
  // — server-decided which treasures are unlocked. Pre-P4 clients (or a defensive
  // server fallback) may not send the array; in that case all stay locked.
  const states = Array.isArray(phases) && phases.length === 5
    ? phases.map(p => (p && p.state) || 'locked')
    : Array.from({ length: 5 }, () => 'locked');

  for (let i = 0; i < 5; i++) {
    const stateName = states[i] === 'unlocked' ? 'unlocked' : 'locked';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `treasure-box treasure-box--${stateName}`;
    btn.disabled = stateName === 'locked';
    btn.setAttribute('aria-label', `寶藏 ${PHASE_ROMAN[i]} · ${PHASE_NAMES[i]}，${stateName === 'unlocked' ? '已解鎖' : '尚未解鎖'}`);
    btn.title = PHASE_NAMES[i];
    btn.innerHTML = `${TREASURE_SVG}<span class="treasure-box__roman">${PHASE_ROMAN[i]}</span>`;
    if (stateName === 'unlocked') {
      btn.addEventListener('click', () => {
        location.hash = `#/phase-report?phase=${i + 1}`;
      });
    }
    shelf.appendChild(btn);
  }
}

/** Compute the dotted snake-path d= from the laid-out tile centers. */
function drawSnakePath() {
  const path = document.getElementById('journey-path-line');
  const grid = document.getElementById('journey-grid');
  if (!path || !grid) return;
  const gridRect = grid.getBoundingClientRect();
  const pts = [];
  // Iterate tiles in DOM order (= day-1..21). Only include non-future ones.
  for (const tile of grid.querySelectorAll('.day-tile')) {
    if (tile.dataset.state === 'future') break;   // future never connects, stop at first
    const r = tile.getBoundingClientRect();
    pts.push({
      x: r.left - gridRect.left + r.width / 2,
      y: r.top  - gridRect.top  + r.height / 2,
    });
  }
  if (pts.length === 0) { path.setAttribute('d', ''); return; }
  let d = `M ${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)}`;
  for (let i = 1; i < pts.length; i++) {
    d += ` L ${pts[i].x.toFixed(1)} ${pts[i].y.toFixed(1)}`;
  }
  path.setAttribute('d', d);
}

/** ResizeObserver lives once for the page; recomputes path on grid resize. */
let _journeyResizeObserver = null;
function setupJourneyResizeObserver() {
  if (_journeyResizeObserver) return;
  const grid = document.getElementById('journey-grid');
  if (!grid || typeof ResizeObserver === 'undefined') return;
  _journeyResizeObserver = new ResizeObserver(() => {
    if (document.getElementById('view-journey')?.classList.contains('active')) {
      drawSnakePath();
    }
  });
  _journeyResizeObserver.observe(grid);
  // also redraw on window resize (paranoid — RO catches most cases)
  window.addEventListener('resize', () => {
    if (document.getElementById('view-journey')?.classList.contains('active')) {
      drawSnakePath();
    }
  });
}

function ariaState(s) {
  return s === 'future'        ? '還沒到'
       : s === 'active-empty'  ? '今天，點開進入對話'
       : s === 'active-filled' ? '今天，已完成'
       : s === 'completed'     ? '已揭開' : s;
}
function escapeText(s) { const d = document.createElement('div'); d.textContent = String(s ?? ''); return d.innerHTML; }

// ─── inline SVG icons (zero asset dependency per spec §9) ──────────
const FOOTPRINT_SVG = `
<svg class="day-tile__footprint" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
  <ellipse cx="12" cy="14" rx="4" ry="6" fill="currentColor" opacity="0.55" stroke="none"/>
  <circle cx="8.5"  cy="6.5" r="1.4" fill="currentColor" opacity="0.55" stroke="none"/>
  <circle cx="11.5" cy="5"   r="1.4" fill="currentColor" opacity="0.55" stroke="none"/>
  <circle cx="14.5" cy="5.5" r="1.4" fill="currentColor" opacity="0.55" stroke="none"/>
  <circle cx="16.5" cy="8"   r="1.2" fill="currentColor" opacity="0.55" stroke="none"/>
</svg>`;

const CHECK_SVG = `
<svg viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <polyline points="3,7.5 6,10.5 11,4.5"/>
</svg>`;

const TREASURE_SVG = `
<svg class="treasure-box__icon" viewBox="0 0 24 24" fill="none" aria-hidden="true">
  <rect x="3.5" y="9"  width="17" height="11" rx="2"   stroke="currentColor" stroke-width="1.4"/>
  <rect x="3.5" y="9"  width="17" height="4.5" rx="1.5" fill="currentColor" opacity="0.25"/>
  <line x1="3.5" y1="13.5" x2="20.5" y2="13.5" stroke="currentColor" stroke-width="1.2"/>
  <circle cx="12" cy="13.5" r="1.6" fill="currentColor"/>
</svg>`;

// ─── §5.3 conversation (PR-4c-green: 「{name} · 第N天」 header per spec) ───
async function renderConversation() {
  // P3: header = 「{preferredName} · 第N天」 (was 「看見自己 · 第N天」)
  const headerName = state.preferredName || '你';
  document.getElementById('conv-header-label').textContent = `${headerName} · 第${state.currentDay || 1}天`;
  const scroll = document.getElementById('conv-scroll');
  scroll.innerHTML = '';
  // PR-4c-green Patrick 5/24 — hero scene at the top of #conv-scroll. Scrolls
  // away with content so the input bar stays docked (mobile-friendly). 1:1
  // square scene; CSS caps the visual height so it doesn't swallow the screen.
  const day = state.currentDay || 1;
  scroll.insertAdjacentHTML('beforeend', `
    <figure class="day-hero">
      <img class="day-hero__img" src="/assets/days/hero/day${day}.webp"
           alt="" loading="eager" decoding="async">
    </figure>
  `);
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

  // P3 (PR-4c-4f) — show the chain-追問 explainer ONLY on Day 1 (same Day-1-only
  // pattern as journey 「點開今天」 bottom prompt). After Day 1 the chain pattern is
  // familiar; the hint would be noise.
  const chainHint = document.getElementById('conv-chain-hint');
  if (chainHint) {
    if ((state.currentDay || 1) <= 1) chainHint.classList.remove('hidden');
    else                              chainHint.classList.add('hidden');
  }

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
 *
 * PR-4c-green E4 修法 1 — auto-retry on 409 PRIOR_FINALIZE_PENDING. Self-paced
 * students can race ahead of yesterday's finalize-day write; backend returns 409
 * with a retryAfterMs hint, frontend waits + retries (max ~30s total). Swaps the
 * placeholder copy to「教練還在寫昨天的字…」so the wait is legible.
 */
async function requestKickoffOpening() {
  const scroll = document.getElementById('conv-scroll');
  const placeholder = document.createElement('div');
  placeholder.className = 'conv-waiting';
  // P2 (PR-4c-4f): ellipsis + .star paper-breathe (CSS) → signals "in progress" without SaaS spinner
  placeholder.innerHTML = '<span class="star">✦</span><span class="text">教練在打開今天…</span>';
  scroll.appendChild(placeholder);

  const MAX_RETRIES = 10;     // ~30s cap @ 3s each — finalize-day's Sonnet call rarely exceeds this
  const FALLBACK_BACKOFF_MS = 3000;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
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
      return;
    } catch (e) {
      // PR-4c-green E4 修法 1 — finalize race: wait, swap copy, retry.
      if (e && e.status === 409 && typeof e.body === 'string' && e.body.includes('PRIOR_FINALIZE_PENDING')) {
        let retryAfter = FALLBACK_BACKOFF_MS;
        try {
          const parsed = JSON.parse(e.body);
          if (typeof parsed.retryAfterMs === 'number') retryAfter = parsed.retryAfterMs;
        } catch { /* keep fallback */ }
        // Swap copy so the wait reads as「教練還沒寫完昨天的字」, not stuck-open-loading
        placeholder.querySelector('.text').textContent = '教練還在寫昨天的字…';
        await sleep(retryAfter);
        continue;
      }
      // Any other error → bail with the existing米棕 hint-italic message
      placeholder.remove();
      const div = document.createElement('div');
      div.className = 'hint-italic';
      div.style.marginBottom = '22px';
      div.textContent = '沒能打開今天，待會再試。';
      scroll.appendChild(div);
      return;
    }
  }

  // Exhausted retries — fall back to the calm hint, let user retry manually
  placeholder.remove();
  const div = document.createElement('div');
  div.className = 'hint-italic';
  div.style.marginBottom = '22px';
  div.textContent = '昨天的字還在寫、待會再回來。';
  scroll.appendChild(div);
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

// ─── §5.4 note (PR-4c-green: 「{name} · 第N天」 + context-aware buttons) ───
async function renderNote(day) {
  // P3: header「{preferredName} · 第N天」(was「看見自己 · 第N天」)
  const headerName = state.preferredName || '你';
  document.getElementById('note-header-label').textContent = `${headerName} · 第${day}天`;
  // PR-4c-green Patrick 5/24 — hero scene above the paper-card. Square 1:1 with
  // CSS-capped max-width so it sits naturally above the note (paper-aesthetic
  // "title image of the day"). Same asset as the conversation hero — 1-to-1
  // illustration N = 第 N 天.
  const heroImg = document.getElementById('note-hero-img');
  if (heroImg) heroImg.src = `/assets/days/hero/day${day}.webp`;
  const body = document.getElementById('note-body');
  body.innerHTML = '';

  // P3: button row context per spec §5.4 —
  //   from conversation (closure transition just brought us here) →
  //     【回到旅程】 + 【明天見】
  //   from a journey cell click (re-read past day) →
  //     【回到旅程】 only
  // _pendingNote is set ONLY by startClosureTransition; presence = from-conversation.
  const fromConversation = !!(state._pendingNote && state._pendingNote.day === day);
  const tomorrowBtn = document.getElementById('note-btn-tomorrow');
  if (tomorrowBtn) tomorrowBtn.classList.toggle('hidden', !fromConversation);

  // Note body — bridge from §5.2 closure if present, otherwise fetch from /api/note.
  let text = null;
  if (fromConversation) {
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

// ─── §5.5 Phase Report — 你的寶藏 (P4 green) ──────────────────────
const PHASE_REPORT_LABELS = ['PHASE I', 'PHASE II', 'PHASE III', 'PHASE IV', 'PHASE V'];

async function renderPhaseReport(phaseId) {
  // header「{name} · 你的寶藏」(spec §5.5 — note: 「你的寶藏」 not 「你的旅程」)
  const headerName = state.preferredName || '你';
  const headerEl = document.getElementById('phase-header-label');
  if (headerEl) headerEl.textContent = `${headerName} · 你的寶藏`;

  const eyebrow      = document.getElementById('phase-eyebrow');
  const title        = document.getElementById('phase-title');
  const teaching     = document.getElementById('phase-teaching');
  const breakthrough = document.getElementById('phase-breakthrough');

  // reset
  if (eyebrow)      eyebrow.textContent      = PHASE_REPORT_LABELS[phaseId - 1] || 'PHASE I';
  if (title)        title.textContent        = '—';
  if (teaching)     teaching.innerHTML       = '';
  if (breakthrough) breakthrough.innerHTML   = '';

  if (!Number.isInteger(phaseId) || phaseId < 1 || phaseId > 5) {
    if (teaching) {
      const p = document.createElement('p');
      p.textContent = '（這個寶藏的編號不對，回到旅程再試一次。）';
      teaching.appendChild(p);
    }
    return;
  }

  let r;
  try {
    r = await api(`/api/phase-report?studentId=${encodeURIComponent(state.studentId)}&module=${encodeURIComponent(state.module)}&phase=${phaseId}`);
  } catch (e) {
    if (teaching) {
      const p = document.createElement('p');
      p.textContent = '（沒能取回這個寶藏，待會再試。）';
      teaching.appendChild(p);
    }
    return;
  }

  if (title)   title.textContent = r.name || '—';
  if (eyebrow) eyebrow.textContent = 'PHASE ' + (r.roman || PHASE_REPORT_LABELS[phaseId - 1].replace('PHASE ', ''));

  if (!r.exists) {
    if (teaching) {
      const p = document.createElement('p');
      p.textContent = '（這個寶藏還沒解鎖。繼續走、它會在路上等你。）';
      teaching.appendChild(p);
    }
    return;
  }

  // teaching (upper half — fixed §8 distillation)
  if (teaching && r.teaching) {
    for (const para of String(r.teaching).split(/\n\s*\n/)) {
      const p = document.createElement('p');
      p.textContent = para;
      teaching.appendChild(p);
    }
  }

  // breakthrough (lower half — generated 突破彙整)
  if (breakthrough && r.breakthrough) {
    for (const para of String(r.breakthrough).split(/\n\s*\n/)) {
      const p = document.createElement('p');
      p.textContent = para;
      breakthrough.appendChild(p);
    }
  }
}

// ─── §5.6 graduation (PR-4c-green: 「{name} · 第二十一天」 header) ───
async function renderGraduation() {
  // P3: header「{preferredName} · 第二十一天」
  const headerName = state.preferredName || '你';
  const headerEl = document.getElementById('grad-header-label');
  if (headerEl) headerEl.textContent = `${headerName} · 第二十一天`;

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
