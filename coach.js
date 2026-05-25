/* coach.js — v5.0 coach admin SPA
   Hash routes: #/   (list)   |   #/student/<id>   (per-student detail)
   Auth: assumes Google OAuth via /api/auth/[...nextauth] is already established
   (admin endpoints will 401 if not — fetch errors surface inline).
*/
'use strict';

async function api(path) {
  const res = await fetch(path);
  if (res.status === 401) { location.href = '/coach-login.html'; throw new Error('unauthorized'); }
  if (!res.ok) throw new Error('http_' + res.status);
  return res.json();
}

function show(viewId) {
  document.getElementById('coach-view-list').classList.toggle('hidden', viewId !== 'list');
  document.getElementById('coach-view-student').classList.toggle('hidden', viewId !== 'student');
}

function escapeText(s) { const d = document.createElement('div'); d.textContent = String(s ?? ''); return d.innerHTML; }
// PR-4c-green P5: extended to 5 phases (was 3 weeks). The week-report I/II/III
// grid is gone; the Phase Report shelf takes Roman 1..5.
function roman(n) { return ['I', 'II', 'III', 'IV', 'V'][n - 1] || ''; }
const PHASE_NAMES = ['找到你真正要的', '你是誰', '擴大地圖', '串連起來', '放手帶著走'];

// ─── list view ─────────────────────────────────────────────────────
async function renderList() {
  show('list');
  const list = document.getElementById('coach-students-list');
  list.innerHTML = '';
  let payload;
  try { payload = await api('/api/students'); }
  catch (e) {
    list.innerHTML = `<p class="muted" style="padding:14px;">${escapeText('沒能取回學員清單：' + e.message)}</p>`;
    return;
  }
  // existing /api/students returns either { students: [...] } or [...] depending on shape;
  // tolerate both
  const students = Array.isArray(payload) ? payload : (payload.students || []);
  if (students.length === 0) {
    list.innerHTML = `<p class="muted" style="padding:14px;">目前沒有學員。</p>`;
    return;
  }
  for (const s of students) {
    const row = document.createElement('div');
    row.className = 'coach-list__row';
    row.tabIndex = 0;
    row.innerHTML = `
      <div class="coach-list__sid">${escapeText(s.student_id)}</div>
      <div class="coach-list__email">${escapeText(s.email || '—')}</div>
      <div class="coach-list__day">Day ${escapeText(s.current_day ?? '—')}</div>
      <div class="coach-list__open">看 →</div>`;
    const open = () => { location.hash = `#/student/${encodeURIComponent(s.student_id)}`; };
    row.addEventListener('click', open);
    row.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); open(); } });
    list.appendChild(row);
  }
}

// ─── student detail view ───────────────────────────────────────────
async function renderStudent(sid) {
  show('student');
  document.getElementById('coach-student-title').textContent = `學員 · ${sid}`;
  document.getElementById('coach-student-meta').textContent = '';
  const grid     = document.getElementById('coach-journey-grid');
  const gradCell = document.getElementById('coach-grad-cell');
  const phaseBox = document.getElementById('coach-phase-reports');
  const picker   = document.getElementById('coach-day-picker');
  const noteEl   = document.getElementById('coach-day-note');
  const gradEl   = document.getElementById('coach-graduation');
  grid.innerHTML = ''; gradCell.innerHTML = ''; phaseBox.innerHTML = '';
  picker.innerHTML = ''; noteEl.textContent = '點上方某一天看當日筆記。'; gradEl.textContent = '';

  let j;
  // 5/25 fix (Vivi: 所有學員顯示同一人) — add explicit audience=coach so the
  // server uses ?studentId from query (coach gate) instead of falling back to
  // this browser's student_session cookie (which would always show A001).
  try { j = await api(`/api/journey?studentId=${encodeURIComponent(sid)}&module=self&audience=coach`); }
  catch (e) {
    grid.innerHTML = `<p class="muted">${escapeText('沒能取回旅程：' + e.message)}</p>`;
    return;
  }
  document.getElementById('coach-student-meta').textContent = `current_day = ${j.currentDay} · module = ${j.module}`;

  // PR-4c-green P5: mini grid is now 3×7 daily only (週報 retired per spec 09 §10).
  // Old 3×8 layout had a 「week I/II/III」 column on the right — gone. Phase Reports
  // render below as their own section instead.
  const days   = (j.days   || []);
  const phases = (j.phases || []);
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 7; col++) {
      const c = days[row * 7 + col] || { day: row * 7 + col + 1, state: 'future', phrase: null };
      const div = document.createElement('div');
      div.className = `coach-mini-cell${c.state === 'active-empty' || c.state === 'active-filled' ? ' coach-mini-cell--active' : c.state === 'revealed' ? ' coach-mini-cell--revealed' : ''}`;
      div.title = `Day ${c.day} · ${c.state}${c.phrase ? ' · ' + c.phrase : ''}`;
      div.textContent = c.phrase || `D${c.day}`;
      grid.appendChild(div);
    }
  }
  if (j.graduation) {
    const gc = document.createElement('div');
    gc.className = `coach-mini-cell coach-mini-cell--graduation${j.graduation.state !== 'future' ? ' coach-mini-cell--active' : ''}`;
    gc.textContent = `結業 (${j.graduation.state})`;
    gradCell.appendChild(gc);
  }

  // PR-4c-green P5: 5 Phase Reports (spec 09 §5.5). Fetch each unlocked phase
  // with audience=coach so the breakthrough is the FULL Sonnet output (not the
  // student-side sanitized version). Locked phases get a one-line placeholder.
  // 5/25 Vivi: phase reports section 在 coach.html hidden (教學內容未定). Guard
  // 跳過 5 phase fetches — 隱藏時就不浪費 API 呼叫. 恢復＝拿掉 coach.html 上的
  // hidden 屬性, 不用動這段 code.
  if (phaseBox && !phaseBox.hidden) {
    for (let phaseId = 1; phaseId <= 5; phaseId++) {
      const p = phases[phaseId - 1] || { state: 'locked' };
      const card = document.createElement('div');
      card.className = 'coach-pre';
      if (p.state === 'locked') {
        card.innerHTML = `<strong>Phase ${roman(phaseId)} · ${escapeText(PHASE_NAMES[phaseId - 1])}</strong>  <span class="muted" style="font-size:11px;">（尚未解鎖）</span>`;
        phaseBox.appendChild(card);
        continue;
      }
      try {
        const r = await api(`/api/phase-report?studentId=${encodeURIComponent(sid)}&module=self&phase=${phaseId}&audience=coach`);
        const head = `<strong>Phase ${escapeText(r.roman || roman(phaseId))} · ${escapeText(r.name || PHASE_NAMES[phaseId - 1])}</strong>`;
        if (!r.exists) {
          card.innerHTML = `${head}  <span class="muted" style="font-size:11px;">（還沒生成）</span>`;
        } else {
          const teaching     = escapeText(r.teaching || '');
          const breakthrough = escapeText(r.breakthrough || '');
          card.innerHTML = `${head}\n\n【教學】\n${teaching}\n\n【你的突破（完整版）】\n${breakthrough}`;
        }
      } catch (e) {
        card.innerHTML = `<strong>Phase ${roman(phaseId)}</strong>  <span class="muted" style="font-size:11px;">沒能取回：${escapeText(e.message)}</span>`;
      }
      phaseBox.appendChild(card);
    }
  }

  // PR-4c-green Patrick 5/24 — coach-only full transcript collapsible.
  // Lives below the day-note. Hidden until a day is picked; pinned to the
  // currently-selected day. Lazy-fetches via /api/admin/transcript (gated by
  // the HMAC coach_session cookie set by /api/coach-auth) on first open per
  // day; cached per session so re-toggling within the same day doesn't re-hit.
  const transcriptWrap   = document.getElementById('coach-transcript-wrap');
  const transcriptToggle = document.getElementById('coach-transcript-toggle');
  const transcriptBody   = document.getElementById('coach-transcript-body');
  const transcriptCache  = new Map();   // dayN → rendered HTML
  let transcriptCurrentDay = null;

  function renderTranscript(payload, day) {
    const msgs = Array.isArray(payload?.messages) ? payload.messages : [];
    if (msgs.length === 0) {
      return `<div class="coach-transcript-empty">（Day ${day} 還沒有對話。）</div>`;
    }
    return msgs.map(m => {
      const roleLabel = m.role === 'user' ? '學員' : '教練';
      const stamp = m.createdAt ? new Date(m.createdAt).toLocaleTimeString('zh-TW', {
        hour: '2-digit', minute: '2-digit',
      }) : '';
      return `<div class="coach-transcript-msg coach-transcript-msg--${escapeText(m.role)}">
        <div class="coach-transcript-msg__role">${escapeText(roleLabel)}
          ${stamp ? `<span class="coach-transcript-msg__time">${escapeText(stamp)}</span>` : ''}
        </div>
        <div class="coach-transcript-msg__body">${escapeText(m.content || '')}</div>
      </div>`;
    }).join('');
  }

  async function loadTranscriptIfNeeded(day) {
    if (transcriptCache.has(day)) {
      transcriptBody.innerHTML = transcriptCache.get(day);
      return;
    }
    transcriptBody.innerHTML = '<div class="coach-transcript-empty">讀取中…</div>';
    try {
      const r = await api(`/api/admin/transcript?studentId=${encodeURIComponent(sid)}&module=self&day=${day}`);
      const html = renderTranscript(r, day);
      transcriptCache.set(day, html);
      transcriptBody.innerHTML = html;
    } catch (e) {
      const code = (e && e.status) || '';
      const msg = code === 401
        ? '沒有教練 session、請從 /coach-login 重新登入。'
        : ('沒能取回逐字：' + (e?.message || code));
      transcriptBody.innerHTML = `<div class="coach-transcript-empty">${escapeText(msg)}</div>`;
    }
  }

  function setTranscriptCollapsed(collapsed) {
    transcriptBody.style.display = collapsed ? 'none' : 'block';
    transcriptToggle.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
    // Vivi 5/24:「展開↔收起」 (was「▸/▾ 展開完整對話」 both sides — same word
    // confused testers who didn't notice the arrow change).
    transcriptToggle.textContent = collapsed
      ? '▸ 展開完整對話（教練專用）'
      : '▾ 收起完整對話（教練專用）';
  }

  // Wire the toggle once per renderStudent call (idempotent — replaceWith resets listener).
  const freshToggle = transcriptToggle.cloneNode(true);
  transcriptToggle.replaceWith(freshToggle);
  // re-grab references after replaceWith
  const toggleEl = document.getElementById('coach-transcript-toggle');
  toggleEl.addEventListener('click', async () => {
    const isCollapsed = toggleEl.getAttribute('aria-expanded') !== 'true';
    if (isCollapsed) {
      setTranscriptCollapsed(false);
      if (transcriptCurrentDay != null) await loadTranscriptIfNeeded(transcriptCurrentDay);
    } else {
      setTranscriptCollapsed(true);
    }
  });
  // Start collapsed + hidden (no day picked yet).
  setTranscriptCollapsed(true);
  transcriptWrap.style.display = 'none';

  // day picker — every day with revealed/active-filled state gets a button.
  // Vivi 5/24: click SAME day = collapse (toggle off + revert to placeholder).
  // Click DIFFERENT day = switch + load. Active button gets a visual mark so
  // the coach knows which day's note is currently shown.
  const NOTE_PLACEHOLDER = '點上方某一天看當日筆記。';
  let currentNoteDay = null;
  function setActiveDayBtn(day) {
    for (const b of picker.querySelectorAll('button')) {
      b.classList.toggle('paper-btn--active', Number(b.dataset.day) === day);
    }
  }
  for (const d of days) {
    if (d.state === 'future' || d.state === 'active-empty') continue;
    const btn = document.createElement('button');
    btn.className = 'paper-btn';
    btn.style.cssText = 'padding:6px 12px;font-size:12px;letter-spacing:1px;';
    btn.dataset.day = String(d.day);
    btn.textContent = `D${d.day}${d.phrase ? ' · ' + d.phrase : ''}`;
    btn.addEventListener('click', async () => {
      // Toggle off: same day clicked while already shown → collapse + clear.
      if (currentNoteDay === d.day) {
        currentNoteDay = null;
        noteEl.textContent = NOTE_PLACEHOLDER;
        setActiveDayBtn(null);
        // Also hide the transcript wrap (no day in focus).
        transcriptCurrentDay = null;
        transcriptWrap.style.display = 'none';
        setTranscriptCollapsed(true);
        transcriptBody.innerHTML = '';
        return;
      }
      // Switch / first click: load the note for this day.
      currentNoteDay = d.day;
      setActiveDayBtn(d.day);
      noteEl.textContent = '讀取中…';
      try {
        // B1 (PR-4c-4d): coach side reads fullNote via audience=coach (returns
        // damon_notes.note_text with all coach-internal sections — what coaches
        // are supposed to see). Student /api/note default path returns the
        // Vivi-warm notebook_page + sanitised — student must NEVER see fullNote.
        const n = await api(`/api/note?studentId=${encodeURIComponent(sid)}&module=self&day=${d.day}&audience=coach`);
        noteEl.textContent = n.exists ? n.noteText : `（Day ${d.day} 還沒有筆記。）`;
      } catch (e) {
        noteEl.textContent = '沒能取回筆記：' + e.message;
      }
      // Pin transcript to this day, surface the collapsible. Body stays
      // collapsed until coach clicks the transcript toggle.
      transcriptCurrentDay = d.day;
      transcriptWrap.style.display = 'block';
      setTranscriptCollapsed(true);
      transcriptBody.innerHTML = '';   // clear stale render from prior day
    });
    picker.appendChild(btn);
  }

  // graduation
  try {
    // 5/25 fix — explicit audience=coach (see /api/journey call above).
    const g = await api(`/api/graduation?studentId=${encodeURIComponent(sid)}&module=self&audience=coach`);
    if (!g.exists) {
      gradEl.textContent = '（結業內容還沒生成。）';
    } else {
      const poem = (g.poem21 || []).filter(s => s && s.length > 0).join(' · ');
      gradEl.textContent = `【教練見證】\n${g.coachLetter || '—'}\n\n【宣言】\n${g.declaration || '—'}\n\n【21 句詩】\n${poem}\n\n寄信狀態：${g.exportedToEmail ? '已寄' : '未寄'}`;
    }
  } catch (e) { gradEl.textContent = '沒能取回結業：' + e.message; }
}

// ─── router ────────────────────────────────────────────────────────
function route() {
  const h = location.hash || '#/';
  if (h.startsWith('#/student/')) {
    const sid = decodeURIComponent(h.slice('#/student/'.length));
    if (sid) { renderStudent(sid); return; }
  }
  renderList();
}

document.getElementById('nav-dashboard').addEventListener('click', (e) => { e.preventDefault(); location.hash = '#/'; });
document.getElementById('coach-back').addEventListener('click', (e) => { e.preventDefault(); location.hash = '#/'; });
window.addEventListener('hashchange', route);
window.addEventListener('DOMContentLoaded', route);
