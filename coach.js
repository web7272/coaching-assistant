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
      <div class="coach-list__day">Day ${escapeText(s.effective_day ?? s.current_day ?? '—')}</div>
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

  // 完整對話（教練專用）— 自己一排天數按鈕、跟筆記區脫鉤 (Vivi 5/25 C3 修正).
  // lazy-fetch /api/admin/transcript（HMAC coach_session cookie gated）、per-day 快取.
  const transcriptPicker  = document.getElementById('coach-transcript-picker');
  const transcriptBody    = document.getElementById('coach-transcript-body');
  const transcriptCopyBtn = document.getElementById('coach-transcript-copy');
  const transcriptCache   = new Map();   // dayN → rendered HTML
  const TRANSCRIPT_PLACEHOLDER = '點上方某一天看完整逐字對話。';
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
        <div class="coach-transcript-msg__body">${escapeText((m.content || '').replace(/\n{3,}/g, '\n\n').trim())}</div>
      </div>`;
    }).join('');
  }

  async function loadTranscript(day) {
    if (transcriptCache.has(day)) { transcriptBody.innerHTML = transcriptCache.get(day); return; }
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

  function setActiveTranscriptBtn(day) {
    for (const b of transcriptPicker.querySelectorAll('button')) {
      b.classList.toggle('paper-btn--active', Number(b.dataset.day) === day);
    }
  }

  // 「📋 複製對話」按鈕 (Vivi 5/25 like 最早 index 那顆) — 初始隱藏、選某天才出現.
  // 用 onclick 覆寫避免 renderStudent 重跑時疊加 listener.
  if (transcriptCopyBtn) {
    transcriptCopyBtn.style.display = 'none';
    transcriptCopyBtn.onclick = () => {
      const text = transcriptBody.innerText || '';
      if (!text.trim()) return;
      navigator.clipboard.writeText(text).then(() => {
        transcriptCopyBtn.textContent = '已複製 ✓';
        setTimeout(() => { transcriptCopyBtn.textContent = '📋 複製對話'; }, 1500);
      }).catch(() => {
        transcriptCopyBtn.textContent = '複製失敗、手動選取';
        setTimeout(() => { transcriptCopyBtn.textContent = '📋 複製對話'; }, 1800);
      });
    };
  }

  // 建自己的天數按鈕（跟筆記 picker 同樣只列 revealed / active-filled 的天）.
  transcriptPicker.innerHTML = '';
  transcriptBody.textContent = TRANSCRIPT_PLACEHOLDER;
  for (const d of days) {
    if (d.state === 'future' || d.state === 'active-empty') continue;
    const tbtn = document.createElement('button');
    tbtn.className = 'paper-btn';
    tbtn.style.cssText = 'padding:6px 12px;font-size:12px;letter-spacing:1px;';
    tbtn.dataset.day = String(d.day);
    tbtn.textContent = `D${d.day}`;
    tbtn.addEventListener('click', async () => {
      if (transcriptCurrentDay === d.day) {          // 再點同一天 = 收起
        transcriptCurrentDay = null;
        setActiveTranscriptBtn(null);
        transcriptBody.textContent = TRANSCRIPT_PLACEHOLDER;
        if (transcriptCopyBtn) transcriptCopyBtn.style.display = 'none';
        return;
      }
      transcriptCurrentDay = d.day;
      setActiveTranscriptBtn(d.day);
      await loadTranscript(d.day);
      if (transcriptCopyBtn) transcriptCopyBtn.style.display = 'inline-block';
    });
    transcriptPicker.appendChild(tbtn);
  }

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
      // Vivi 5/25 C3 修正：筆記區只管筆記、不再 touch 完整對話區
      // (transcript picker 自己有按鈕、自己管自己的 currentDay).
      if (currentNoteDay === d.day) {
        currentNoteDay = null;
        noteEl.textContent = NOTE_PLACEHOLDER;
        setActiveDayBtn(null);
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
        // 5/26 Patrick: 多回 studentCard (= sessions.notebook_page、學員前端那張)
        // 教練同時看「學員收到的卡」+「完整筆記」 兩塊.
        const n = await api(`/api/note?studentId=${encodeURIComponent(sid)}&module=self&day=${d.day}&audience=coach`);
        const card = n.studentCard ? escapeText(n.studentCard) : `（Day ${d.day} 還沒有教練卡。）`;
        const full = (n.exists && n.noteText) ? escapeText(n.noteText) : `（Day ${d.day} 還沒有筆記。）`;
        noteEl.innerHTML =
          `<div class="coach-note-block"><div class="coach-note-block__label">學員收到的教練卡（前端原樣）</div><div class="coach-note-block__body">${card}</div></div>`
          + `<div class="coach-note-block"><div class="coach-note-block__label">完整筆記（教練專用）</div><div class="coach-note-block__body">${full}</div></div>`;
      } catch (e) {
        noteEl.textContent = '沒能取回筆記：' + e.message;
      }
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
