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
function roman(n) { return ['I', 'II', 'III'][n - 1] || ''; }

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
  const grid    = document.getElementById('coach-journey-grid');
  const gradCell = document.getElementById('coach-grad-cell');
  const weekBox = document.getElementById('coach-week-reports');
  const picker  = document.getElementById('coach-day-picker');
  const noteEl  = document.getElementById('coach-day-note');
  const gradEl  = document.getElementById('coach-graduation');
  grid.innerHTML = ''; gradCell.innerHTML = ''; weekBox.innerHTML = '';
  picker.innerHTML = ''; noteEl.textContent = '點上方某一天看當日筆記。'; gradEl.textContent = '';

  let j;
  try { j = await api(`/api/journey?studentId=${encodeURIComponent(sid)}&module=self`); }
  catch (e) {
    grid.innerHTML = `<p class="muted">${escapeText('沒能取回旅程：' + e.message)}</p>`;
    return;
  }
  document.getElementById('coach-student-meta').textContent = `current_day = ${j.currentDay} · module = ${j.module}`;

  // mini grid (3×8): daily 1-7 + weekly I, then 8-14 + II, then 15-21 + III
  const days  = (j.days  || []);
  const weeks = (j.weeks || []);
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 7; col++) {
      const c = days[row * 7 + col] || { day: row * 7 + col + 1, state: 'future', phrase: null };
      const div = document.createElement('div');
      div.className = `coach-mini-cell${c.state === 'active-empty' || c.state === 'active-filled' ? ' coach-mini-cell--active' : c.state === 'revealed' ? ' coach-mini-cell--revealed' : ''}`;
      div.title = `Day ${c.day} · ${c.state}${c.phrase ? ' · ' + c.phrase : ''}`;
      div.textContent = c.phrase || `D${c.day}`;
      grid.appendChild(div);
    }
    const w = weeks[row] || { week: row + 1, state: 'future' };
    const wd = document.createElement('div');
    wd.className = `coach-mini-cell${w.state === 'active' ? ' coach-mini-cell--active' : w.state === 'revealed' ? ' coach-mini-cell--revealed' : ''}`;
    wd.title = `Week ${w.week} · ${w.state}`;
    wd.textContent = roman(w.week);
    grid.appendChild(wd);
  }
  if (j.graduation) {
    const gc = document.createElement('div');
    gc.className = `coach-mini-cell coach-mini-cell--graduation${j.graduation.state !== 'future' ? ' coach-mini-cell--active' : ''}`;
    gc.textContent = `結業 (${j.graduation.state})`;
    gradCell.appendChild(gc);
  }

  // week reports — fetch each revealed/active week summary defensively
  for (const w of weeks) {
    if (w.state === 'future') continue;
    try {
      const r = await api(`/api/week-report?studentId=${encodeURIComponent(sid)}&module=self&week=${w.week}`);
      const card = document.createElement('div');
      card.className = 'coach-pre';
      const title = r.exists ? (r.title || '—') : '（還沒生成）';
      card.innerHTML = `<strong>Week ${w.week}：${escapeText(title)}</strong>\n\n${escapeText(r.body || '')}`;
      weekBox.appendChild(card);
    } catch (e) { /* fail-soft per row */ }
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
