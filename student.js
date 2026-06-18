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
    // 5/29 Patrick (Vivi access gate) — 任何 403 beta_access_ended 全域導去
    // /#/blocked. 各 caller 仍可看 err.status === 403 自己再處理, 但 hash 已先
    // 被推到 blocked, 不會回到原本的 loading 卡死.
    if (res.status === 403 && typeof body === 'string' && body.includes('beta_access_ended')) {
      try { if (location.hash !== '#/blocked') location.hash = '#/blocked'; } catch { /* SSR safety */ }
    }
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
      // 6/02 Patrick — Landing skip-email funnel: email 從 /api/me 帶下來,
      // 精簡 entry 顯「歡迎,{email}」. localStorage 可能已有, 以 /api/me 為準.
      state.email         = me.email         ?? state.email         ?? null;
      state.module        = me.module        || 'self';
      state.currentDay    = me.currentDay    || 1;
      state.preferredName = me.preferredName ?? state.preferredName ?? null;
      state.pace          = me.pace          || state.pace || 'daily';
      // ⭐ 6/7 Vivi 商業模型 — server-authoritative SALES_OPEN flag for #/upgrade.
      //   Default conservative: missing/undefined → false (sales-closed page).
      //   Server flips to true → existing payment page revives (no code change).
      state.salesOpen     = me.salesOpen === true;
      saveState();
      return true;
    } catch (e) {
      // 5/29 Patrick — 403 + beta_access_ended → 回 'blocked' sentinel,
      // route() 接到後跳 /#/blocked (不誤導去 /entry 重新 magic-link).
      if (e && e.status === 403 && typeof e.body === 'string'
          && e.body.includes('beta_access_ended')) {
        return 'blocked';
      }
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
// 6/12 P0 fix — 'storyboard' 補回 (件3 PR-J4 漏更新 → showView('storyboard')
// 因 VIEWS 不含 'storyboard',view-storyboard 永遠沒被加 active,#/storyboard
// 整頁空白. 防再犯 test: lib/student/views-coverage.test.js 鎖 VIEWS ↔ index.html
// view-* id 必須一致).
const VIEWS = ['entry', 'journey', 'conversation', 'note', 'graduation', 'phase-report', 'upgrade', 'blocked', 'storyboard'];

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
  // 5/29 Patrick — /blocked 是純靜態 view, 沒有 studentId 也能 render (避免無限重導).
  if (!state.studentId && route !== 'entry' && route !== 'blocked') {
    const ok = await hydrateFromCookie();
    if (ok === 'blocked') {
      // /api/me 回 403 beta_access_ended → 直接跳 blocked, 不誤導去 entry.
      location.hash = '#/blocked';
      return;
    }
    if (!ok) {
      location.hash = '#/entry';
      return;
    }
  }

  // 6/2 Patrick — entry setup gate (修 377e58e 帶出的 regression):
  //   已認證 user 但 preferredName / pace 未填 → 強制 redirect /#/entry 精簡頁
  //   完成 setup. 06dec38 原邏輯靠 entry 自己判, 但 377e58e 二輪重寫後
  //   renderEntry 在「已認證 + preferredName 有」 case 直接 jump /journey,
  //   Landing → magic-link 的新 user 永遠沒被問稱謂/頻率.
  //   pure 邏輯抽到 lib/util/entry-gate.js, lib/util/entry-gate.test.js 鎖行為.
  if (state.studentId
      && (!state.preferredName || !state.pace)
      && route !== 'entry'
      && route !== 'blocked') {
    location.hash = '#/entry';
    return;
  }

  switch (route) {
    case 'entry':        showView('entry');        renderEntry(); break;
    case 'journey':      showView('journey');      await renderJourney(); break;
    case 'conversation': showView('conversation'); await renderConversation(); break;
    case 'note':         showView('note');         await renderNote(parseInt(params.day) || state.currentDay); break;
    case 'phase-report': showView('phase-report'); await renderPhaseReport(parseInt(params.phase) || 1); break;
    case 'graduation':   showView('graduation');   await renderGraduation(); break;
    case 'upgrade':      showView('upgrade');      renderUpgradeCTA(); break;
    case 'blocked':      showView('blocked');      /* purely static, view-blocked HTML carries copy */ break;
    // v5.3 件3 PR-J4 — 頁 Y「我的人生旅途」 (七步故事頁).
    case 'storyboard':   showView('storyboard');   await renderStoryboard(); break;
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
// 6/02 Vivi (二輪 拍板) — Landing 是唯一入口、entry 從來不該收 email.
//   ① 未認證 → window.location.href = LANDING_URL (hard redirect).
//   ② 已認證 + preferredName 已齊 → 跳 /#/journey.
//   ③ 已認證 + 缺 preferredName → 精簡 entry (顯「歡迎,{email}」 + name + pace +
//      「繼續」, PATCH /api/students 寫入).
//
// 砍掉 (從 06dec38 三狀態的舊「完整 entry」 分支):
//   · email input 在 entry 的所有 listener (typo hint / required / autocomplete).
//   · /api/auth/request-link 在 entry 的觸發路徑.
//   · 「登入連結已寄到」 確認頁 (entry 不再觸發 magic-link).
// suggestEmailFix() 純函式 + window.__suggestEmailFix 保留 (其他用途 / 測試).
// /api/auth/request-link endpoint 本身不動 (Landing 仍會呼叫).
// 6/2 Vivi: 暫用同源 landing.html、待 apex domain setup 後改回 https://seeyourself.now/.
// 起因: seeyourself.now apex 未設 SSL → 瀏覽器 ERR_SSL_VERSION_OR_CIPHER_MISMATCH
// (比 404 更糟、用戶看到安全警告 interstitial). 改同源 redirect、無 SSL/DNS
// 依賴, 立刻在 sandbox 可用. Landing 內容已在 repo 的 landing.html (Mike v0.15
// 之後升級到 v1.7/8, 同 commit).
// ⚠️ 6/7 Patrick (EP8 上架準備): 改回 apex。
//   *** 部署門檻 ***: 此 commit 只有在 seeyourself.now apex DNS + SSL 已生效後
//   才能 merge 到 production。否則未認證新用戶會被導到尚未架好的 apex →
//   ERR_SSL_VERSION_OR_CIPHER_MISMATCH、直接吃掉 CTA 轉換。
//   注意: 必須指到 /landing(行銷頁), 非根目錄 /(根=app, 會無限迴圈)。
//   DNS/SSL 未確認前若要先部署、把這行暫時改回 '/landing'。
const LANDING_URL = 'https://seeyourself.now/landing';
function renderEntry() {
  // ① 未認證 → hard redirect 到 Landing.
  if (!state.studentId) {
    try { window.location.href = LANDING_URL; } catch { /* SSR safety */ }
    return;
  }
  // ② 已認證 + setup 過 → 直接 journey.
  if (state.preferredName) {
    location.hash = '#/journey';
    return;
  }
  // ③ 已認證 + 缺 preferredName → 精簡 entry.
  renderEntrySetup();
}

function renderEntrySetup() {
  // HTML 已不含 email input + label (6/02 二輪 view-entry 重寫).
  // 共用 #entry-form 收 name + pace, submit → PATCH /api/students.
  const form    = document.getElementById('entry-form');
  const welcome = document.getElementById('entry-welcome');
  const nameEl  = document.getElementById('entry-name');
  const btn     = document.getElementById('entry-btn');
  const err     = document.getElementById('entry-error');
  err.classList.add('hidden');

  // pre-fill (returning visitor mid-setup).
  if (state.preferredName) nameEl.value = state.preferredName;
  const paceCheck = form.querySelector(`input[name="pace"][value="${state.pace || 'daily'}"]`);
  if (paceCheck) paceCheck.checked = true;

  // 「歡迎,{email}」 read-only 顯目前認證身份.
  if (welcome) {
    welcome.textContent = state.email
      ? `歡迎，${state.email}`
      : '歡迎';                            // defensive: email 沒帶到也不爆
  }
  btn.textContent = '繼續';

  // invalid 視覺 (跟舊 entry 同 .invalid class).
  const setInvalid = (el, msg) => {
    if (el && el.classList) el.classList.add('invalid');
    err.textContent = msg;
    err.classList.remove('hidden');
  };
  nameEl.addEventListener('input', () => {
    nameEl.classList.remove('invalid');
    err.classList.add('hidden');
  });

  form.onsubmit = async (e) => {
    e.preventDefault();
    err.classList.add('hidden');
    const preferredName = (nameEl.value || '').trim();
    if (!preferredName) {
      setInvalid(nameEl, '請告訴我們怎麼稱呼你。');
      return;
    }
    const paceChoice = (form.querySelector('input[name="pace"]:checked')?.value === 'self-paced')
      ? 'self-paced' : 'daily';

    const originalLabel = btn.textContent;
    btn.disabled = true;
    btn.textContent = '送出中…';
    try {
      await api('/api/students', {
        method: 'PATCH',
        body: {
          studentId: state.studentId,
          preferred_name: preferredName,
          pace: paceChoice,
        },
      });
      state.preferredName = preferredName;
      state.pace          = paceChoice;
      saveState();
      location.hash = '#/journey';
    } catch (e2) {
      btn.disabled = false;
      btn.textContent = originalLabel;
      setInvalid(form, '沒能送出、再試一次。');
    }
  };
}

// renderEntryFull removed 6/02 二輪 — Landing 是唯一入口, entry 不再接受
// 未認證的 email 輸入. 既有 magic-link 觸發路徑改由 Landing 表單呼叫
// /api/auth/request-link (endpoint 本身不動). suggestEmailFix() 純函式
// 留在 file 上方, 仍 expose via window.__suggestEmailFix 給未來其他 entry 用.

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
  resetDepth();   // 5/29 Patrick — 新對話視圖, depth watermark 歸零 (跨日 / restore 都會經過).
  input.placeholder = '寫一句、什麼都好';   // §六: no example placeholders

  // P3 (PR-4c-4f) — show the chain-追問 explainer ONLY on Day 1 (same Day-1-only
  // pattern as journey 「點開今天」 bottom prompt). After Day 1 the chain pattern is
  // familiar; the hint would be noise.
  const chainHint = document.getElementById('conv-chain-hint');
  if (chainHint) {
    if ((state.currentDay || 1) <= 1) chainHint.classList.remove('hidden');
    else                              chainHint.classList.add('hidden');
  }

  // ⭐ Patrick 6/6 P0 hotfix (A015 root cause): server-authoritative restore.
  //
  // Pre-fix: the guard was `if (state.conversation.length === 0)` — server
  // restore only fired when localStorage was empty. Any stale message (even
  // a 1-line onboarding opening pointing to old session 47) bypassed the
  // fetch entirely; the student saw the stale cache forever, never reconciled
  // with the real in-progress session 51 sitting in DB. A015 (Jessie) repro:
  // session 47 cached → reload → see only the stale opening → "從頭重來" UX.
  //
  // Fix: always ask the server, then reconcile per decideRestoreActionInline
  // (mirror of lib/student/restore-decision.js, tested there).
  //   - server has session + (local empty OR stale sid OR localShorter)
  //     → use server (clear + repaint with authoritative messages).
  //   - server has session + local matches → no-op (avoid flicker).
  //   - server has nothing + local empty → kickoff.
  //   - server has nothing + local non-empty → no-op (closure-just-happened edge).
  //   - server fetch failed → fail-open: local empty → kickoff; non-empty → keep.
  // 鐵則 1d: studentId 從 cookie 取、忽略 client 傳的 (endpoint side).
  {
    let serverFetchOk = false;
    let serverResp = null;
    try {
      serverResp = await api(`/api/conversation-today?module=${encodeURIComponent(state.module || 'self')}`);
      serverFetchOk = true;
    } catch (e) {
      console.warn('[conversation-today] fetch failed (will fail-open):', e?.message || e);
    }

    const decision = decideRestoreActionInline({
      local: { conversation: state.conversation, lastSessionId: state._lastSessionId },
      serverFetchOk,
      server: serverResp,
    });

    // Observability — 鐵律 #2: no raw message content logged, only counts/ids.
    console.info('[restore-decision]', JSON.stringify({
      action: decision.action,
      reason: decision.reason,
      local_count:    state.conversation.length,
      local_sid:      state._lastSessionId != null ? state._lastSessionId : null,
      server_fetch_ok: serverFetchOk,
      server_sid:     serverResp && serverResp.sessionId != null ? serverResp.sessionId : null,
      server_count:   serverResp && Array.isArray(serverResp.messages) ? serverResp.messages.length : 0,
    }));

    if (decision.action === 'use-server') {
      clearRenderedMessages();
      state.conversation = [];
      for (const m of decision.messages) {
        if (m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string') {
          state.conversation.push({ role: m.role, content: m.content });
          appendMessage(m.role, m.content, /*scroll=*/false);
        }
      }
      state._lastSessionId = decision.sessionId;
      saveState();
    } else if (decision.action === 'kickoff') {
      await requestKickoffOpening();
    }
    // 'no-op' → keep what's already painted from the L621 pre-paint.
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
  // 5/29 Vivi — 紙感 check-in 計時開始 (renderConversation 跑完). 每次重進對話頁
  // 都重置, 跨 session 不持久 (重整 → 起始句、是期望行為).
  startTimeCheckIn();
}

// 5/29 Vivi (PRODUCT-TRUTH v2.3 §2.5 鬆綁) — 輸入框下方紙感 check-in.
// 依「會話開頁後 wall-clock 經過時間」遞增換句, 純前端 / 不打斷對話 / 不違反
// 無計分鐵律. pickLine 純函式邏輯跟 lib/util/time-check-in.js 同步、由
// lib/util/time-check-in.test.js 鎖 boundary 行為.
// ⚠️ 鐵則 1-6 見 lib/util/time-check-in.js header — 修改文案/閥值前先讀.
const CHECK_IN_LINES_DEFAULT = [
  { atMs: 0,                 text: '慢慢來，我等你' },
  { atMs: 10 * 60 * 1000,    text: '✦ 已經陪自己 10 分鐘了 — 想停下來、跟我直說就好' },
  { atMs: 20 * 60 * 1000,    text: '✦ 走了 20 分鐘 — 任何時候說「先到這裡」我都會收下' },
  { atMs: 40 * 60 * 1000,    text: '✦ 40 分鐘了、明天再回來消化也是一種完整 — 告訴我就好' },
];
function pickCheckInLine(elapsedMs, lines) {
  const arr = Array.isArray(lines) ? lines : null;
  if (!arr || arr.length === 0) return null;
  let current = arr[0];
  const e = Number.isFinite(elapsedMs) ? elapsedMs : 0;
  for (const l of arr) {
    if (!l || typeof l.atMs !== 'number') continue;
    if (e >= l.atMs) current = l;
  }
  return current;
}
// debug: ?ckdebug=1 (在 location.search 或 hash 後的 query 都接受) → 把分鐘壓成秒.
function isCheckInDebug() {
  try {
    if (new URLSearchParams(location.search).get('ckdebug') === '1') return true;
    const h = location.hash || '';
    const qIdx = h.indexOf('?');
    if (qIdx >= 0
        && new URLSearchParams(h.slice(qIdx + 1)).get('ckdebug') === '1') return true;
  } catch { /* SSR / weird env — silently no-debug */ }
  return false;
}
function startTimeCheckIn() {
  const hint = document.getElementById('conv-time-hint');
  if (!hint) return;
  // 先清掉前一輪 renderConversation 留下的 interval (路由重進、重新計時).
  if (state._timeCheckInTimer) {
    clearInterval(state._timeCheckInTimer);
    state._timeCheckInTimer = null;
  }
  const debug = isCheckInDebug();
  const unit  = debug ? 1000 : 60 * 1000;
  const lines = CHECK_IN_LINES_DEFAULT.map(l => ({
    atMs: (l.atMs / (60 * 1000)) * unit,
    text: l.text,
  }));
  const sessionStart = Date.now();
  // 起始句保留原文 (鐵則 5「紙感」、不立刻換字).
  hint.textContent = lines[0].text;
  function tick() {
    if (document.hidden) return;        // 切走 tab 不算 (回來看 wall-clock 對應的, 不補播).
    const elapsed = Date.now() - sessionStart;
    const line = pickCheckInLine(elapsed, lines);
    if (line && hint.textContent !== line.text) {
      hint.textContent = line.text;
    }
  }
  state._timeCheckInTimer = setInterval(tick, 15 * 1000);   // 每 15s 檢查就夠.
  tick();   // 立即跑一次 (debug 模式下 0-10s 內仍正確顯示起始句).
}

// 5/29 Patrick (PRODUCT-TRUTH v2.3 §2.5 折衷 a) — 採集深度視覺指示.
// state._depthWatermark 維持單調 — server 回的 snapshot 可能因為 quality
// regression 暫時下降, 但 UI 走過就點亮, 不倒退 (符合鐵則 2「不壓力」).
// renderConversation 進來時清歸零 (新的一天/restore 時呼叫 resetDepth).
function renderDepth(n) {
  const wrap = document.getElementById('conv-depth');
  if (!wrap) return;
  const snapshot = Math.max(0, Math.min(5, Number(n) || 0));
  // watermark: 走過不倒退. _depthWatermark 跨 day reset (renderConversation 進來呼).
  state._depthWatermark = Math.max(state._depthWatermark || 0, snapshot);
  const N = state._depthWatermark;
  if (N === 0) { wrap.hidden = true; return; }
  wrap.hidden = false;
  const dots = wrap.querySelectorAll('.conv-depth__dot');
  dots.forEach((d, i) => d.classList.toggle('lit', i < N));
}
function resetDepth() {
  state._depthWatermark = 0;
  const wrap = document.getElementById('conv-depth');
  if (!wrap) return;
  wrap.hidden = true;
  wrap.querySelectorAll('.conv-depth__dot').forEach(d => d.classList.remove('lit'));
}

// ⭐ Patrick 6/6 P0 hotfix (A015) — remove all rendered message bubbles while
//   keeping the hero figure + any non-message chrome. Used when server-side
//   conversation reconciliation says we need to repaint with the authoritative
//   message list (stale local sid / local shorter / etc.).
function clearRenderedMessages() {
  const scroll = document.getElementById('conv-scroll');
  if (!scroll) return;
  scroll.querySelectorAll('.msg-ai, .msg-user-wrap').forEach(el => el.remove());
}

// ⭐ SYNC GATE START — decideRestoreActionInline (mirror of lib/student/restore-decision.js)
//   Mirror of the pure decision function tested in restore-decision.test.js.
//   Browser script can't ES-import the module; CI sync-gate test ensures both
//   implementations agree byte-for-behavior. Any edit here MUST be mirrored
//   in lib/student/restore-decision.js (or the sync test fails).
function decideRestoreActionInline({ local, serverFetchOk, server } = {}) {
  const localConv = (local && Array.isArray(local.conversation)) ? local.conversation : [];
  const localCount = localConv.length;
  const localSid   = (local && local.lastSessionId != null) ? local.lastSessionId : null;

  if (!serverFetchOk) {
    if (localCount === 0) {
      return { action: 'kickoff', reason: 'server_fetch_failed_and_local_empty' };
    }
    return { action: 'no-op', reason: 'server_fetch_failed_keep_local' };
  }

  const hasInProgress = !!(server
    && server.hasInProgress === true
    && Array.isArray(server.messages)
    && server.messages.length > 0);
  if (!hasInProgress) {
    if (localCount === 0) {
      return { action: 'kickoff', reason: 'no_server_session_and_local_empty' };
    }
    return { action: 'no-op', reason: 'no_server_session_keep_local' };
  }

  const serverSid    = server.sessionId;
  const serverCount  = server.messages.length;
  const stale        = localSid != null && localSid !== serverSid;
  const localShorter = localCount < serverCount;

  if (localCount === 0 || stale || localShorter) {
    return {
      action: 'use-server',
      sessionId: serverSid,
      messages: server.messages,
      prevLocalCount: localCount,
      reason: localCount === 0 ? 'local_empty'
            : stale            ? 'stale_session_id'
            :                    'local_shorter',
    };
  }
  return { action: 'no-op', reason: 'local_in_sync' };
}
// ⭐ SYNC GATE END — decideRestoreActionInline

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

/**
 * 6/3 Patrick (Vivi burst protection) — Anthropic 429 overload friendly UI.
 *
 * When the backend returns 503 { error: 'overload' } (Anthropic 429 全退到底
 * after the retry helper's 3 attempts), show a calm inline hint with a
 * 30s-countdown retry button. Click → re-fire sendUserMessage in retry mode.
 *
 * Paper aesthetic — no red banner, no SaaS spinner.
 * @param {string} retryText  the user message text to re-send on click
 */
function showOverloadHint(retryText) {
  const scroll = document.getElementById('conv-scroll');
  if (!scroll) return;
  const wrap = document.createElement('div');
  wrap.className = 'conv-hint conv-hint--overload';
  wrap.setAttribute('aria-live', 'polite');

  const msg = document.createElement('div');
  msg.className = 'conv-hint--overload__msg';
  msg.innerHTML = '<span class="star">✦</span><span class="text">教練此刻太多人在對話、30 秒後再試。</span>';
  wrap.appendChild(msg);

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'paper-btn conv-hint__retry';
  btn.disabled = true;
  let secs = 30;
  btn.textContent = `重新送出 (${secs}s)`;
  const timer = setInterval(() => {
    secs--;
    if (secs <= 0) {
      clearInterval(timer);
      btn.disabled = false;
      btn.textContent = '重新送出 →';
    } else {
      btn.textContent = `重新送出 (${secs}s)`;
    }
  }, 1000);

  btn.addEventListener('click', () => {
    if (btn.disabled) return;
    clearInterval(timer);
    wrap.remove();
    // Re-fire in retry mode: skip the re-push + re-paint (bubble + state still
    // in place from the first attempt, see sendUserMessage retry guard).
    sendUserMessage(retryText, { isRetry: true });
  });
  wrap.appendChild(btn);

  scroll.appendChild(wrap);
  scroll.scrollTo({ top: scroll.scrollHeight, behavior: 'smooth' });
}

/** Is this error our backend's overload signal? */
function isOverloadError(e) {
  if (!e || e.status !== 503) return false;
  if (typeof e.body !== 'string') return false;
  if (!e.body.includes('overload')) return false;
  try {
    const parsed = JSON.parse(e.body);
    return parsed && parsed.error === 'overload';
  } catch {
    return false;
  }
}

async function sendUserMessage(text, opts = {}) {
  // 6/3 Patrick (Vivi burst protection) — retry path skips the re-push +
  // re-paint. On 503 overload we pop state.conversation but keep the DOM bubble;
  // retry re-pushes (here) so the fetch carries the user message, but doesn't
  // re-paint (bubble's still on screen from the first attempt).
  const isRetry = !!opts.isRetry;
  state.conversation.push({ role: 'user', content: text });
  if (!isRetry) appendMessage('user', text);
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
    // 5/29 Patrick (PRODUCT-TRUTH v2.3 §2.5) — 採集深度 dot 更新 (走過不倒退).
    if (r && r.depthSignal !== undefined) renderDepth(r.depthSignal);
    if (r.dayComplete) await startClosureTransition();
  } catch (e) {
    typing.remove();
    // 5/26 Patrick (漏斗 Stage 1/2) — trial 撞 Day ≥ 2 → 402 → 轉去 CTA.
    if (e && e.status === 402) { location.hash = '#/upgrade'; return; }
    // 6/3 Patrick (Vivi burst protection) — Anthropic 429 overload.
    //   Backend rolled back its INSERT + questions_today bump; we roll back our
    //   optimistic state push (bubble stays in DOM — Vivi spec 不 commit). Show
    //   the friendly hint + 30s retry button.
    if (isOverloadError(e)) {
      state.conversation.pop();
      showOverloadHint(text);
      return;
    }
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
      // 5/29 Patrick (PRODUCT-TRUTH v2.3 §2.5) — kickoff response 也帶 depthSignal.
      if (r && r.depthSignal !== undefined) renderDepth(r.depthSignal);
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
  // ⭐ 6/7 Vivi 商業模型: SALES_OPEN flag-controlled rendering.
  //   - state.salesOpen === true  → #upgrade-sales-open (NT$3,000 + Stripe).
  //   - else (default this wave) → #upgrade-sales-closed (謝謝 + 開賣通知).
  //   Payment-page DOM, Stripe wiring, /api/checkout all preserved & dormant.
  const openDiv   = document.getElementById('upgrade-sales-open');
  const closedDiv = document.getElementById('upgrade-sales-closed');
  const salesOpen = state.salesOpen === true;

  if (openDiv)   openDiv.classList.toggle('hidden',   !salesOpen);
  if (closedDiv) closedDiv.classList.toggle('hidden',  salesOpen);

  if (!salesOpen) {
    // Sales closed — thank-you page is static markup; no JS wiring needed.
    // No /api/checkout call. Defensive: blank any prior inline error from a
    // sales-open render carried over via re-route.
    const errEl = document.getElementById('upgrade-error');
    if (errEl) errEl.classList.add('hidden');
    return;
  }

  // Sales open — wire the existing NT$3,000 Stripe checkout button.
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

// ────────────────────────────────────────────────────────────────
// v5.3 件3 PR-J4 — 頁 Y「我的人生旅途」 (七步故事頁) render.
//
// 故事線 verbatim from Vivi 6/11 終審定稿; Patrick 會逐行比.
// brain_state / sovereign_action 來自 /api/sc-storyboard (J1+J2+J3 契約).
//
// ⚠️ 源 of truth = lib/student/storyboard-render.js (ESM, pure, unit-tested).
//   The story content + helper output are mirrored here verbatim (non-module
//   SPA shell can't import). Sync-gate test in
//   lib/student/storyboard-render.test.js asserts byte-identical mirror.
// ────────────────────────────────────────────────────────────────

const STORYBOARD_STEP_META_INLINE = [
  { no: '01', name_zh: '發現匱乏',   name_en: 'The Void' },
  { no: '02', name_zh: '承認渴望',   name_en: 'The Longing' },
  { no: '03', name_zh: '挖掘數據',   name_en: 'Mining the Database' },
  { no: '04', name_zh: '認領身份',   name_en: 'Claiming the Identity' },
  { no: '05', name_zh: '發現資源',   name_en: 'Resource Retrieval' },
  { no: '06', name_zh: '奪回主權', name_en: 'Reclaiming the Sovereignty' },
  { no: '07', name_zh: '新的身分',   name_en: 'Anchoring the Concept' },
];

// 過場引導句 (mirror of STORYBOARD_CONNECTORS; storyboard-render.js sync).
const STORYBOARD_CONNECTORS_INLINE = [
  '你慢慢看清，匱乏的另一面，其實是渴望。',
  '你動身往回挖記憶，但有個聲音說『你不配』。',
  '你開始找到證據，你能說出『我是誰』。',
  '戴上新眼鏡後，你開始看見以前看不見的東西。',
  '此時外在環境試圖告訴你，世界不是這樣運作。',
  '你堅守自己的主權，告訴世界，我決定『我是誰』。',
  null,
];

// 頂部數字圓圈進度條 (mirror of renderProgressBarHTML).
function renderStoryboardProgressBar(steps, currentStep) {
  const pips = (steps || []).map((s, i) => {
    const n = i + 1;
    const filled = s && s.state === 'filled';
    const cur = currentStep === n;
    const cls = 'storyboard-pip'
      + (filled ? ' storyboard-pip--filled' : '')
      + (cur ? ' storyboard-pip--current' : '');
    return '<a class="' + cls + '" href="#storyboard-step-' + escapeHTMLStoryboard(s.no) + '" '
      + 'aria-label="跳到步驟 ' + n + ' ' + escapeHTMLStoryboard(s.name_zh || '') + '">'
      + '<span class="storyboard-pip-num">' + n + '</span>'
      + '<span class="storyboard-pip-bar"></span></a>';
  }).join('');
  const filledCount = (steps || []).filter(s => s && s.state === 'filled').length;
  return '<div class="storyboard-progress" aria-label="七步進度">'
    + '<div class="storyboard-pips">' + pips + '</div>'
    + '<div class="storyboard-progress-label">已點亮 <b>' + filledCount + '</b>/7</div>'
    + '</div>';
}


// 🔴 VERBATIM — Vivi 6/14 終審逐字 (文章版). DO NOT EDIT.
const STORYBOARD_STORY_INLINE = [
  { kind: 'para', seg: [{ t: '你一直覺得，現在的自己，好像不是全部的自己。' }] },
  { kind: 'para', seg: [{ t: '有時候，是焦慮、煩躁、疲憊；有時候，是明明已經很努力，卻總事與願違達不到目標。有時候，是一直替別人著想，卻不知道什麼時候別人會轉過身替你想。你隱約知道，生命裡有一塊是空的，始終沒有被滿足。' }] },
  { kind: 'para', seg: [{ t: '你開始懷疑：' }, { q: '是不是我不夠好？' }, { q: '是不是我做得不夠多？' }, { q: '什麼時候會輪到我？' }] },
  { kind: 'para', seg: [{ t: '這些說不清的匱乏感與不滿足，推著你往內看。於是，你開始：' }, { step: 1, label: '1.發現匱乏' }, { t: '。你終於慢慢看清，自己真正缺的到底是什麼。也許是被理解、被愛、被重視；也許是自由、成就、認可；也許只是一直以來，都沒有好好照顧過自己。' }] },
  { kind: 'para', seg: [{ t: '但你慢慢明白，匱乏的另一面，其實就是渴望。之所以會覺得缺，不是因為你太貪心，而是因為你的心裡，本來就真的想要。看清這件事還不夠。真正難的，是看見，並且' }, { step: 2, label: '2.承認渴望' }, { t: '。' }] },
  { kind: 'para', seg: [{ t: '承認' }, { q: '我就是想要這個' }, { t: '之前，是先' }, { q: '看見' }, { t: '原來我是想要這個。對一個總是把自己放在最後、習慣壓抑需求的人來說，需要很大的勇氣。因為你可能早已習慣告訴自己：' }, { q: '沒關係。' }, { q: '我不需要。' }, { q: '先顧別人比較重要。' }] },
  { kind: 'para', seg: [{ t: '甚至，你連自己的渴望到底是什麼，都丟失了。這次，在這裡你決定把它找回來，因為你知道看見了、承認了，你才真正有了起點，才能繼續走下去。於是，你開始：' }, { step: 3, label: '3.挖掘數據' }, { t: '。' }] },
  { kind: 'para', seg: [{ t: '往自己的過去、情緒、反應與選擇裡挖掘。找出那些一直在默默替你做決定，卻從來沒有被說出口的模式與線索。你想找出證據你值得這個渴望。但就在這時，第一個阻力跳了出來——' }, { vil: '限制性信念' }, { t: '。' }] },
  { kind: 'para', seg: [{ t: '它在你耳邊低聲說：' }, { q: '你不配。' }, { q: '你做不到。' }, { q: '你以前沒有以後也不會有。' }, { t: '它想喝止你停下。它試圖把你拉回舒適圈。但這次你沒有逗留。你跨越了它，開始：' }, { step: 4, label: '4. 認領身份' }, { t: '。' }] },
  { kind: 'para', seg: [{ t: '你不再用別人的標準定義自己，而是親口說出：' }, { q: '我是誰。' }, { q: '我是．．．的人。' }, { t: '當你真正認領自己的身份，你才驚訝地發現，原來自己一直都擁有許多被你遺忘的力量。你只需要' }, { step: 5, label: '5. 發現資源' }, { t: '。' }] },
  { kind: 'para', seg: [{ t: '那些你以為自己沒有的能力、特質、天賦與韌性，其實一直都在。只是過去的你，不曾允許自己相信，也不敢真正認領。故事還沒有結束。當你開始慢慢站穩，第二個阻力登場了。它比限制性信念更狡猾。因為它不阻止你，它企圖給你洗腦。' }] },
  { kind: 'para', seg: [{ t: '它告訴你：' }, { q: '世界不是這樣運作的。' }, { t: '然後，它用不同的聲音，對不同的人說出同一件事 — ' }, { vil: '追求外在認可' }] },
  { kind: 'tempt', label: '對渴望被肯定的人，它說：', quote: '別人說你好，你才算好。' },
  { kind: 'tempt', label: '對渴望被愛的人，它說：', quote: '有人愛你，你才有價值。' },
  { kind: 'tempt', label: '對渴望成功的人，它說：', quote: '做出成績，你才值得被看見。' },
  { kind: 'tempt', label: '對渴望財富的人，它說：', quote: '帳戶裡的數字，就是你這個人的分數。' },
  { kind: 'para', seg: [{ t: '你慢慢聽懂了。它所有的話，其實都在做同一件事——偷偷把' }, { q: '我夠不夠好' }, { t: '的主權，從你手中拿走，交給別人、交給結果、交給外面的世界。但這一次，你看穿了。你一把拍開它' }, { step: 6, label: '奪回主權' }, { t: '。' }] },
  { kind: 'para', seg: [{ t: '我是誰。我夠不夠好。我值不值得。不再由任何人、任何成績、任何眼光來決定。' }] },
  { kind: 'para', seg: [{ t: '而是由我自己定義。我的價值不跟任何人、事、物、環境、事件掛勾。於是，你走到了最後一步。' }] },
  { kind: 'para', seg: [{ step: 7, label: '7. 新的身分' }, { t: '。你親手為自己貼上新的身分。把它深深融入心裡，成為自己穩定的座標。最初那份自我懷疑的迷惘與不安，慢慢退去。因為你終於明白：你是誰，從來不是世界告訴你的。而是你願意相信，並決定成為那個自己。' }] },
  { kind: 'final', text: '你決定活出全部的你。' },
];

function escapeHTMLStoryboard(s) {
  if (typeof s !== 'string') return '';
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function renderStoryboardNode(node) {
  if (!node || typeof node !== 'object') return '';
  switch (node.kind) {
    case 'para':
      return '<p class="storyboard-p">'
        + (Array.isArray(node.seg) ? node.seg : []).map(renderStoryboardSeg).join('')
        + '</p>';
    case 'tempt':
      return '<div class="storyboard-temptation">'
        + '<span class="storyboard-tempt-label">' + escapeHTMLStoryboard(node.label) + '</span>'
        + '<span class="storyboard-tempt-quote">「' + escapeHTMLStoryboard(node.quote) + '」</span>'
        + '</div>';
    case 'final':
      return '<p class="storyboard-final">' + escapeHTMLStoryboard(node.text) + '</p>';
    default:
      return '';
  }
}

function renderStoryboardSeg(seg) {
  if (!seg || typeof seg !== 'object') return '';
  if (typeof seg.t === 'string') return escapeHTMLStoryboard(seg.t);
  if (typeof seg.q === 'string') return '<span class="storyboard-iquote">「' + escapeHTMLStoryboard(seg.q) + '」</span>';
  if (Number.isInteger(seg.step)) {
    const noPad = String(seg.step).padStart(2, '0');
    return '<a class="storyboard-step-link" href="#storyboard-step-' + noPad + '">' + escapeHTMLStoryboard(seg.label || '') + '</a>';
  }
  if (typeof seg.vil === 'string') return '<span class="storyboard-villain-name">' + escapeHTMLStoryboard(seg.vil) + '</span>';
  return '';
}

function renderStoryboardStepBlock(step, isFirst) {
  const noPad = String(step.no || '01');
  const expanded = isFirst ? 'true' : 'false';
  const hiddenAttr = isFirst ? '' : ' hidden';
  const bsDesc = step.brain_state && typeof step.brain_state.description === 'string'
    && step.brain_state.description.length > 0;
  const hasSa = typeof step.sovereign_action === 'string' && step.sovereign_action.length > 0;
  const isEmpty = step.state !== 'filled' || (!bsDesc && !hasSa);
  let body;
  if (isEmpty) {
    body = '<p class="storyboard-empty-placeholder">這塊土還沒走過</p>';
  } else {
    const parts = [];
    if (bsDesc) {
      const quoteHTML = (typeof step.brain_state.quote === 'string'
                        && step.brain_state.quote.length > 0)
        ? '<blockquote class="storyboard-quote-callout">'
            + escapeHTMLStoryboard(step.brain_state.quote) + '</blockquote>'
        : '';
      parts.push('<section class="storyboard-section storyboard-section--brain">'
        + '<h5 class="storyboard-section-title">大腦現狀</h5>'
        + '<p class="storyboard-section-text">' + escapeHTMLStoryboard(step.brain_state.description) + '</p>'
        + quoteHTML + '</section>');
    }
    // 6/15 S4 — 步1–5: 可能阻力 + 良善動機.
    if (typeof step.resistance === 'string' && step.resistance.length > 0) {
      parts.push('<section class="storyboard-section storyboard-section--resistance">'
        + '<h5 class="storyboard-section-title">可能阻力</h5>'
        + '<p class="storyboard-section-text">' + escapeHTMLStoryboard(step.resistance) + '</p>'
        + '</section>');
    }
    if (typeof step.benevolent_intent === 'string' && step.benevolent_intent.length > 0) {
      parts.push('<section class="storyboard-section storyboard-section--intent">'
        + '<h5 class="storyboard-section-title">良善動機</h5>'
        + '<p class="storyboard-section-text">' + escapeHTMLStoryboard(step.benevolent_intent) + '</p>'
        + '</section>');
    }
    if (hasSa) {
      parts.push('<section class="storyboard-section storyboard-section--sovereign">'
        + '<h5 class="storyboard-section-title">主權宣告</h5>'
        + '<p class="storyboard-section-text">' + escapeHTMLStoryboard(step.sovereign_action) + '</p>'
        + '</section>');
    }
    body = parts.join('\n');
  }
  return '<article id="storyboard-step-' + noPad + '" class="storyboard-step-block" data-step="' + noPad + '">'
    + '<button type="button" class="storyboard-step-toggle" '
    + 'aria-expanded="' + expanded + '" '
    + 'aria-controls="storyboard-step-body-' + noPad + '">'
    + '<span class="storyboard-step-no">' + escapeHTMLStoryboard(noPad) + '</span>'
    + '<span class="storyboard-step-name-zh">' + escapeHTMLStoryboard(step.name_zh || '') + '</span>'
    + '<span class="storyboard-step-peek">' + (isFirst ? '收合' : '展開') + '</span>'
    + '<svg class="storyboard-step-chev" viewBox="0 0 24 24" fill="none" '
    + 'stroke="currentColor" stroke-width="2" aria-hidden="true">'
    + '<path d="M6 9l6 6 6-6" stroke-linecap="round" stroke-linejoin="round"/></svg>'
    + '</button>'
    + '<div id="storyboard-step-body-' + noPad + '" class="storyboard-step-body"' + hiddenAttr + '>'
    + body
    + '</div></article>';
}

function renderStoryboardSideNav(currentStep) {
  const items = STORYBOARD_STEP_META_INLINE.map((s, i) => {
    const isCurrent = (currentStep === i + 1);
    const cls = isCurrent
      ? 'storyboard-nav-item storyboard-nav-item--current'
      : 'storyboard-nav-item';
    return '<a class="' + cls + '" href="#storyboard-step-' + s.no + '" data-step="' + s.no + '">'
      + '<span class="storyboard-nav-no">' + escapeHTMLStoryboard(s.no) + '</span>'
      + '<span class="storyboard-nav-name">' + escapeHTMLStoryboard(s.name_zh) + '</span>'
      + '</a>';
  }).join('\n');
  return '<nav class="storyboard-side-nav" aria-label="七步導覽">' + items + '</nav>';
}

function buildStoryboardBodyHTML(apiResp) {
  const safe = (apiResp && typeof apiResp === 'object') ? apiResp : {};
  const steps = Array.isArray(safe.steps) && safe.steps.length === 7
    ? safe.steps
    : STORYBOARD_STEP_META_INLINE.map(meta => ({
        no: meta.no, name_zh: meta.name_zh, name_en: meta.name_en,
        state: 'empty', brain_state: null, sovereign_action: null,
      }));
  const currentStep = Number.isInteger(safe.currentStep)
    && safe.currentStep >= 1 && safe.currentStep <= 7
    ? safe.currentStep : null;
  const storyHTML = STORYBOARD_STORY_INLINE.map(renderStoryboardNode).join('\n');
  const progressHTML = renderStoryboardProgressBar(steps, currentStep);
  const stepsHTML = steps.map((step, i) => {
    const block = renderStoryboardStepBlock(step, i === 0);
    const conn = STORYBOARD_CONNECTORS_INLINE[i];
    const connHTML = conn
      ? '<div class="storyboard-connector" aria-hidden="true">'
        + '<span class="storyboard-connector-line"></span>'
        + '<span class="storyboard-connector-text">' + escapeHTMLStoryboard(conn) + '</span>'
        + '<span class="storyboard-connector-line"></span></div>'
      : '';
    return block + connHTML;
  }).join('\n');
  // 6/12 Vivi — 故事預設收起 + 「展開更多」 toggle (storyboard-render.js sync).
  return progressHTML
    + '<div class="storyboard-arc storyboard-arc--collapsed" id="storyboard-story-wrap">'
    + '<button type="button" class="storyboard-arc-toggle" '
    + 'aria-expanded="false" aria-controls="storyboard-story">'
    + '<span class="storyboard-arc-title">先看這趟旅程的故事線</span>'
    + '<span class="storyboard-arc-peek">展開</span>'
    + '<svg class="storyboard-arc-chev" viewBox="0 0 24 24" fill="none" '
    + 'stroke="currentColor" stroke-width="2" aria-hidden="true">'
    + '<path d="M6 9l6 6 6-6" stroke-linecap="round" stroke-linejoin="round"/></svg>'
    + '</button>'
    + '<div class="storyboard-arc-body">'
    + '<div class="storyboard-story" id="storyboard-story">' + storyHTML + '</div>'
    + '</div></div>'
    + '<div class="storyboard-steps" id="storyboard-steps">' + stepsHTML + '</div>';
}

function attachStoryboardToggleHandlers(rootEl) {
  if (!rootEl) return;
  const reducedMotion = (typeof matchMedia === 'function'
    && matchMedia('(prefers-reduced-motion: reduce)').matches);
  rootEl.querySelectorAll('.storyboard-step-toggle').forEach(btn => {
    btn.addEventListener('click', () => {
      const expanded = btn.getAttribute('aria-expanded') === 'true';
      const next = !expanded;
      btn.setAttribute('aria-expanded', next ? 'true' : 'false');
      const peek = btn.querySelector('.storyboard-step-peek');
      if (peek) peek.textContent = next ? '收合' : '展開';
      const bodyId = btn.getAttribute('aria-controls');
      const body = bodyId ? rootEl.querySelector('#' + bodyId) : null;
      if (body) {
        if (next) body.removeAttribute('hidden');
        else      body.setAttribute('hidden', '');
      }
    });
    // Enter/空白 keyboard support — buttons handle this natively, but reinforce.
    btn.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        btn.click();
      }
    });
  });
  // Smooth scroll for story → step links (respect reduced-motion).
  rootEl.querySelectorAll('.storyboard-step-link, .storyboard-nav-item, .storyboard-pip').forEach(a => {
    a.addEventListener('click', (e) => {
      const href = a.getAttribute('href') || '';
      if (!href.startsWith('#storyboard-step-')) return;
      // 6/12 P0 fix — preventDefault 提前: 只要是 #storyboard-step-* 一律
      // 攔下,絕不讓它落到 SPA router. 之前 target 找不到 (因故事標籤 href
      // 沒補零) → return-before-preventDefault → location.hash 變
      // #storyboard-step-1 → router default → 跳 /entry/journey.
      // 雖然 fix A 補零後 target 一定找得到,但這層防呆永久鎖住 routing 漏洞.
      e.preventDefault();
      const target = document.querySelector(href);
      if (!target) return;
      target.scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth', block: 'start' });
      // Ensure the destination block is expanded so content is visible.
      const toggle = target.querySelector('.storyboard-step-toggle');
      const body = target.querySelector('.storyboard-step-body');
      if (toggle && body && toggle.getAttribute('aria-expanded') !== 'true') {
        toggle.setAttribute('aria-expanded', 'true');
        body.removeAttribute('hidden');
        const tpeek = toggle.querySelector('.storyboard-step-peek');
        if (tpeek) tpeek.textContent = '收合';
      }
    });
  });
  // 6/12 Vivi — 故事 「展開更多」/「收起」 toggle.
  // a11y: <button> + aria-expanded + native keyboard (Enter/Space).
  const storyWrap = rootEl.querySelector('#storyboard-story-wrap');
  const storyToggle = rootEl.querySelector('.storyboard-arc-toggle');
  if (storyWrap && storyToggle) {
    const storyBody = storyWrap.querySelector('.storyboard-arc-body');
    const storyPeek = storyToggle.querySelector('.storyboard-arc-peek');
    storyToggle.addEventListener('click', () => {
      const expanded = storyToggle.getAttribute('aria-expanded') === 'true';
      const next = !expanded;
      storyToggle.setAttribute('aria-expanded', next ? 'true' : 'false');
      if (storyPeek) storyPeek.textContent = next ? '收合' : '展開';
      storyWrap.classList.toggle('storyboard-arc--collapsed', !next);
      if (storyBody) storyBody.style.maxHeight = next ? storyBody.scrollHeight + 'px' : '0px';
    });
  }
}

async function renderStoryboard() {
  const bodyEl = document.getElementById('storyboard-body');
  if (!bodyEl) return;
  bodyEl.innerHTML = '<p class="storyboard-loading">載入中…</p>';
  let apiResp = null;
  try {
    const r = await fetch('/api/sc-storyboard?module=self', {
      credentials: 'include', headers: { 'accept': 'application/json' },
    });
    if (r.ok) apiResp = await r.json();
  } catch (_err) {
    // fail-soft: empty skeleton rendered below.
  }
  bodyEl.innerHTML = buildStoryboardBodyHTML(apiResp);
  attachStoryboardToggleHandlers(bodyEl);
}
