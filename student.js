/* student.js — v5.0 紙感 student SPA
   Routes: #/entry, #/journey, #/conversation, #/note?day=N, #/phase-report?phase=N, #/graduation
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

// ─── session hydration (PR-4c-green Auth rebuild 1h) ──────────────────
// Cookie is the source of truth; localStorage is just a hint. If state.studentId
// is empty (fresh tab / cleared storage / came in via magic-link but auth.html
// localStorage write failed) but the server cookie is still valid, /api/me
// returns the student's identity and we hydrate the SPA state from it.
// 200 → hydrated, gate passes. 401 → genuinely logged-out → bounce to entry.
// In-flight dedup so concurrent route() calls only fire one fetch.
let _hydratePromise = null;
async function hydrateFromCookie() {
  if (_hydratePromise) return _hydratePromise;
  _hydratePromise = (async () => {
    try {
      const me = await api('/api/me');
      if (!me || typeof me !== 'object' || !me.studentId) return false;
      state.studentId     = me.studentId;
      state.module        = me.module        || 'self';
      state.currentDay    = me.currentDay    || 1;
      state.preferredName = me.preferredName ?? state.preferredName ?? null;
      state.pace          = me.pace          || state.pace || 'daily';
      saveState();
      return true;
    } catch (e) {
      // 401 = genuinely not logged in; anything else = unexpected (treat as
      // not logged in too — defaulting to entry beats a stuck spinner).
      return false;
    } finally {
      _hydratePromise = null;
    }
  })();
  return _hydratePromise;
}

// ─── view router ───────────────────────────────────────────────────
// PR-4c-green 5/24 cleanup — 'week-report' view retired (5 phase reports 取代).
const VIEWS = ['entry', 'journey', 'conversation', 'note', 'graduation', 'phase-report', 'upgrade'];

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

  // PR-4c-green Auth rebuild 1h: cookie is the source of truth, localStorage
  // is just a hint. If state.studentId is empty for a non-entry view, ask the
  // server (/api/me) — 200 means we have a valid cookie, hydrate state + pass
  // the gate. 401 means truly logged out → bounce to entry. This fixes the
  // 「magic link verify 成功但 SPA 彈回 entry」 bug + makes 30-day cookie work
  // across fresh tabs / cleared localStorage.
  if (!state.studentId && route !== 'entry') {
    const ok = await hydrateFromCookie();
    if (!ok) {
      location.hash = '#/entry';
      return;
    }
  }

  switch (route) {
    case 'entry':        showView('entry');        renderEntry(); break;
    case 'journey':      showView('journey');      await renderJourney(); break;
    case 'conversation': showView('conversation'); await renderConversation(); break;
    case 'note':         showView('note');         await renderNote(parseInt(params.day) || state.currentDay); break;
    case 'phase-report': showView('phase-report'); await renderPhaseReport(parseInt(params.phase) || 1); break;
    case 'graduation':   showView('graduation');   await renderGraduation(); break;
    case 'upgrade':      showView('upgrade');      renderUpgradeCTA(); break;
    default:             location.hash = '#/entry';
  }
}

// 5/28 Patrick — 常見 email 網域 typo 偵測 (Levenshtein distance = 1).
// 預防 A006 case (用戶打成 @gamil.com → 信永遠送不到 → 看似申請成功但 token
// 過期). 非阻擋、只提示「你是不是要輸入 ...?」.
const KNOWN_EMAIL_DOMAINS = [
  'gmail.com', 'yahoo.com', 'yahoo.com.tw', 'hotmail.com', 'outlook.com',
  'icloud.com', 'me.com', 'live.com', 'msn.com', 'pchome.com.tw',
];
// Damerau-Levenshtein 距離 = 1 (insert/delete/substitute + adjacent transpose).
// A006 的 gamil↔gmail 是 adjacent swap、pure Lev 算 2、必須走 Damerau.
// ⚠️ 跟 lib/util/email-typo.js 同步、lib/util/email-typo.test.js 鎖行為.
function levenshtein1(a, b) {
  if (a === b) return false;
  const la = a.length, lb = b.length;
  if (Math.abs(la - lb) > 1) return false;
  // Path 1: classic Lev1.
  {
    let i = 0, j = 0, diffs = 0;
    while (i < la && j < lb) {
      if (a[i] === b[j]) { i++; j++; continue; }
      diffs++;
      if (diffs > 1) { diffs = 99; break; }
      if (la > lb)      i++;
      else if (la < lb) j++;
      else              { i++; j++; }
    }
    if (diffs <= 1) {
      if (i < la || j < lb) diffs++;
      if (diffs === 1) return true;
    }
  }
  // Path 2: adjacent-char transposition (equal-length only).
  if (la === lb) {
    let k = 0;
    while (k < la && a[k] === b[k]) k++;
    if (k < la - 1 && a[k] === b[k + 1] && a[k + 1] === b[k]) {
      let m = k + 2;
      while (m < la && a[m] === b[m]) m++;
      if (m === la) return true;
    }
  }
  return false;
}
function suggestEmailFix(email) {
  if (typeof email !== 'string') return null;
  const at = email.lastIndexOf('@');
  if (at < 1) return null;
  const local  = email.slice(0, at);
  const domain = email.slice(at + 1).toLowerCase().trim();
  if (!domain) return null;
  if (KNOWN_EMAIL_DOMAINS.includes(domain)) return null;   // 已是 known domain、不提示
  for (const d of KNOWN_EMAIL_DOMAINS) {
    if (levenshtein1(domain, d)) return `${local}@${d}`;
  }
  return null;
}
// Expose for tests / window probing.
if (typeof window !== 'undefined') {
  window.__suggestEmailFix = suggestEmailFix;
  window.__levenshtein1 = levenshtein1;
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

  // 5/28 Patrick — email typo 提示 (預防 A006 case). 動態建一個 hint 容器
  // (不改 index.html), input event 動態檢查; 「用建議的」 換值、「我就是這個」
  // 隱藏. 非阻擋: submit 不會因為有提示就 reject.
  let typoHint = document.getElementById('entry-email-typo-hint');
  if (!typoHint) {
    typoHint = document.createElement('div');
    typoHint.id = 'entry-email-typo-hint';
    typoHint.className = 'hint-italic';
    typoHint.hidden = true;
    typoHint.style.cssText = 'margin-top:6px;font-size:12px;color:var(--text-secondary);';
    emailEl.insertAdjacentElement('afterend', typoHint);
  }
  function refreshTypoHint() {
    const suggestion = suggestEmailFix((emailEl.value || '').trim());
    if (!suggestion) {
      typoHint.hidden = true;
      typoHint.textContent = '';
      return;
    }
    typoHint.hidden = false;
    typoHint.innerHTML = '';
    const text = document.createElement('span');
    text.textContent = `你是不是要輸入 ${suggestion}？`;
    typoHint.appendChild(text);
    const useBtn = document.createElement('button');
    useBtn.type = 'button';
    useBtn.textContent = '用建議的';
    useBtn.className = 'paper-btn';
    useBtn.style.cssText = 'margin-left:8px;padding:2px 8px;font-size:11px;';
    useBtn.onclick = () => {
      emailEl.value = suggestion;
      typoHint.hidden = true;
      clearInvalid();
    };
    const keepBtn = document.createElement('button');
    keepBtn.type = 'button';
    keepBtn.textContent = '我就是這個';
    keepBtn.className = 'paper-btn';
    keepBtn.style.cssText = 'margin-left:6px;padding:2px 8px;font-size:11px;';
    keepBtn.onclick = () => { typoHint.hidden = true; };
    typoHint.appendChild(useBtn);
    typoHint.appendChild(keepBtn);
  }
  emailEl.addEventListener('input', refreshTypoHint);
  emailEl.addEventListener('blur',  refreshTypoHint);
  refreshTypoHint();   // initial (pre-fill from state.email)

  // PR-4c-green Auth rebuild stage 1c — magic-link flow replaces direct
  // email-as-identity. Submit no longer puts the student into the app; it
  // POSTs to /api/auth/request-link, the server emails a one-time link
  // (?token=…), the student clicks it → /auth.html → /api/auth/verify-link
  // sets the HttpOnly student_session cookie → redirects into /#/journey.
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

    const originalLabel = btn.textContent;
    btn.disabled = true;
    btn.textContent = '送出中…';
    try {
      // request-link always returns 200 ok:true (no email-existence leak)
      await api('/api/auth/request-link', {
        method: 'POST',
        body: { email, preferredName, pace: paceChoice },
      });
      // Replace the form with a calm confirmation. Don't go into the app —
      // student needs to open their inbox + click the link.
      const container = form.closest('.entry-container') || form.parentNode;
      const confirm = document.createElement('div');
      confirm.style.cssText = 'text-align:center;margin-top:32px;line-height:2;';
      confirm.innerHTML = `
        <p class="hint-italic" style="font-size:14px;color:var(--text-primary);">
          登入連結已寄到<br><strong style="color:var(--green-forest);">${email}</strong>
        </p>
        <p class="hint-italic" style="font-size:12px;color:var(--text-secondary);margin-top:14px;">
          打開信箱、點一下、就進來了。<br>連結 60 分鐘內有效。
        </p>
      `;
      form.replaceWith(confirm);
    } catch (e2) {
      setInvalid(emailEl, '沒能送出，我們再試一次。');
      btn.disabled = false;
      btn.textContent = originalLabel;
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
    // PR-4c-green Auth rebuild stage 1d — studentId no longer sent over the wire;
    // server reads sid from the HttpOnly student_session cookie.
    j = await api(`/api/journey?module=${encodeURIComponent(state.module)}`);
  } catch (e) {
    j = { module: state.module, moduleLabel: '看見自己', currentDay: state.currentDay || 0, days: [], graduation: { state: 'future' } };
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

  // 5 treasure boxes (one per phase). P4 endpoint serves phases[].
  // 5/25 Vivi：寶藏暫藏 (教學內容未定). index.html 已把標題 + 架設 hidden;
  // 恢復＝拿掉 index.html 上的 hidden 屬性. 這裡 guard 避免在隱藏元素上做工.
  const _treasureShelf = document.getElementById('treasure-shelf');
  if (_treasureShelf && !_treasureShelf.hidden) renderTreasureShelf(j.phases);

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
  //
  // PR-4c-green Patrick 5/25 (Day-4 實測 C2) — 關視窗重開續上:
  //   localStorage 清掉 / 別台機器 / 別瀏覽器 → state.conversation 為空、但
  //   server 上今天的 session 可能已經開始. 在 kickoff 之前先問 server 有沒有
  //   未完成的 conversation 要還原；有 → 不要 kickoff、把 server 的 messages
  //   塞回 state + 補 render；沒 → fall through 走原本的 kickoff 路徑.
  //   鐵則 1d：endpoint 從 cookie 取 studentId、忽略 client 傳的.
  if (state.conversation.length === 0) {
    let restored = false;
    try {
      const r = await api(`/api/conversation-today?module=${encodeURIComponent(state.module || 'self')}&today=${encodeURIComponent(new Date().toLocaleDateString('sv'))}`);
      if (r && r.hasInProgress && Array.isArray(r.messages) && r.messages.length > 0) {
        if (r.sessionId) state._lastSessionId = r.sessionId;
        for (const m of r.messages) {
          if (m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string') {
            state.conversation.push({ role: m.role, content: m.content });
            appendMessage(m.role, m.content, /*scroll=*/false);
          }
        }
        saveState();
        restored = true;
      }
    } catch (e) {
      // 還原 endpoint 失敗 → fall through 走 kickoff (新的一天的最安全 fallback).
      // 不打擾學員、不顯示 SaaS error；reset 後若真的 day 已開始、Sonnet 會自己
      // 從 phase-context 走 elicitation 變體、不會重複起手式 (E4 inject 接管).
      console.warn('[conversation-today] restore failed, falling back to kickoff:', e?.message || e);
    }
    if (!restored) await requestKickoffOpening();
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
  // Vivi 5/24: typing indicator while Sonnet is composing (3-15s normal).
  // Without it「使用者以為卡住/壞掉」. Paper aesthetic — ✦ + 「教練在想…」,
  // no SaaS spinner. Always removed before the real reply (success), the
  // error hint (fail), or the closure transition kicks in.
  const scroll = document.getElementById('conv-scroll');
  const typing = document.createElement('div');
  typing.className = 'conv-typing';
  typing.setAttribute('aria-live', 'polite');
  typing.innerHTML = '<span class="star">✦</span><span class="text">教練在想…</span>';
  scroll.appendChild(typing);
  // Single small nudge so the indicator is in view; §五.四 no continuous auto-scroll.
  scroll.scrollTo({ top: scroll.scrollHeight, behavior: 'smooth' });

  try {
    // PR-4c-green Auth rebuild stage 1d — no studentId in body (server reads sid from cookie).
    const r = await api('/api/chat', {
      method: 'POST',
      body: {
        messages: state.conversation,
        module: state.module,
        today: new Date().toLocaleDateString('sv'),
      },
    });
    typing.remove();
    if (r && r.sessionId) state._lastSessionId = r.sessionId;
    const aiContent = r.content || '';
    state.conversation.push({ role: 'assistant', content: aiContent });
    appendMessage('assistant', aiContent);
    if (r.dayComplete) await startClosureTransition();
  } catch (e) {
    typing.remove();
    // 5/26 Patrick (漏斗 Stage 1/2) — trial 撞 Day ≥ 2 → 402 → 轉去 CTA.
    if (e && e.status === 402) { location.hash = '#/upgrade'; return; }
    // §六: 米棕色平靜 inline message (not red banner)
    const div = document.createElement('div');
    div.className = 'hint-italic';
    div.style.marginBottom = '22px';
    div.textContent = '沒能送出，我們再試一次。';
    scroll.appendChild(div);
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
      // PR-4c-green Auth rebuild stage 1d — no studentId in body (server reads sid from cookie).
      const r = await api('/api/chat', {
        method: 'POST',
        body: {
          kickoff: true,
          // messages: [] — chat.js will synthesize the sentinel internally
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
      // 5/26 Patrick (漏斗 Stage 1/2) — trial 撞 Day ≥ 2 → 402 → 轉去 CTA.
      // 必須先於 409 PRIOR_FINALIZE_PENDING 分支 (那是 self-paced 同一天).
      if (e && e.status === 402) {
        placeholder.remove();
        location.hash = '#/upgrade';
        return;
      }
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

// 「教練在寫今天的字」來回逐字打 loop (5/25 Vivi 米白底黑字 + 逐字感).
// 打進去→停→刪掉→停→再打、loop. 回 stop() 在轉場結束時 clearTimeout.
// ⚠️ 只動 closure loading 文字; 筆記本身仍維持一次貼上 (renderNote 不變).
function startClosureTypewriter(textEl) {
  if (!textEl) return () => {};
  const FULL = '教練在寫今天的字';
  let i = 0, phase = 'typing', timer = null;
  function tick() {
    if (phase === 'typing') {
      i++; textEl.textContent = FULL.slice(0, i);
      if (i >= FULL.length) { phase = 'holdFull'; timer = setTimeout(tick, 700); return; }
      timer = setTimeout(tick, 130);
    } else if (phase === 'holdFull') {
      phase = 'erasing'; timer = setTimeout(tick, 80);
    } else if (phase === 'erasing') {
      i--; textEl.textContent = FULL.slice(0, i);
      if (i <= 0) { phase = 'holdEmpty'; timer = setTimeout(tick, 450); return; }
      timer = setTimeout(tick, 80);
    } else { // holdEmpty
      phase = 'typing'; timer = setTimeout(tick, 130);
    }
  }
  tick();
  return () => { if (timer) clearTimeout(timer); };
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
  // 5/25 Vivi: 來回逐字打「教練在寫今天的字」 — 打進→停→刪→再打 loop.
  // textContent 反覆 overwrite the static HTML; stop() 在 navigate 前 clear timer.
  const stopClosureTypewriter = startClosureTypewriter(closure.querySelector('.text'));

  // fire finalize-day NOW (in parallel with the 2.8s hold)
  // sessionId comes from the last /api/chat response (stashed in state._lastSessionId)
  state.finalizing = true;
  // PR-4c-green Auth rebuild stage 1d — no studentId in body. Server enforces
  // that sessionId belongs to the authenticated student (sid from cookie).
  const finalizeP = api('/api/finalize-day', {
    method: 'POST',
    body: {
      sessionId:  state._lastSessionId,
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

  // 🚨 Patrick 5/25 leak fix: route closure note from finalizeResult.notebookPage
  // (sanitized, fail-closed by /api/finalize-day's safeNoteForStudent) — NEVER
  // from damonNotePublic (the raw publicNote from generateDamonNote, which on
  // A001 Day 3 shipped 【深度層次】 + Layer 1-5 to the student SPA).
  //
  // Defense in depth: also re-check at the client boundary — if any 【…】
  // bracket marker survives, swap for safe fallback. Server already does
  // fail-closed; this is the same property enforced at the last possible
  // moment before the DOM render.
  const FORBIDDEN_RE = /【(深度層次|SC 觀察|還沒碰到的|關鍵句|今天的模式|採集追蹤|Scope 證據|賦予新角色狀態|確定類別 \+ Scope|Transfer 結果|微證據|宣言)|Layer\s?[1-5]\b|\bL[1-5]\b|工具[一二三四1234]/u;
  const SAFE_FALLBACK = '（教練筆記稍後送達）';
  let closureBody = SAFE_FALLBACK;
  if (finalizeResult && finalizeResult.ok && typeof finalizeResult.notebookPage === 'string') {
    closureBody = FORBIDDEN_RE.test(finalizeResult.notebookPage)
      ? SAFE_FALLBACK
      : (finalizeResult.notebookPage || SAFE_FALLBACK);
  }
  state._pendingNote = { day: state.currentDay, body: closureBody };

  state.finalizing = false;
  state.conversation = [];           // next day starts fresh in memory
  state.currentDay = (state.currentDay || 0) + 1;   // optimistic — server is the source of truth on next /api/journey load
  saveState();

  stopClosureTypewriter();           // 5/25 Vivi: 停掉逐字 loop、避免 navigate 後 timer 還在跑
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
      // PR-4c-green Auth rebuild stage 1d — no studentId param (server reads sid from cookie).
      const r = await api(`/api/note?module=${encodeURIComponent(state.module)}&day=${day}`);
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

// §4.6 week report — retired (PR-4c-green 5/24 cleanup, 5 phase reports replaces it).

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
    // PR-4c-green Auth rebuild stage 1d — no studentId param (server reads sid from cookie).
    r = await api(`/api/phase-report?module=${encodeURIComponent(state.module)}&phase=${phaseId}`);
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

// ─── 漏斗 Stage 2 — 轉換 CTA (trial 撞 Day 2 → 自動導來這頁) ───
// 點「解鎖完整旅程」→ POST /api/checkout → 拿 Stripe hosted-checkout URL →
// location.href 跳出去. 付款成功 Stripe 導回 #/journey?upgraded=1.
// 鐵則：plan 升級只由驗過簽章的 webhook 寫、前端絕對不能呼叫「設我 plan_a」.
function renderUpgradeCTA() {
  const btn  = document.getElementById('upgrade-btn');
  const errEl = document.getElementById('upgrade-error');
  if (!btn) return;
  if (errEl) errEl.classList.add('hidden');
  // onclick 覆寫避免 route 多次進到這頁時疊加 listener.
  btn.onclick = async () => {
    btn.disabled = true;
    const prevLabel = btn.textContent;
    btn.textContent = '打開付款頁…';
    try {
      const r = await api('/api/checkout', { method: 'POST', body: {} });
      if (r && r.url) {
        location.href = r.url;
        return;            // 跳出本站、不要 reset UI
      }
      throw new Error('no_checkout_url');
    } catch (e) {
      // 401 → 學員 session 沒了、回 entry; 其他 → inline error、可重試.
      if (e && e.status === 401) { location.hash = '#/entry'; return; }
      console.error('[upgrade] checkout open failed:', e?.message || e);
      btn.disabled = false;
      btn.textContent = prevLabel;
      if (errEl) errEl.classList.remove('hidden');
    }
  };
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
  // PR-4c-green Auth rebuild stage 1d — no studentId param (server reads sid from cookie).
  try { g = await api(`/api/graduation?module=${encodeURIComponent(state.module)}`); }
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
  if (nav === 'graduation')   location.hash = '#/graduation';
  if (nav === 'logout')       { clearState(); location.hash = '#/entry'; }
});

// ─── boot ──────────────────────────────────────────────────────────
loadState();
window.addEventListener('hashchange', route);
window.addEventListener('DOMContentLoaded', async () => {
  // PR-4c-green Auth rebuild 1h — boot is also subject to cookie-as-truth.
  // If localStorage is empty but the student_session cookie is valid, default
  // landing should be /#/journey (not /#/entry). route() does the actual
  // hydrate via hydrateFromCookie when the gate fires; here we just pick the
  // initial hash so the cookied user lands on journey instead of entry.
  const noHash = !location.hash || location.hash === '#/';
  if (noHash) {
    if (state.studentId) {
      location.hash = '#/journey';
    } else {
      const ok = await hydrateFromCookie();
      location.hash = ok ? '#/journey' : '#/entry';
    }
  }
  route();
});
