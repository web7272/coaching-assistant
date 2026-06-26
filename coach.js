/* coach.js — v5.0 coach admin SPA
   Hash routes: #/   (list)   |   #/student/<id>   (per-student detail)
   Auth: assumes Google OAuth via /api/auth/[...nextauth] is already established
   (admin endpoints will 401 if not — fetch errors surface inline).
*/
'use strict';

async function api(path, opts) {
  // 5/27 Patrick — 擴 opts (method/body) 給編輯資料 PATCH /api/students 用.
  // 既有所有 GET 呼叫不傳 opts、行為跟原本一致.
  const init = Object.assign({ headers: { 'Content-Type': 'application/json' } }, opts || {});
  if (init.body && typeof init.body !== 'string') init.body = JSON.stringify(init.body);
  const res = await fetch(path, init);
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

// ⭐ 6/7 Vivi — Day 1 完成日 display helper.
//   Input: ISO 8601 string (TIMESTAMPTZ from /api/students GET) or null/undefined.
//   Output: 'YYYY-MM-DD' in Asia/Taipei, or '尚未完成' if not yet finalized.
//   Pure helper — easy to sync-gate test from the script body.
function formatDay1CompletedAt(iso) {
  if (iso === null || iso === undefined || iso === '') return '尚未完成';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '尚未完成';
  // sv-SE locale gives ISO-style YYYY-MM-DD; pin timezone to Asia/Taipei so the
  // displayed date matches the Day 1 cohort date Vivi sees in Neon (台北本身
  // 沒 DST, 但走 Intl 比較 portable).
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Taipei',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(d);
  const y = parts.find(p => p.type === 'year')?.value  || '';
  const m = parts.find(p => p.type === 'month')?.value || '';
  const da = parts.find(p => p.type === 'day')?.value  || '';
  return `${y}-${m}-${da}`;
}

// ─── v5.2 active_context category labels (Vivi 6/5) ─────────────
// 對應 migration 029 + spec §1.3 enum. Server-side label 在 admin shape; 此處 fallback
// 給 raw /api/students GET 場景 (詳情頁 GET 不經 shapeStudentRow).
const _COACH_CONTEXT_LABELS = {
  1: '事業',
  2: '親密關係',
  3: '家庭',
  4: '健康',
  5: '自我',
};
const _COACH_CONTEXT_OPTIONS = [
  { value: 1, label: '事業 / 工作 / 金錢' },
  { value: 2, label: '親密關係 (伴侶 / 戀愛)' },
  { value: 3, label: '家庭 (原生家庭 / 子女)' },
  { value: 4, label: '健康 / 身體' },
  { value: 5, label: '自我 / 內在狀態 / 心理' },
];
function _coachContextShortLabel(cat) {
  const n = Number(cat);
  return Number.isInteger(n) && _COACH_CONTEXT_LABELS[n] ? _COACH_CONTEXT_LABELS[n] : '事業';
}
const PHASE_NAMES = ['找到你真正要的', '你是誰', '擴大地圖', '串連起來', '放手帶著走'];

// ─── list view ─────────────────────────────────────────────────────
// 6/3 Patrick — filter (純 client-side):
//   payload 一次 fetch, 切換 filter 不 re-fetch — UX 即時 + 不打 DB.
//   filter 邏輯抽到 lib/util/coach-filter.js, lib/util/coach-filter.test.js 鎖.
//   coach.js 是 classic-script loader, 不能 import lib ESM, 內聯同份邏輯.
const _COACH_AT_RISK_DAYS = 14;
const _COACH_FINISHED_DAY = 21;
const _COACH_DAY_MS = 24 * 60 * 60 * 1000;
function _matchesCoachFilter(s, filter, now) {
  if (!s || typeof s !== 'object') return false;
  if (!filter || filter === 'all') return true;
  const beta    = s.is_beta    === true;
  const blocked = s.is_blocked === true;
  const day     = Number.isFinite(s.effective_day) ? s.effective_day
                : Number.isFinite(s.current_day)   ? s.current_day
                : 0;
  const daysDone = Number.isFinite(s.days_completed) ? s.days_completed : 0;
  switch (filter) {
    case 'beta':     return beta;
    case 'blocked':  return blocked;
    // 6/3 Vivi — active 重定義成「進行中 = !blocked && 至少完成 Day 1 && 沒 finish」.
    // 排除「點了 Day 1 但沒完成」(days_completed=0) 的人.
    case 'active':   return !blocked && daysDone >= 1 && day < _COACH_FINISHED_DAY;
    case 'in_day1':  return !blocked && daysDone === 0;   // 6/19 Vivi — 正在 Day 1 (註冊未完成 Day 1)
    case 'finished': return day >= _COACH_FINISHED_DAY;
    case 'at_risk': {
      if (blocked || day >= _COACH_FINISHED_DAY) return false;
      if (!s.last_active) return false;
      const lastMs = new Date(s.last_active).getTime();
      if (!Number.isFinite(lastMs)) return false;
      const nowMs = now instanceof Date ? now.getTime()
                  : Number.isFinite(now) ? now
                  : Date.now();
      return (nowMs - lastMs) >= _COACH_AT_RISK_DAYS * _COACH_DAY_MS;
    }
    default: return true;
  }
}

// 6/18 Vivi — cohort (與 op filter 正交). coach.js classic-script 內聯同份.
function _matchesCoachCohort(s, cohort) {
  if (!s || typeof s !== 'object') return false;
  if (!cohort || cohort === 'all') return true;
  const beta = s.is_beta === true;
  const plan = typeof s.plan === 'string' ? s.plan : '';
  switch (cohort) {
    case 'beta':       return beta;
    case 'day1_trial': return plan === 'trial';
    case 'first_paid': return (plan === 'plan_a' || plan === 'plan_b') && !beta;
    default:           return true;
  }
}

// Module-level cache: fetched students + last filter choice.
let _coachStudentsCache = null;
let _coachCohort = 'all';
let _coachOp     = 'all';

const COACH_COHORT_LABELS = { all: '全部', beta: '封測', day1_trial: 'Day1 trial', first_paid: '第一批付費' };
const COACH_OP_LABELS     = { all: '全部狀態', active: '進行中', in_day1: '正在 Day 1', finished: '已完成 Day 21', at_risk: '14+ 天沒動', blocked: '已停用' };

function _renderCoachList(students, cohort, op) {
  const list = document.getElementById('coach-students-list');
  const countEl = document.getElementById('coach-list-count');
  const titleEl = document.getElementById('coach-list-title');
  if (!list) return;
  list.innerHTML = '';
  const filtered = students.filter(s => _matchesCoachCohort(s, cohort) && _matchesCoachFilter(s, op));
  const _noFilter = (!cohort || cohort === 'all') && (!op || op === 'all');
  if (countEl) {
    countEl.textContent = _noFilter
      ? `${filtered.length} 位`
      : `${filtered.length} / ${students.length} 位`;
  }
  if (titleEl) {
    titleEl.textContent = `學員 · ${COACH_COHORT_LABELS[cohort] || '全部'}${op && op !== 'all' ? ' · ' + (COACH_OP_LABELS[op] || '') : ''}`;
  }
  if (filtered.length === 0) {
    list.innerHTML = `<p class="muted" style="padding:14px;">這個分類沒有學員。</p>`;
    return;
  }
  for (const s of filtered) {
    const row = document.createElement('div');
    row.className = 'coach-list__row';
    row.tabIndex = 0;
    // 6/3 Patrick — 顯示 is_beta / is_blocked pills (兩個都沒勾就什麼都不顯示).
    // ⭐ v5.2 第一塊 (Vivi 6/5): 加 active_context label pill (預設「事業」).
    const pills = [];
    if (s.is_beta === true) {
      pills.push(`<span class="coach-pill coach-pill--beta">封測</span>`);
    }
    if (s.is_blocked === true) {
      pills.push(`<span class="coach-pill coach-pill--blocked">已停用</span>`);
    }
    // active_context_label 來自 GET /api/students (admin shape). Fallback 「事業」
    // for missing (e.g. /api/students raw shape not yet 經 shapeStudentRow).
    const ctxLabel = s.active_context_label
      || _coachContextShortLabel(s.active_context_category);
    if (ctxLabel) {
      pills.push(`<span class="coach-pill coach-pill--context">${escapeText(ctxLabel)}</span>`);
    }
    const pillsHtml = pills.length
      ? `<div class="coach-list__tags">${pills.join('')}</div>`
      : `<div class="coach-list__tags"></div>`;
    // ⭐ 6/8 Vivi — plan 顯示 (Day 那欄旁). 原始 enum (trial / plan_a / plan_b)
    //   Vivi 一眼看出誰還卡 trial. null/undefined/空 → "—".
    //   escapeText 包,雖然 enum 是 server-side 驗過的安全 set, 防線一致.
    const planLabel = (typeof s.plan === 'string' && s.plan.length > 0) ? s.plan : '—';
    row.innerHTML = `
      <div class="coach-list__sid">${escapeText(s.student_id)}</div>
      <div class="coach-list__email">${escapeText(s.email || '—')}</div>
      ${pillsHtml}
      <div class="coach-list__day">Day ${escapeText(s.effective_day ?? s.current_day ?? '—')}</div>
      <div class="coach-list__plan">${escapeText(planLabel)}</div>
      <div class="coach-list__open">看 →</div>`;
    const open = () => { location.hash = `#/student/${encodeURIComponent(s.student_id)}`; };
    row.addEventListener('click', open);
    row.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); open(); } });
    list.appendChild(row);
  }
}

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
  _coachStudentsCache = students;
  if (students.length === 0) {
    list.innerHTML = `<p class="muted" style="padding:14px;">目前沒有學員。</p>`;
    return;
  }
  // 6/18 Vivi — cohort tabs + op dropdown (2D). 不 re-fetch, 用 cache.
  const tabWrap = document.getElementById('coach-cohort-tabs');
  if (tabWrap) {
    tabWrap.querySelectorAll('.coach-tab').forEach((btn) => {
      btn.classList.toggle('coach-tab--active', (btn.getAttribute('data-cohort') || 'all') === _coachCohort);
      btn.onclick = () => {
        _coachCohort = btn.getAttribute('data-cohort') || 'all';
        tabWrap.querySelectorAll('.coach-tab').forEach((b) => b.classList.toggle('coach-tab--active', b === btn));
        if (_coachStudentsCache) _renderCoachList(_coachStudentsCache, _coachCohort, _coachOp);
      };
    });
  }
  const opSel = document.getElementById('coach-op-filter');
  if (opSel) {
    opSel.value = _coachOp;
    opSel.onchange = () => {
      _coachOp = opSel.value || 'all';
      if (_coachStudentsCache) _renderCoachList(_coachStudentsCache, _coachCohort, _coachOp);
    };
  }
  _renderCoachList(students, _coachCohort, _coachOp);
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

  // 5/27 Patrick — 編輯資料 (稱呼 / 步調 / is_beta). Vivi 不用再下 SQL.
  // GET /api/students?studentId=... 拿目前值、PATCH /api/students 寫變更.
  // 兩端都 coach-gated (見 api/students.js); PATCH 用 COALESCE partial update.
  // 失敗不擋整個詳情頁 render — 用 try/catch + 就地 inline 訊息.
  try {
    const sr = await api(`/api/students?studentId=${encodeURIComponent(sid)}`);
    const stu = sr?.student || {};
    const original = {
      preferred_name: stu.preferred_name || '',
      pace:           stu.pace || 'daily',
      is_beta:        !!stu.is_beta,
      // ⭐ 6/7 Vivi — is_blocked checkbox 接 PATCH 教練路徑.
      is_blocked:     !!stu.is_blocked,
      // ⭐ 6/8 Vivi — plan 下拉. Fallback 'trial' 對齊 students 表 default.
      //   後端 PATCH 已驗 VALID_PLANS = {trial, plan_a, plan_b}; 下拉本身只給 3 個值,
      //   雙層防呆.
      plan:           stu.plan || 'trial',
      // ⭐ v5.2 第一塊 — active_context category (default 1=事業 per migration 029).
      // 6/7 Vivi: 場景名/說明手動編輯欄拿掉 — onboarding 仍會寫入, 教練不再手調.
      active_context_category:   Number.isInteger(Number(stu.active_context_category))
        ? Number(stu.active_context_category) : 1,
    };
    const $name    = document.getElementById('coach-edit-name');
    const $pace    = document.getElementById('coach-edit-pace');
    const $plan    = document.getElementById('coach-edit-plan');
    const $beta    = document.getElementById('coach-edit-isbeta');
    const $blocked = document.getElementById('coach-edit-isblocked');
    const $save    = document.getElementById('coach-edit-save');
    const $reset   = document.getElementById('coach-edit-reset');
    const $msg     = document.getElementById('coach-edit-msg');
    // v5.2 active_context category (場景名/說明 inputs 已移除 6/7).
    const $ctxCat  = document.getElementById('coach-edit-ctx-category');
    // 6/7 Vivi — Day 1 完成日 唯讀顯示.
    const $day1    = document.getElementById('coach-day1-completed-at');
    // Lazy-populate select options once per render (idempotent).
    if ($ctxCat && $ctxCat.options.length === 0) {
      for (const opt of _COACH_CONTEXT_OPTIONS) {
        const o = document.createElement('option');
        o.value = String(opt.value);
        o.textContent = opt.label;
        $ctxCat.appendChild(o);
      }
    }

    function fillForm(src) {
      $name.value      = src.preferred_name;
      $pace.value      = src.pace;
      if ($plan)    $plan.value      = src.plan;
      $beta.checked    = src.is_beta;
      if ($blocked) $blocked.checked = src.is_blocked;
      if ($ctxCat)  $ctxCat.value    = String(src.active_context_category);
    }
    fillForm(original);

    // 6/7 Vivi — Day 1 完成日 render (Asia/Taipei YYYY-MM-DD; null → "尚未完成").
    // Pure helper, exported on window for sync-gate test reuse.
    if ($day1) {
      $day1.textContent = formatDay1CompletedAt(stu.day1_completed_at);
    }
    // 初始標題：「學員 · 稱呼（A001）」如果已有 preferred_name.
    const titleEl = document.getElementById('coach-student-title');
    if (titleEl && original.preferred_name) {
      titleEl.textContent = `學員 · ${original.preferred_name}（${sid}）`;
    }

    // onclick 覆寫 (renderStudent 多次進來不疊加 listener).
    $reset.onclick = () => { fillForm(original); $msg.textContent = ''; };
    $save.onclick  = async () => {
      $msg.textContent = '儲存中…'; $save.disabled = true;
      const body = { studentId: sid };
      const newName = $name.value.trim();
      const newBlocked = $blocked ? !!$blocked.checked : original.is_blocked;
      // ⭐ 6/8 Vivi — plan diff. 下拉 value 限定 3 個 enum (trial/plan_a/plan_b),
      //   後端 PATCH 教練路徑驗 VALID_PLANS 兜底.
      const newPlan = $plan ? $plan.value : original.plan;
      if (newName        !== original.preferred_name) body.preferred_name = newName;
      if ($pace.value    !== original.pace)           body.pace           = $pace.value;
      if (newPlan        !== original.plan)           body.plan           = newPlan;
      if ($beta.checked  !== original.is_beta)        body.is_beta        = $beta.checked;
      // ⭐ 6/7 Vivi — is_blocked diff (教練後台 only; api/students.js 學員自助路徑擋).
      if (newBlocked     !== original.is_blocked)     body.is_blocked     = newBlocked;
      // ⭐ v5.2 active_context category diff. 場景名/說明 inputs 已移除 6/7.
      const newCtxCat  = $ctxCat  ? parseInt($ctxCat.value, 10) : original.active_context_category;
      if (Number.isInteger(newCtxCat) && newCtxCat !== original.active_context_category) {
        body.active_context_category = newCtxCat;
      }
      if (Object.keys(body).length === 1) {     // 只有 studentId → 沒改
        $msg.textContent = '沒有變動。';
        $save.disabled = false;
        return;
      }
      try {
        await api('/api/students', { method: 'PATCH', body });
        $msg.textContent = '已儲存 ✓';
        Object.assign(original, {
          preferred_name: newName,
          pace:           $pace.value,
          plan:           newPlan,
          is_beta:        $beta.checked,
          is_blocked:     newBlocked,
          active_context_category:   newCtxCat,
        });
        if (titleEl) {
          titleEl.textContent = newName ? `學員 · ${newName}（${sid}）` : `學員 · ${sid}`;
        }
        // 6/7 Vivi — refresh list cache so the "封鎖" pill in the list view
        // reflects the change next time the coach navigates back.
        // 6/8 Vivi — same patch for plan column.
        if (_coachStudentsCache) {
          const idx = _coachStudentsCache.findIndex(s => s.student_id === sid);
          if (idx >= 0) {
            _coachStudentsCache[idx] = Object.assign({}, _coachStudentsCache[idx], {
              preferred_name: newName,
              pace:           $pace.value,
              plan:           newPlan,
              is_beta:        $beta.checked,
              is_blocked:     newBlocked,
              active_context_category: newCtxCat,
            });
          }
        }
      } catch (e) {
        $msg.textContent = '儲存失敗：' + (e?.message || e);
      } finally {
        $save.disabled = false;
      }
    };
  } catch (e) {
    console.warn('[coach edit-form] init failed:', e?.message || e);
    const $msg = document.getElementById('coach-edit-msg');
    if ($msg) $msg.textContent = '沒能取回學員資料、編輯區暫不可用。';
  }

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

  // 前端學員筆記（學員實際收到的卡）— 5/26 Vivi 獨立 section, 比照 transcript
  // picker 的做法 (自己 picker / lazy-fetch / per-day 快取 / toggle-off / 複製鈕).
  // studentCard 由 /api/note?audience=coach 一起回 (dd43a8d).
  // textContent 注入 (+ .coach-pre pre-wrap) — 不用 innerHTML、避開模板空白 bug.
  const cardPicker  = document.getElementById('coach-card-picker');
  const cardBody    = document.getElementById('coach-card-body');
  const cardCopyBtn = document.getElementById('coach-card-copy');
  const cardCache   = new Map();   // dayN → studentCard string
  const CARD_PLACEHOLDER = '點上方某一天看學員那天收到的卡。';
  let cardCurrentDay = null;

  async function loadCard(day) {
    if (cardCache.has(day)) {
      const cached = cardCache.get(day);
      cardBody.textContent = cached.text;
      if (cardCopyBtn) cardCopyBtn.style.display = cached.hasCard ? 'inline-block' : 'none';
      return;
    }
    cardBody.textContent = '讀取中…';
    if (cardCopyBtn) cardCopyBtn.style.display = 'none';
    try {
      const n = await api(`/api/note?studentId=${encodeURIComponent(sid)}&module=self&day=${day}&audience=coach`);
      const hasCard = !!n.studentCard;
      const text = hasCard ? n.studentCard : `（Day ${day} 還沒有身分解析卡。）`;
      cardCache.set(day, { text, hasCard });
      cardBody.textContent = text;
      if (cardCopyBtn) cardCopyBtn.style.display = hasCard ? 'inline-block' : 'none';
    } catch (e) {
      cardBody.textContent = '沒能取回身分解析卡：' + (e?.message || '');
      if (cardCopyBtn) cardCopyBtn.style.display = 'none';
    }
  }

  function setActiveCardBtn(day) {
    for (const b of cardPicker.querySelectorAll('button')) {
      b.classList.toggle('paper-btn--active', Number(b.dataset.day) === day);
    }
  }

  // 複製鈕（onclick 覆寫避免 renderStudent 重跑時疊加 listener）.
  if (cardCopyBtn) {
    cardCopyBtn.style.display = 'none';
    cardCopyBtn.onclick = () => {
      const text = cardBody.innerText || '';
      if (!text.trim()) return;
      navigator.clipboard.writeText(text).then(() => {
        cardCopyBtn.textContent = '已複製 ✓';
        setTimeout(() => { cardCopyBtn.textContent = '📋 複製'; }, 1500);
      }).catch(() => {
        cardCopyBtn.textContent = '複製失敗、手動選取';
        setTimeout(() => { cardCopyBtn.textContent = '📋 複製'; }, 1800);
      });
    };
  }

  cardPicker.innerHTML = '';
  cardBody.textContent = CARD_PLACEHOLDER;
  for (const d of days) {
    if (d.state === 'future' || d.state === 'active-empty') continue;
    const cbtn = document.createElement('button');
    cbtn.className = 'paper-btn';
    cbtn.style.cssText = 'padding:6px 12px;font-size:12px;letter-spacing:1px;';
    cbtn.dataset.day = String(d.day);
    cbtn.textContent = `D${d.day}`;
    cbtn.addEventListener('click', async () => {
      if (cardCurrentDay === d.day) {             // 再點同一天 = 收起
        cardCurrentDay = null;
        setActiveCardBtn(null);
        cardBody.textContent = CARD_PLACEHOLDER;
        if (cardCopyBtn) cardCopyBtn.style.display = 'none';
        return;
      }
      cardCurrentDay = d.day;
      setActiveCardBtn(d.day);
      await loadCard(d.day);
    });
    cardPicker.appendChild(cbtn);
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

  // 完整對話 picker — Vivi 6/19: 也列「進行中當天」(active-empty), 對話不需完成即可看
  // (教練要看路人卡在 Day 1 哪裡; sessions.day 在建 session 時就寫好 → 訊息即時可撈).
  // 只跳 future (那天根本沒對話). 筆記/卡 picker 維持不列 active-empty.
  transcriptPicker.innerHTML = '';
  transcriptBody.textContent = TRANSCRIPT_PLACEHOLDER;
  for (const d of days) {
    if (d.state === 'future') continue;
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
        // 5/26 Vivi: studentCard 拆到獨立 section「前端學員筆記」(coach-card-*).
        // 這裡只顯示完整筆記、緊湊單塊樣式 (.coach-pre 即可).
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
    // 5/25 fix — explicit audience=coach (see /api/journey call above).
    const g = await api(`/api/graduation?studentId=${encodeURIComponent(sid)}&module=self&audience=coach`);
    if (!g.exists) {
      gradEl.textContent = '（結業內容還沒生成。）';
    } else {
      const poem = (g.poem21 || []).filter(s => s && s.length > 0).join(' · ');
      gradEl.textContent = `【教練見證】\n${g.coachLetter || '—'}\n\n【宣言】\n${g.declaration || '—'}\n\n【21 句詩】\n${poem}\n\n寄信狀態：${g.exportedToEmail ? '已寄' : '未寄'}`;
    }
  } catch (e) { gradEl.textContent = '沒能取回結業：' + e.message; }

  // 6/12 Vivi — 21 天旅程 (頁Y storyboard).
  //   Coach 唯讀: 故事 collapsible=false (全展開, 不要 toggle button) +
  //   expandAllSteps=true (7 步塊全展開, 不必複製 student.js 互動 handler).
  //   走 audience=coach&studentId — 端走 guardCoachOr401, 完全不依賴 student
  //   cookie (Patrick 紅線). Render 複用 lib/student/storyboard-render.js 同
  //   一份 module (透過 coach.html <script type="module"> 掛到 window),
  //   故事單一來源, 0 第 3 份 inline 複製.
  const sbHost = document.getElementById('coach-storyboard');
  if (sbHost) {
    sbHost.innerHTML = '<p class="muted">載入中…</p>';
    try {
      const sb = await api(`/api/sc-storyboard?audience=coach&studentId=${encodeURIComponent(sid)}&module=self`);
      if (window.StoryboardRender && typeof window.StoryboardRender.renderStoryboardBodyHTML === 'function') {
        sbHost.innerHTML = window.StoryboardRender.renderStoryboardBodyHTML(sb, {
          collapsible: false,
          expandAllSteps: true,
        });
      } else {
        sbHost.innerHTML = '<p class="muted">旅程模組未載入。請重新整理頁面。</p>';
      }
    } catch (e) {
      sbHost.innerHTML = `<p class="muted">沒能取回旅程：${escapeText(e.message)}</p>`;
    }
  }
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
