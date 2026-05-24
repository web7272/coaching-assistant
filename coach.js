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
  try { j = await api(`/api/journey?studentId=${encodeURIComponent(sid)}&module=self`); }
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

  // day picker — every day with revealed/active-filled state gets a button
  for (const d of days) {
    if (d.state === 'future' || d.state === 'active-empty') continue;
    const btn = document.createElement('button');
    btn.className = 'paper-btn';
    btn.style.cssText = 'padding:6px 12px;font-size:12px;letter-spacing:1px;';
    btn.textContent = `D${d.day}${d.phrase ? ' · ' + d.phrase : ''}`;
    btn.addEventListener('click', async () => {
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
    });
    picker.appendChild(btn);
  }

  // graduation
  try {
    const g = await api(`/api/graduation?studentId=${encodeURIComponent(sid)}&module=self`);
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
