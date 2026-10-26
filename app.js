/* 스터디 메이트 — 친구랑 같이 쓰는 시험공부 진도 앱 */
(function () {
'use strict';

const CFG = window.APP_CONFIG || {};
const $app = document.getElementById('app');
const $layer = document.getElementById('layer');

const PALETTE = ['#1F6F5C', '#B7791F', '#4A6FA5', '#9B4F96', '#C2410C', '#3F7F2F', '#6B5BB5', '#B23A5B'];
const THEMES = ['#1F6F5C', '#4A6FA5', '#C2410C', '#9B4F96', '#B7791F', '#2F7F9F', '#B23A5B', '#3F4A44'];
const DEFAULT_KINDS = ['진도 빼기', '교안 예제', '교수님 문제', '족보', '추가 문제', '오답 정리', '전체 복습'];
const HIT = 10; // 진도 하나 = 10 데미지

const S = {
  user: null, me: null, fr: null, myPlan: null, frPlan: null,
  myTasks: [], frTasks: [], comments: [], pranks: [],
  tab: 'home', homeView: 'list', planView: 'week', selDay: null,
  form: null, editing: null, authMode: 'login', busy: false, err: '',
  draft: '', lastWake: 0, channel: null, loaded: false,
};

let sb = null;

/* ---------- 유틸 ---------- */
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parse = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const today = () => ymd(new Date());
const addDays = (s, n) => { const d = parse(s); d.setDate(d.getDate() + n); return ymd(d); };
const diffDays = (a, b) => Math.round((parse(b) - parse(a)) / 86400000);
const md = (s) => { const d = parse(s); return `${d.getMonth() + 1}.${d.getDate()}`; };
const DOW = ['일', '월', '화', '수', '목', '금', '토'];
const dowOf = (s) => DOW[parse(s).getDay()];
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const localDay = (iso) => (iso ? ymd(new Date(iso)) : null);
const pct = (list) => (list.length ? Math.round((list.filter((t) => t.done).length / list.length) * 100) : 0);

const weekNo = (plan, day) => Math.floor(diffDays(plan.start_date, day) / 7) + 1;
const weekStart = (plan, w) => addDays(plan.start_date, (w - 1) * 7);
const weekEnd = (plan, w) => addDays(plan.start_date, w * 7 - 1);
const curWeek = (plan) => clamp(weekNo(plan, today()), 1, plan.weeks);
/* 계획된 날짜가 지나면 밀림 */
const deadline = (t) => t.day;
const isLate = (t) => !t.done && !!t.day && t.day < today();
const inWeek = (t, w) => t.week_from <= w && w <= t.week_to;

function subjColor(plan, name) {
  const i = (plan?.subjects || []).findIndex((s) => s.name === name);
  return PALETTE[(i < 0 ? 7 : i) % PALETTE.length];
}

/* 같은 기간 할 일들을 "공부하는 날"에 모아서 배치.
   과목들이 같은 공부일을 함께 써서 하루에 물리+화학이 같이 들어가고, 사이사이는 쉬는 날/여유일이 됨 */
function assignDays(plan, list, minDay) {
  const groups = {};
  list.forEach((t) => { const k = `${t.week_from}-${t.week_to}`; (groups[k] = groups[k] || []).push(t); });
  Object.values(groups).forEach((g) => {
    const wf = g[0].week_from, wt = g[0].week_to;
    let from = weekStart(plan, wf);
    const to = weekEnd(plan, wt);
    if (minDay && from < minDay) from = minDay;
    if (from > to) { g.forEach((t) => { t.day = minDay && minDay > to ? minDay : to; }); return; }
    const n = diffDays(from, to) + 1;
    const bySubj = {};
    g.forEach((t) => { (bySubj[t.subject] = bySubj[t.subject] || []).push(t); });
    const m = Math.min(n, Math.max(...Object.values(bySubj).map((s) => s.length)));
    const studyDays = Array.from({ length: m }, (_, j) => Math.floor((j * n) / m));
    Object.values(bySubj).forEach((s) => {
      s.forEach((t, i) => {
        const off = s.length > m ? Math.floor((i * n) / s.length) : studyDays[Math.floor((i * m) / s.length)];
        t.day = addDays(from, off);
      });
    });
  });
  return list;
}

function streak(tasks) {
  const days = new Set(tasks.filter((t) => t.done && t.done_at).map((t) => localDay(t.done_at)));
  let d = today();
  if (!days.has(d)) d = addDays(d, -1);
  let n = 0;
  while (days.has(d)) { n++; d = addDays(d, -1); }
  return n;
}

const doneToday = (tasks) => tasks.filter((t) => t.done && localDay(t.done_at) === today()).length;

function nickState() {
  const myHits = doneToday(S.myTasks), frHits = doneToday(S.frTasks);
  const meWin = myHits > frHits, frWin = frHits > myHits;
  const myNick = meWin && S.me?.nickname_day === today() && S.me?.nickname_for_friend ? S.me.nickname_for_friend : null;
  const frNick = frWin && S.fr?.nickname_day === today() && S.fr?.nickname_for_friend ? S.fr.nickname_for_friend : null;
  return { myHits, frHits, meWin, frWin, myNick, frNick };
}
const frName = () => nickState().myNick || S.fr?.name || '친구';
const meName = () => nickState().frNick || S.me?.name || '나';

function toast(msg, ms = 2400, action) {
  document.querySelectorAll('.toast').forEach((t) => t.remove());
  const el = document.createElement('div');
  el.className = 'toast';
  const span = document.createElement('span'); span.textContent = msg; el.appendChild(span);
  if (action) {
    el.style.display = 'flex'; el.style.alignItems = 'center'; el.style.gap = '12px';
    const b = document.createElement('button');
    b.textContent = action.label;
    b.style.cssText = 'border:0;background:transparent;color:inherit;font:inherit;font-weight:700;text-decoration:underline;padding:6px 0;white-space:nowrap';
    b.addEventListener('click', () => { el.remove(); action.run(); });
    el.appendChild(b);
  }
  document.body.appendChild(el);
  setTimeout(() => el.remove(), ms);
}

function burst(x, y, text) {
  const el = document.createElement('div');
  el.className = 'burst'; el.textContent = text;
  el.style.left = x + 'px'; el.style.top = y + 'px';
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 900);
}

async function fnError(error) {
  try { const j = await error.context.json(); return j.error || error.message; } catch (e) { return error?.message || '오류가 났어요'; }
}

async function callApi(body) {
  const { data, error } = await sb.functions.invoke(CFG.functionName || 'rapid-api', { body });
  if (error) throw new Error(await fnError(error));
  if (data?.error) throw new Error(data.error);
  return data;
}

function compressImage(file, max = 900) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const r = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * r); c.height = Math.round(img.height * r);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      c.toBlob((b) => (b ? resolve(b) : reject(new Error('사진 변환 실패'))), 'image/jpeg', 0.82);
    };
    img.onerror = () => reject(new Error('사진을 열 수 없어요'));
    img.src = url;
  });
}

async function uploadPhoto(file) {
  const blob = await compressImage(file);
  const path = `${S.user.id}/${Date.now()}-${Math.random().toString(36).slice(2, 7)}.jpg`;
  const { error } = await sb.storage.from('photos').upload(path, blob, { contentType: 'image/jpeg' });
  if (error) throw error;
  return sb.storage.from('photos').getPublicUrl(path).data.publicUrl;
}

function pickFile(cb) {
  const inp = document.createElement('input');
  inp.type = 'file'; inp.accept = 'image/*';
  inp.onchange = () => inp.files[0] && cb(inp.files[0]);
  inp.click();
}

function avatarHtml(p, size, color) {
  const s = `width:${size}px;height:${size}px;font-size:${Math.round(size * 0.42)}px;background:${esc(color || p?.color || '#888')}`;
  if (p?.avatar_url) return `<img class="avatar" src="${esc(p.avatar_url)}" alt="" style="${s}">`;
  return `<span class="avatar" style="${s}">${esc((p?.name || '?').slice(0, 1))}</span>`;
}

const ICON = {
  check: '<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12l5 5 9-10"/></svg>',
  home: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M4 11l8-7 8 7v9h-5v-6H9v6H4z"/></svg>',
  plan: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="4" y="5" width="16" height="15" rx="2"/><path d="M4 10h16M9 3v4M15 3v4"/></svg>',
  fight: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M7 10V7a2 2 0 014 0v3M11 9V6a2 2 0 014 0v4M15 9a2 2 0 014 0v3a7 7 0 01-7 7h-1a6 6 0 01-6-6v-2a2 2 0 014 0"/></svg>',
  me: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 21c1-4 4-6 8-6s7 2 8 6"/></svg>',
  photo: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="11" r="2"/><path d="M21 17l-5-5-8 7"/></svg>',
  bell: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M6 16V11a6 6 0 0112 0v5l2 2H4zM10 20a2 2 0 004 0"/></svg>',
};

/* ---------- 렌더 공통 ---------- */
let renderQueued = false;
function render() {
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(() => { renderQueued = false; renderNow(); });
}

function renderNow() {
  const a = document.activeElement;
  const keep = a && a.id && $app.contains(a) ? { id: a.id, v: a.value, s: a.selectionStart, e: a.selectionEnd } : null;
  const y = window.scrollY;

  let html = '';
  if (!S.user) html = viewAuth();
  else if (!S.loaded) html = '<div class="center"><div class="spin" style="align-self:center;color:var(--me)"></div></div>';
  else if (!S.me) html = `<div class="center"><div class="err">${esc(S.err || '프로필을 불러오지 못했어요')}</div></div>`;
  else {
    const solo = !S.me.friend_id || !S.fr;
    const body = { home: viewHome, plan: viewPlan, fight: solo ? viewPair : viewFight, profile: viewProfile }[S.tab]();
    html = body + viewTabs();
  }
  $app.innerHTML = html;

  if (keep) {
    const el = document.getElementById(keep.id);
    if (el) { el.value = keep.v; el.focus(); try { el.setSelectionRange(keep.s, keep.e); } catch (e) { /* */ } }
  }
  window.scrollTo(0, y);
  bindSwipes();
  if (S.tab === 'fight') tickCountdown();
  if (S.tab === 'fight' && S.replay && !S.replay.running) requestAnimationFrame(runReplay);
}

function viewTabs() {
  const t = (id, icon, label) => `<button data-act="tab" data-tab="${id}" class="${S.tab === id ? 'on' : ''}" ${S.tab === id ? 'aria-current="page"' : ''}>${ICON[icon]}${label}</button>`;
  return `<nav class="tabs" aria-label="메뉴"><div class="in">${t('home', 'home', '홈')}${t('plan', 'plan', '계획')}${t('fight', 'fight', '대결')}${t('profile', 'me', '프로필')}</div></nav>`;
}

/* ---------- 로그인 ---------- */
function viewAuth() {
  if (!CFG.supabaseUrl || !CFG.supabaseAnonKey) {
    return `<div class="center"><h1>설정이 필요해요</h1><p class="sub">config.js에 Supabase 주소와 키를 넣어주세요.</p></div>`;
  }
  const signup = S.authMode === 'signup';
  return `<div class="center">
    <div><div class="sub">친구랑 같이 하는 시험공부</div><h1 style="font-size:30px">스터디 메이트</h1></div>
    <form id="authForm" class="card" style="gap:12px">
      ${signup ? '<label class="label" for="aName">이름</label><input id="aName" autocomplete="nickname" placeholder="친구한테 보일 이름" required>' : ''}
      <label class="label" for="aEmail">이메일</label><input id="aEmail" type="email" autocomplete="email" required>
      <label class="label" for="aPw">비밀번호 (6자 이상)</label><input id="aPw" type="password" autocomplete="${signup ? 'new-password' : 'current-password'}" minlength="6" required>
      ${S.err ? `<div class="err">${esc(S.err)}</div>` : ''}
      <button class="btn" type="submit" ${S.busy ? 'disabled' : ''}>${S.busy ? '<span class="spin"></span>' : signup ? '가입하기' : '로그인'}</button>
    </form>
    <button class="btn line" data-act="authMode">${signup ? '이미 계정 있어요 · 로그인' : '처음이에요 · 가입하기'}</button>
  </div>`;
}

async function submitAuth() {
  const email = document.getElementById('aEmail').value.trim();
  const pw = document.getElementById('aPw').value;
  const nameEl = document.getElementById('aName');
  S.busy = true; S.err = ''; render();
  try {
    if (S.authMode === 'signup') {
      const { data, error } = await sb.auth.signUp({ email, password: pw, options: { data: { name: nameEl.value.trim() } } });
      if (error) throw error;
      if (!data.session) S.err = '가입 확인 메일을 보냈어요. 메일의 링크를 누른 뒤 로그인해주세요.';
    } else {
      const { error } = await sb.auth.signInWithPassword({ email, password: pw });
      if (error) throw error;
    }
  } catch (e) {
    S.err = /Invalid login/i.test(e.message) ? '이메일이나 비밀번호가 맞지 않아요' : e.message;
  }
  S.busy = false; render();
}

/* ---------- 친구 연결 ---------- */
function viewPair() {
  return `<div class="center" style="padding-bottom:120px">
    <h1>친구랑 연결하기</h1>
    <div class="sub">홈이랑 계획은 혼자서도 쓸 수 있어요. 대결, 댓글, 사진은 친구랑 연결하면 열려요.</div>
    <div class="card" style="align-items:center;text-align:center">
      <div class="label">내 초대 코드</div>
      <div class="num" style="font-size:36px;font-weight:700;letter-spacing:.15em;color:var(--me)">${esc(S.me?.invite_code || '------')}</div>
      <button class="btn line small" data-act="copyCode">코드 복사</button>
      <div class="sub">친구한테 이 코드를 보내거나, 친구 코드를 아래에 넣어요</div>
    </div>
    <form id="pairForm" class="card">
      <label class="label" for="pCode">친구 코드</label>
      <input id="pCode" autocapitalize="characters" maxlength="6" placeholder="예: A1B2C3" required>
      ${S.err ? `<div class="err">${esc(S.err)}</div>` : ''}
      <button class="btn" type="submit" ${S.busy ? 'disabled' : ''}>연결하기</button>
    </form>
  </div>`;
}

async function submitPair() {
  const code = document.getElementById('pCode').value;
  S.busy = true; S.err = ''; render();
  const { error } = await sb.rpc('pair_with', { code });
  S.busy = false;
  if (error) { S.err = error.message; render(); return; }
  await loadAll();
}

/* ---------- 홈 ---------- */
function viewHome() {
  const plan = S.myPlan;
  const ns = nickState();
  if (!plan) {
    return `<div class="page">
      <h1>${esc(meName())}, 반가워요</h1>
      <div class="card"><h2>아직 계획이 없어요</h2><div class="sub">몇 주 동안 공부할지랑 과목 범위를 넣으면 AI가 주 단위로 계획을 짜줘요.</div>
      <button class="btn" data-act="startPlan">계획 만들기</button></div>
    </div>`;
  }
  const cw = curWeek(plan);
  const weekTasks = S.myTasks.filter((t) => inWeek(t, cw));
  const late = S.myTasks.filter(isLate);
  const p = pct(weekTasks);
  const fp = S.frPlan ? pct(S.frTasks.filter((t) => inWeek(t, curWeek(S.frPlan)))) : null;

  let body = '';
  if (S.homeView === 'list') {
    if (late.length) {
      body += `<div class="card"><div class="between"><h2 style="color:var(--late-ink)">밀린 것</h2><span class="sub">${late.length}개</span></div>${late.map(taskRow).join('')}
        <button class="btn ghost" data-act="replan">밀린 거 AI로 다시 배분하기</button></div>`;
    }
    const bySubj = {};
    weekTasks.filter((t) => !isLate(t)).forEach((t) => (bySubj[t.subject] = bySubj[t.subject] || []).push(t));
    const subjects = (plan.subjects || []).map((s) => s.name).filter((n) => bySubj[n]).concat(Object.keys(bySubj).filter((n) => !(plan.subjects || []).some((s) => s.name === n)));
    subjects.forEach((name) => {
      const list = bySubj[name];
      const allDone = list.every((t) => t.done) && !weekTasks.some((t) => t.subject === name && isLate(t));
      body += `<div class="card stampWrap" data-subj="${esc(name)}">
        <div class="between"><h2><span style="display:inline-block;width:8px;height:8px;border-radius:4px;background:${subjColor(plan, name)};margin-right:8px;vertical-align:middle"></span>${esc(name)}</h2><span class="sub num">${list.filter((t) => t.done).length}/${list.length}</span></div>
        ${list.map(taskRow).join('')}
        ${allDone ? '<div class="stamp">완료</div>' : ''}
      </div>`;
    });
    if (!subjects.length && !late.length) body += `<div class="card"><div class="sub">이번 주 할 일이 없어요. 계획 탭에서 추가할 수 있어요.</div></div>`;
    body += `<div class="sub" style="text-align:center">오른쪽으로 밀면 완료 · 왼쪽으로 밀면 내일로 미루기</div>`;
  } else {
    body += viewCalendar(plan);
  }

  return `<div class="page">
    <div style="display:flex;flex-direction:column;gap:4px">
      <div class="sub">${cw}주차 / ${plan.weeks}주 · ${md(weekStart(plan, cw))} – ${md(weekEnd(plan, cw))}</div>
      <div class="between" style="align-items:flex-end"><h1>이번 주 ${esc(meName())} 진도</h1><div class="num" id="weekPct" style="font-size:32px;font-weight:700;color:var(--me)">${p}%</div></div>
      <div class="bar" style="margin-top:6px"><i id="weekBar" style="width:${p}%"></i></div>
      <div class="chips" style="margin-top:10px">
        ${late.length ? `<span class="pill late">밀림 ${late.length}개</span>` : ''}
        ${fp != null ? `<span class="pill me">${esc(frName())} ${fp}% · ${p >= fp ? '내가 앞섬' : '내가 밀림'}</span>` : ''}
        ${ns.frNick ? `<span class="pill late">오늘 호칭: ${esc(ns.frNick)}</span>` : ''}
      </div>
    </div>
    <div class="seg" role="tablist"><button data-act="homeView" data-v="list" class="${S.homeView === 'list' ? 'on' : ''}">체크리스트</button><button data-act="homeView" data-v="cal" class="${S.homeView === 'cal' ? 'on' : ''}">달력</button></div>
    ${body}
  </div>`;
}

function taskRow(t) {
  const late = isLate(t);
  let meta = '';
  if (late) meta = `${md(t.day)}까지 · ${diffDays(t.day, today())}일 밀림`;
  else if (t.done && t.late_count) meta = `완료 · ${t.late_count}번 밀렸었음`;
  else if (t.day) meta = `${md(t.day)} (${dowOf(t.day)})${t.late_count ? ` · ${t.late_count}번 밀림` : ''}`;
  return `<div class="task ${t.done ? 'done' : ''} ${late ? 'isLate' : ''}" data-id="${t.id}">
    <div class="bgR">완료</div><div class="bgL">내일로</div>
    <div class="fg">
      <button class="chk ${t.done ? 'on' : ''}" data-act="toggle" data-id="${t.id}" aria-label="${t.done ? '완료 취소' : '완료'}">${ICON.check}</button>
      <div class="t"><div>${esc(t.title)}</div>${meta ? `<div class="meta">${esc(meta)}</div>` : ''}</div>
    </div>
  </div>`;
}

function viewCalendar(plan) {
  const start = weekStart(plan, 1);
  const lead = (parse(start).getDay() + 6) % 7; // 월요일 시작
  const first = addDays(start, -lead);
  const last = weekEnd(plan, plan.weeks);
  const total = Math.ceil((diffDays(first, last) + 1) / 7) * 7;
  const sel = S.selDay || today();
  let cells = '';
  for (let i = 0; i < total; i++) {
    const d = addDays(first, i);
    const ts = S.myTasks.filter((t) => t.day === d);
    const out = d < start || d > last;
    const subs = [...new Set(ts.map((t) => t.subject))].slice(0, 3);
    const late = ts.some(isLate);
    const allDone = ts.length && ts.every((t) => t.done);
    cells += `<button data-act="selDay" data-d="${d}" class="${out ? 'out' : ''} ${d === today() ? 'today' : ''} ${d === sel ? 'sel' : ''} ${late ? 'late' : ''}" aria-label="${md(d)}">
      <span class="num">${parse(d).getDate() === 1 ? md(d) : parse(d).getDate()}</span>
      <span class="dots">${subs.map((s) => `<i style="background:${allDone ? 'var(--field)' : subjColor(plan, s)}"></i>`).join('')}</span>
    </button>`;
  }
  const dayTasks = S.myTasks.filter((t) => t.day === sel);
  const legend = (plan.subjects || []).map((s) => `<span class="row" style="gap:4px;font-size:11px;color:var(--muted)"><i style="width:6px;height:6px;border-radius:3px;background:${subjColor(plan, s.name)}"></i>${esc(s.name)}</span>`).join('');
  return `<div class="card" style="padding:12px">
      <div class="cal">${['월', '화', '수', '목', '금', '토', '일'].map((d) => `<div class="h">${d}</div>`).join('')}${cells}</div>
      <div class="chips" style="gap:12px">${legend}<span class="row" style="gap:4px;font-size:11px;color:var(--muted)"><i style="width:10px;height:10px;border-radius:3px;border:2px solid var(--late)"></i>밀린 날</span></div>
    </div>
    <div class="between"><h2>${md(sel)} (${dowOf(sel)})${sel === today() ? ' · 오늘' : ''}</h2><span class="sub num">${dayTasks.filter((t) => t.done).length}/${dayTasks.length}</span></div>
    <div class="card">${dayTasks.length ? dayTasks.map(taskRow).join('') : '<div class="sub">이 날은 할 일이 없어요</div>'}</div>`;
}

/* 스와이프 */
function bindSwipes() {
  $app.querySelectorAll('.task .fg').forEach((fg) => {
    let x0 = null, y0 = 0, dx = 0, locked = null;
    const row = fg.parentElement;
    fg.addEventListener('pointerdown', (e) => { if (e.target.closest('button')) return; x0 = e.clientX; y0 = e.clientY; dx = 0; locked = null; fg.classList.add('drag'); });
    fg.addEventListener('pointermove', (e) => {
      if (x0 == null) return;
      const mx = e.clientX - x0, my = e.clientY - y0;
      if (locked == null && (Math.abs(mx) > 8 || Math.abs(my) > 8)) { locked = Math.abs(mx) > Math.abs(my) ? 'x' : 'y'; if (locked === 'x') fg.setPointerCapture(e.pointerId); }
      if (locked !== 'x') return;
      dx = mx; row.classList.add('swiping'); fg.style.transform = `translateX(${dx}px)`;
    });
    const end = () => {
      if (x0 == null) return;
      fg.classList.remove('drag'); x0 = null;
      const id = row.dataset.id;
      if (locked === 'x' && dx > 90) { fg.style.transform = 'translateX(110%)'; setTimeout(() => setDone(id, true, fg), 180); }
      else if (locked === 'x' && dx < -90) { fg.style.transform = 'translateX(-110%)'; setTimeout(() => postpone(id), 180); }
      else { fg.style.transform = ''; setTimeout(() => row.classList.remove('swiping'), 250); }
    };
    fg.addEventListener('pointerup', end);
    fg.addEventListener('pointercancel', end);
  });
}

async function setDone(id, done, srcEl) {
  const t = S.myTasks.find((x) => x.id === id);
  if (!t) return;
  if (t.done === done) { render(); return; }
  const before = { done: t.done, done_at: t.done_at };
  t.done = done; t.done_at = done ? new Date().toISOString() : null;
  if (done) {
    const r = (srcEl || document.querySelector(`.task[data-id="${id}"]`))?.getBoundingClientRect();
    if (r) burst(r.left + 40, r.top, '한 대!');
    if (navigator.vibrate) navigator.vibrate(30);
  }
  render();
  if (done) {
    requestAnimationFrame(() => {
      const card = [...document.querySelectorAll('.stampWrap')].find((c) => c.dataset.subj === t.subject);
      const st = card?.querySelector('.stamp');
      if (st) st.classList.add('anim');
      document.querySelector(`.task[data-id="${id}"]`)?.classList.add('pop');
    });
    punch('me');
  }
  const { error } = await sb.from('tasks').update({ done: t.done, done_at: t.done_at }).eq('id', id);
  if (error) { Object.assign(t, before); render(); toast('저장 실패: ' + error.message); }
}

async function postpone(id) {
  const t = S.myTasks.find((x) => x.id === id);
  if (!t || !S.myPlan) return;
  const tomorrow = addDays(today(), 1);
  const base = t.day && t.day > today() ? addDays(t.day, 1) : tomorrow;
  const w = clamp(weekNo(S.myPlan, base), 1, S.myPlan.weeks);
  const before = { day: t.day, week_to: t.week_to, week_from: t.week_from, late_count: t.late_count || 0 };
  const patch = { day: base, week_to: Math.max(t.week_to, w), week_from: Math.min(t.week_from, w), late_count: (t.late_count || 0) + 1 };
  Object.assign(t, patch);
  render();
  toast(`${md(base)}로 미룸 · 밀림 +1`, 5000, {
    label: '되돌리기',
    run: async () => {
      Object.assign(t, before); render();
      const r = await sb.from('tasks').update(before).eq('id', id);
      toast(r.error ? '되돌리기 실패: ' + r.error.message : '되돌렸어요');
    },
  });
  const { error } = await sb.from('tasks').update(patch).eq('id', id);
  if (error) toast('저장 실패: ' + error.message);
}

/* ---------- 계획 ---------- */
function newForm() {
  const p = S.myPlan;
  return {
    start: p?.start_date || today(),
    weeks: p?.weeks || 4,
    subjects: p?.subjects?.length ? p.subjects.map((s) => ({ ...s })) : [{ name: '', range: '' }],
    kinds: p?.kinds?.length ? [...p.kinds] : ['진도 빼기', '교안 예제', '교수님 문제', '족보', '오답 정리', '전체 복습'],
    extraKinds: (p?.kinds || []).filter((k) => !DEFAULT_KINDS.includes(k)),
    goal: p?.goal || '',
    confirm: false,
  };
}

function viewPlan() {
  if (!S.myPlan || S.form) return viewSetup();
  const plan = S.myPlan;
  const edited = S.myTasks.filter((t) => t.edited && !t.done).length;
  let body = '';
  if (S.planView === 'week') {
    for (let w = 1; w <= plan.weeks; w++) {
      const list = S.myTasks.filter((t) => t.week_from === w);
      const span = S.myTasks.filter((t) => inWeek(t, w));
      body += `<div class="card">
        <div class="between"><h2>${w}주차${w === curWeek(plan) ? ' · 지금' : ''}</h2><span class="sub num">${md(weekStart(plan, w))} – ${md(weekEnd(plan, w))} · ${pct(span)}%</span></div>
        ${list.length ? list.map(planRow).join('') : '<div class="sub">이 주에 시작하는 할 일 없음</div>'}
      </div>`;
    }
  } else {
    const days = [...new Set(S.myTasks.map((t) => t.day).filter(Boolean))].sort();
    body = days.map((d) => `<div class="card"><div class="between"><h2>${md(d)} (${dowOf(d)})${d === today() ? ' · 오늘' : ''}</h2><span class="sub">${weekNo(plan, d)}주차</span></div>${S.myTasks.filter((t) => t.day === d).map(planRow).join('')}</div>`).join('') || '<div class="card"><div class="sub">할 일이 없어요</div></div>';
  }
  return `<div class="page">
    <div class="between"><h1>내 계획 · ${plan.weeks}주</h1><button class="btn line small" data-act="startPlan">계획 다시 만들기</button></div>
    <div class="sub">${md(plan.start_date)} – ${md(weekEnd(plan, plan.weeks))}</div>
    <div class="seg"><button data-act="planView" data-v="week" class="${S.planView === 'week' ? 'on' : ''}">주 단위</button><button data-act="planView" data-v="day" class="${S.planView === 'day' ? 'on' : ''}">하루씩</button></div>
    <button class="btn" data-act="replan" ${S.busy ? 'disabled' : ''}>${S.busy ? '<span class="spin"></span> AI가 다시 짜는 중' : '내가 고친 거 반영해서 AI로 다시 짜기'}</button>
    <div class="sub">${edited ? `직접 고친 ${edited}개는 그대로 두고 나머지 안 한 것만 다시 배분해요` : '항목을 눌러 직접 고칠 수 있어요. 고친 건 AI가 건드리지 않아요'}</div>
    <button class="btn ghost" data-act="addTask">+ 할 일 추가</button>
    ${body}
  </div>`;
}

function planRow(t) {
  const late = isLate(t);
  const status = t.done ? '<span class="st ok">완료</span>' : late ? '<span class="st bad">밀림</span>' : '';
  return `<button data-act="editTask" data-id="${t.id}" class="between" style="border:0;background:${late ? 'var(--late-soft)' : 'transparent'};padding:8px;margin:0 -8px;border-radius:8px;text-align:left;min-height:44px">
    <span style="min-width:0;flex:1"><span style="display:inline-block;width:6px;height:6px;border-radius:3px;background:${subjColor(S.myPlan, t.subject)};margin-right:6px;vertical-align:middle"></span>${esc(t.subject)} · ${esc(t.title)}
      <span class="sub" style="display:block;font-size:11px;margin-left:12px">${t.week_from !== t.week_to ? `${t.week_from}~${t.week_to}주차 · ` : ''}${t.day ? md(t.day) : ''}${t.edited ? ' · 직접 수정' : ''}${t.late_count ? ` · ${t.late_count}번 밀림` : ''}</span></span>
    ${status}
  </button>`;
}

function viewSetup() {
  const f = S.form || (S.form = newForm());
  const kinds = [...DEFAULT_KINDS, ...f.extraKinds];
  const hasTasks = S.myTasks.length > 0;
  return `<div class="page">
    <div class="between"><h1>시험공부 계획 만들기</h1>${S.myPlan ? '<button class="btn line small" data-act="cancelSetup">취소</button>' : ''}</div>
    <div class="card">
      <div class="label">기간</div>
      <div class="row"><label for="fStart" class="sub" style="white-space:nowrap">시작일</label><input id="fStart" type="date" value="${esc(f.start)}"></div>
      <div class="chips">${[1, 2, 3, 4, 5, 6, 7, 8].map((n) => `<button class="chip ${f.weeks === n ? 'on' : ''}" data-act="fWeeks" data-n="${n}">${n}주</button>`).join('')}</div>
      <div class="sub">${md(f.start)} – ${md(addDays(f.start, f.weeks * 7 - 1))} · 시험 날짜 몰라도 돼요</div>
    </div>
    <div class="card">
      <div class="label">과목 · 범위</div>
      ${f.subjects.map((s, i) => `<div style="display:flex;flex-direction:column;gap:6px;${i ? 'border-top:1px solid var(--line);padding-top:10px' : ''}">
        <div class="row"><input id="fsn${i}" data-f="sname" data-i="${i}" placeholder="과목 (예: 물리)" value="${esc(s.name)}">${f.subjects.length > 1 ? `<button class="btn line small" data-act="delSubj" data-i="${i}" aria-label="과목 삭제">삭제</button>` : ''}</div>
        <textarea id="fsr${i}" data-f="srange" data-i="${i}" placeholder="범위를 자유롭게 (예: 22단원 운동량, 23단원 충돌, 24단원 회전운동)">${esc(s.range)}</textarea>
      </div>`).join('')}
      <button class="btn ghost" data-act="addSubj">+ 과목 추가</button>
    </div>
    <div class="card">
      <div class="label">시험기간에 할 것</div>
      <div class="chips">${kinds.map((k) => `<button class="chip ${f.kinds.includes(k) ? 'on' : ''}" data-act="fKind" data-k="${esc(k)}">${esc(k)}</button>`).join('')}</div>
      <div class="row"><input id="fNewKind" placeholder="직접 추가 (예: 실험 보고서 복습)"><button class="btn line small" data-act="addKind">추가</button></div>
    </div>
    <div class="card">
      <label class="label" for="fGoal">AI한테 한마디 (선택)</label>
      <textarea id="fGoal" data-f="goal" placeholder="예: 물리가 제일 약해. 마지막 주는 복습만 할래">${esc(f.goal)}</textarea>
    </div>
    ${S.err ? `<div class="err">${esc(S.err)}</div>` : ''}
    ${hasTasks && f.confirm ? '<div class="err">지금 계획이 지워지고 새로 만들어져요. 완료 기록도 사라져요.</div>' : ''}
    <button class="btn" data-act="makePlan" ${S.busy ? 'disabled' : ''}>${S.busy ? '<span class="spin"></span> AI가 계획 짜는 중' : hasTasks && f.confirm ? '그래도 새로 만들기' : 'AI로 계획 짜기'}</button>
    <button class="btn line" data-act="makeEmpty" ${S.busy ? 'disabled' : ''}>AI 없이 빈 계획으로 시작</button>
  </div>`;
}

function readForm() {
  const f = S.form;
  const st = document.getElementById('fStart');
  if (st && st.value) f.start = st.value;
  return f;
}

async function makePlan(useAi) {
  const f = readForm();
  const subjects = f.subjects.map((s) => ({ name: s.name.trim(), range: s.range.trim() })).filter((s) => s.name);
  if (!subjects.length) { S.err = '과목을 하나 이상 넣어주세요'; render(); return; }
  if (useAi && !f.kinds.length) { S.err = '할 것을 하나 이상 골라주세요'; render(); return; }
  if (S.myTasks.length && !f.confirm) { f.confirm = true; S.err = ''; render(); return; }
  S.busy = true; S.err = ''; render();
  try {
    const planRow = { user_id: S.user.id, start_date: f.start, weeks: f.weeks, subjects, kinds: f.kinds, goal: f.goal.trim() || null, updated_at: new Date().toISOString() };
    let tasks = [];
    if (useAi) {
      const out = await callApi({ action: 'plan', weeks: f.weeks, subjects, kinds: f.kinds, goal: f.goal });
      tasks = (out.tasks || []).filter((t) => t && t.title).map((t, i) => {
        const wf = clamp(parseInt(t.week_from, 10) || 1, 1, f.weeks);
        const wt = clamp(parseInt(t.week_to, 10) || wf, wf, f.weeks);
        return { user_id: S.user.id, subject: String(t.subject || subjects[0].name).slice(0, 40), title: String(t.title).slice(0, 80), kind: t.kind ? String(t.kind).slice(0, 30) : null, week_from: wf, week_to: wt, sort: i };
      });
      if (!tasks.length) throw new Error('AI가 빈 계획을 줬어요. 다시 눌러보세요');
    }
    assignDays(planRow, tasks);
    const del = await sb.from('tasks').delete().eq('user_id', S.user.id);
    if (del.error) throw del.error;
    const up = await sb.from('plans').upsert(planRow);
    if (up.error) throw up.error;
    if (tasks.length) { const ins = await sb.from('tasks').insert(tasks); if (ins.error) throw ins.error; }
    S.form = null; S.tab = 'plan';
    await loadMine();
    toast(useAi ? `계획 완성 · 할 일 ${tasks.length}개` : '빈 계획을 만들었어요');
  } catch (e) {
    S.err = e.message || String(e);
  }
  S.busy = false; render();
}

async function replan() {
  const plan = S.myPlan;
  if (!plan || S.busy) return;
  const cw = curWeek(plan);
  const pending = S.myTasks.filter((t) => !t.done && !t.edited);
  if (!pending.length) { toast('다시 배분할 할 일이 없어요'); return; }
  S.busy = true; render();
  toast('AI가 다시 짜는 중…');
  try {
    const fixed = S.myTasks.filter((t) => t.edited && !t.done);
    const out = await callApi({
      action: 'replan', weeks: plan.weeks, current_week: cw, goal: plan.goal,
      pending: pending.map((t) => ({ id: t.id, subject: t.subject, title: t.title, kind: t.kind, week_from: t.week_from, week_to: t.week_to, overdue: isLate(t) })),
      fixed: fixed.map((t) => ({ subject: t.subject, title: t.title, week_from: t.week_from, week_to: t.week_to })),
    });
    const map = {};
    (out.tasks || []).forEach((r) => { if (r && r.id) map[r.id] = r; });
    const changed = [];
    pending.forEach((t) => {
      const r = map[t.id];
      const wf = clamp(parseInt(r?.week_from, 10) || Math.max(cw, t.week_from), cw, plan.weeks);
      const wt = clamp(parseInt(r?.week_to, 10) || wf, wf, plan.weeks);
      const c = { ...t, week_from: wf, week_to: wt, late_count: (t.late_count || 0) + (isLate(t) ? 1 : 0) };
      changed.push(c);
    });
    assignDays(plan, changed, today());
    const results = await Promise.all(changed.map((c) => sb.from('tasks').update({ week_from: c.week_from, week_to: c.week_to, day: c.day, late_count: c.late_count }).eq('id', c.id)));
    const bad = results.find((r) => r.error);
    if (bad) throw bad.error;
    await loadMine();
    toast(`${changed.length}개를 다시 배분했어요`);
  } catch (e) {
    toast('다시 배분 실패: ' + (e.message || e), 4000);
  }
  S.busy = false; render();
}

/* 항목 수정 시트 */
function openEdit(id) {
  const t = id ? S.myTasks.find((x) => x.id === id) : null;
  const plan = S.myPlan;
  const cw = curWeek(plan);
  S.editing = t ? { ...t, specific: '' } : { id: null, subject: plan.subjects?.[0]?.name || '', title: '', kind: plan.kinds?.[0] || '', week_from: cw, week_to: cw, specific: '' };
  S.editing.confirmDel = false;
  renderSheet();
}

function renderSheet() {
  const e = S.editing;
  if (!e) { $layer.innerHTML = ''; return; }
  const plan = S.myPlan;
  const subjects = [...new Set([...(plan.subjects || []).map((s) => s.name), e.subject].filter(Boolean))];
  const kinds = [...new Set([...(plan.kinds || []), ...DEFAULT_KINDS, e.kind].filter(Boolean))];
  const wopts = (sel) => Array.from({ length: plan.weeks }, (_, i) => `<option value="${i + 1}" ${sel === i + 1 ? 'selected' : ''}>${i + 1}주차</option>`).join('');
  $layer.innerHTML = `<div class="sheetBg" data-act="closeSheet"><div class="sheet" role="dialog" aria-label="할 일 수정">
    <div class="grab"></div>
    <div class="between"><h2 style="font-size:18px">${e.id ? '할 일 수정' : '할 일 추가'}</h2>${e.id ? `<button class="btn danger small" data-act="delTask">${e.confirmDel ? '정말 삭제' : '삭제'}</button>` : ''}</div>
    <label class="label" for="eTitle">할 일</label><input id="eTitle" value="${esc(e.title)}" placeholder="예: 23단원 충돌 진도">
    <label class="label" for="eSubj">과목</label><select id="eSubj">${subjects.map((s) => `<option ${s === e.subject ? 'selected' : ''}>${esc(s)}</option>`).join('')}</select>
    <div class="label">종류</div>
    <div class="chips">${kinds.map((k) => `<button class="chip ${k === e.kind ? 'on' : ''}" data-act="eKind" data-k="${esc(k)}">${esc(k)}</button>`).join('')}</div>
    <div class="label">기간</div>
    <div class="row"><select id="eWf" aria-label="시작 주차">${wopts(e.week_from)}</select><span>~</span><select id="eWt" aria-label="끝 주차">${wopts(e.week_to)}</select></div>
    <label class="label" for="eDay">특정 날짜로 지정 (선택)</label>
    <input id="eDay" type="date" min="${plan.start_date}" max="${weekEnd(plan, plan.weeks)}" value="${esc(e.specific || '')}">
    ${e.id ? `<label class="row" style="gap:10px"><input id="eDone" type="checkbox" ${e.done ? 'checked' : ''} style="width:22px;height:22px;accent-color:var(--me)">완료함</label>` : ''}
    ${e.id && e.late_count ? `<div class="between" style="background:var(--late-soft);border-radius:10px;padding:8px 12px"><span style="color:var(--late-ink);font-size:14px">밀림 기록 ${e.late_count}번</span><button class="btn danger small" data-act="resetLate">밀림 취소</button></div>` : ''}
    <button class="btn" data-act="saveTask">저장</button>
  </div></div>`;
}

function readSheet() {
  const e = S.editing;
  e.title = document.getElementById('eTitle').value.trim();
  e.subject = document.getElementById('eSubj').value;
  e.week_from = parseInt(document.getElementById('eWf').value, 10);
  e.week_to = Math.max(e.week_from, parseInt(document.getElementById('eWt').value, 10));
  e.specific = document.getElementById('eDay').value;
  const dn = document.getElementById('eDone');
  if (dn) e.done = dn.checked;
}

async function saveTask() {
  readSheet();
  const e = S.editing, plan = S.myPlan;
  if (!e.title) { toast('할 일을 적어주세요'); return; }
  let day;
  if (e.specific) {
    day = e.specific;
    const w = clamp(weekNo(plan, day), 1, plan.weeks);
    e.week_from = Math.min(e.week_from, w); e.week_to = Math.max(e.week_to, w);
  } else {
    const orig = S.myTasks.find((t) => t.id === e.id);
    if (orig && orig.week_from === e.week_from && orig.week_to === e.week_to && orig.day) day = orig.day;
    else {
      day = weekStart(plan, e.week_from);
      if (day < today()) day = today();
      if (day > weekEnd(plan, e.week_to)) day = weekEnd(plan, e.week_to);
    }
  }
  const row = { subject: e.subject, title: e.title, kind: e.kind || null, week_from: e.week_from, week_to: e.week_to, day, edited: true };
  let res;
  if (e.id) {
    const orig = S.myTasks.find((t) => t.id === e.id);
    if (e.done !== orig.done) { row.done = e.done; row.done_at = e.done ? new Date().toISOString() : null; }
    if ((e.late_count || 0) !== (orig.late_count || 0)) row.late_count = e.late_count || 0;
    res = await sb.from('tasks').update(row).eq('id', e.id);
  } else {
    res = await sb.from('tasks').insert({ ...row, user_id: S.user.id, sort: S.myTasks.length });
  }
  if (res.error) { toast('저장 실패: ' + res.error.message); return; }
  S.editing = null; renderSheet();
  await loadMine();
  toast('저장했어요');
}

async function delTask() {
  const e = S.editing;
  if (!e.confirmDel) { readSheet(); e.confirmDel = true; renderSheet(); return; }
  const { error } = await sb.from('tasks').delete().eq('id', e.id);
  if (error) { toast('삭제 실패: ' + error.message); return; }
  S.editing = null; renderSheet();
  await loadMine();
}

/* ---------- 대결 ---------- */
function fighterSvg(p, side, color) {
  const id = 'cf' + side;
  const face = p?.avatar_url
    ? `<image href="${esc(p.avatar_url)}" x="22" y="10" width="48" height="48" preserveAspectRatio="xMidYMid slice" clip-path="url(#${id})"/>`
    : `<circle cx="46" cy="34" r="24" fill="${color}"/><text x="46" y="42" text-anchor="middle" font-size="22" font-weight="700" fill="#fff" ${side === 'R' ? 'transform="scale(-1,1) translate(-92,0)"' : ''}>${esc((p?.name || '?').slice(0, 1))}</text>`;
  return `<svg class="body" viewBox="0 0 92 130" aria-hidden="true">
    <defs><clipPath id="${id}"><circle cx="46" cy="34" r="24"/></clipPath></defs>
    <ellipse cx="46" cy="126" rx="30" ry="4" fill="rgba(0,0,0,.12)"/>
    <rect x="32" y="96" width="11" height="28" rx="5.5" fill="${color}"/>
    <rect x="49" y="96" width="11" height="28" rx="5.5" fill="${color}"/>
    <circle cx="24" cy="74" r="9" fill="#E5484D"/>
    <rect x="29" y="56" width="34" height="46" rx="13" fill="${color}"/>
    <g class="arm"><rect x="52" y="64" width="22" height="10" rx="5" fill="${color}"/><circle cx="78" cy="69" r="10" fill="#E5484D"/></g>
    <g class="face"><circle cx="46" cy="34" r="26" fill="#fff"/>${face}</g>
  </svg>`;
}

function viewFight() {
  const ns = nickState();
  const shownMy = S.replay ? S.replay.my : ns.myHits, shownFr = S.replay ? S.replay.fr : ns.frHits;
  const myHp = Math.max(0, 100 - shownFr * HIT), frHp = Math.max(0, 100 - shownMy * HIT);
  const mc = S.me.color, fc = S.fr.color;
  const cwM = S.myPlan ? curWeek(S.myPlan) : 1, cwF = S.frPlan ? curWeek(S.frPlan) : 1;
  const late = (ts) => ts.filter(isLate).length + ts.reduce((a, t) => a + (t.late_count || 0), 0);
  const rows = [
    ['오늘 때린 횟수', ns.myHits, ns.frHits],
    ['이번 주', pct(S.myTasks.filter((t) => inWeek(t, cwM))) + '%', pct(S.frTasks.filter((t) => inWeek(t, cwF))) + '%'],
    ['전체', pct(S.myTasks) + '%', pct(S.frTasks) + '%'],
    ['연속 공부', streak(S.myTasks) + '일', streak(S.frTasks) + '일'],
    ['밀림 기록', late(S.myTasks) + '번', late(S.frTasks) + '번'],
  ];
  let banner;
  if (ns.meWin) {
    banner = `<div class="card" style="border:2px solid var(--me)">
      <div class="between"><h2>오늘은 내가 이기는 중</h2><span class="sub num" id="cd"></span></div>
      <label class="label" for="nick">${esc(S.fr.name)} 오늘 호칭 정하기</label>
      <div class="row"><input id="nick" maxlength="12" placeholder="예: 족보도망자" value="${esc(S.me.nickname_day === today() ? S.me.nickname_for_friend || '' : '')}"><button class="btn small" data-act="saveNick">정하기</button></div>
      <div class="sub">친구 앱 전체에서 이름 대신 이 호칭이 떠요. 친구가 역전하면 사라지고, 자정에 초기화돼요.</div>
    </div>`;
  } else if (ns.frWin) {
    banner = `<div class="card" style="border:2px solid var(--late)">
      <div class="between"><h2 style="color:var(--late-ink)">지는 중…</h2><span class="sub num" id="cd"></span></div>
      <div class="sub">${ns.frNick ? `친구가 정한 내 호칭: <b style="color:var(--late-ink)">${esc(ns.frNick)}</b>. ` : ''}${ns.frHits - ns.myHits + 1}개 더 끝내면 역전해서 내가 호칭을 정할 수 있어요.</div>
    </div>`;
  } else {
    banner = `<div class="card"><div class="between"><h2>동점</h2><span class="sub num" id="cd"></span></div><div class="sub">먼저 하나 더 끝내는 사람이 상대 호칭을 정해요.</div></div>`;
  }

  let weeks = '';
  if (S.frPlan) {
    for (let w = 1; w <= S.frPlan.weeks; w++) {
      const fl = S.frTasks.filter((t) => inWeek(t, w));
      const ml = S.myPlan && w <= S.myPlan.weeks ? S.myTasks.filter((t) => inWeek(t, w)) : [];
      const fp = pct(fl), mp = pct(ml);
      weeks += `<details class="week" ${w === cwF ? 'open' : ''}>
        <summary class="between"><b>${w}주차</b><span class="sub num">나 <b style="color:${esc(mc)}">${mp}%</b> · ${esc(frName())} <b style="color:${esc(fc)}">${fp}%</b> ${mp > fp ? '· 이김' : mp < fp ? '· 짐' : ''}</span></summary>
        <div style="display:flex;flex-direction:column;gap:8px;padding-top:10px">
          ${fl.length ? fl.map((t) => {
            const st = t.done ? `<span class="st ok">완료${t.late_count ? ` · ${t.late_count}번 밀림` : ''}</span>` : isLate(t) ? `<span class="st bad">못함 · ${diffDays(deadline(t), today())}일 밀림</span>` : '<span class="st rest">남음</span>';
            return `<div class="between" style="font-size:14px;${isLate(t) ? 'background:var(--late-soft);margin:0 -8px;padding:6px 8px;border-radius:8px' : ''}"><span style="min-width:0">${esc(t.subject)} · ${esc(t.title)}</span>${st}</div>`;
          }).join('') : '<div class="sub">이 주 계획 없음</div>'}
        </div>
      </details>`;
    }
  }

  const thread = S.comments.slice(-40).map((c) => {
    const mine = c.author_id === S.user.id;
    return `<div class="bubble ${mine ? 'me' : 'fr'}">${esc(c.body || '')}${c.image_url ? `<img src="${esc(c.image_url)}" alt="첨부 사진" loading="lazy">` : ''}</div>`;
  }).join('');
  const sent = S.pranks.filter((p) => p.from_id === S.user.id).slice(-3).reverse();

  return `<div class="page">
    <div class="between"><h1>${esc(meName())} vs ${esc(frName())}</h1><button class="btn line small" data-act="wake">${ICON.bell} 깨우기</button></div>
    <div class="arena" id="arena">
      <div class="hp L"><span class="row" style="gap:6px">${avatarHtml(S.me, 20)}${esc(meName())}</span><div class="bar"><i id="hpL" style="width:${myHp}%;background:${esc(mc)}"></i></div></div>
      <div class="hp R"><span class="row" style="gap:6px;justify-content:flex-end">${esc(frName())}${avatarHtml(S.fr, 20)}</span><div class="bar"><i id="hpR" style="width:${frHp}%;background:${esc(fc)}"></i></div></div>
      <div class="floor"></div>
      <div class="fighter L ${myHp === 0 ? 'ko' : ''}" id="fL">${fighterSvg(S.me, 'L', mc)}</div>
      <div class="fighter R ${frHp === 0 ? 'ko' : ''}" id="fR">${fighterSvg(S.fr, 'R', fc)}</div>
    </div>
    <div class="sub" style="text-align:center">진도 하나 끝낼 때마다 한 대씩. 오늘 ${ns.myHits}대 때리고 ${ns.frHits}대 맞음</div>
    ${banner}
    <div class="card">
      <div class="vs"><span class="a" style="color:${esc(mc)}">나</span><span class="c"></span><span class="b" style="color:${esc(fc)}">${esc(frName())}</span></div>
      ${rows.map(([k, a, b]) => `<div class="vs num"><span class="a">${a}</span><span class="c">${k}</span><span class="b">${b}</span></div>`).join('')}
    </div>
    <div class="card">
      <h2>${esc(frName())} 전체 계획</h2>
      ${S.frPlan ? weeks : '<div class="sub">친구가 아직 계획을 안 만들었어요</div>'}
    </div>
    <div class="card">
      <h2>댓글 · 사진</h2>
      <div class="sub">사진을 보내면 친구 화면에 둥둥 떠다녀요. 15번 연타해야 부서져요.</div>
      <div style="display:flex;flex-direction:column;gap:8px">${thread || '<div class="sub">아직 댓글이 없어요</div>'}</div>
      ${sent.length ? `<div style="display:flex;flex-direction:column;gap:4px">${sent.map((p) => `<div class="sub">보낸 사진: ${p.broken ? '부서짐' : `떠다니는 중 · ${p.hits}/${p.hits_needed}`}</div>`).join('')}</div>` : ''}
      <div class="row">
        <button class="btn line" style="width:48px;padding:0;flex:none" data-act="sendPhoto" aria-label="사진 보내기">${ICON.photo}</button>
        <label for="cmt" class="hidden">댓글</label>
        <input id="cmt" placeholder="${esc(frName())} 진도에 한마디" value="${esc(S.draft)}">
        <button class="btn small" data-act="sendComment" style="height:44px">보내기</button>
      </div>
    </div>
  </div>`;
}

let cdTimer = null;
function tickCountdown() {
  clearInterval(cdTimer);
  const upd = () => {
    const el = document.getElementById('cd');
    if (!el) { clearInterval(cdTimer); return; }
    const now = new Date(); const mid = new Date(now); mid.setHours(24, 0, 0, 0);
    const s = Math.floor((mid - now) / 1000);
    el.textContent = `초기화 ${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
    if (s <= 1) setTimeout(render, 1500);
  };
  upd(); cdTimer = setInterval(upd, 1000);
}

/* 자리 비운 사이 쌓인 펀치 몰아보기 */
const seenKey = () => 'sm-seen-' + (S.user?.id || '');
function getSeen() { try { return localStorage.getItem(seenKey()); } catch (e) { return null; } }
function setSeen(iso) { try { localStorage.setItem(seenKey(), iso || new Date().toISOString()); } catch (e) { /* */ } }

function prepareReplay() {
  if (!S.fr || S.replay) return;
  const seen = getSeen();
  const ev = [];
  S.myTasks.forEach((t) => { if (t.done && localDay(t.done_at) === today() && (!seen || t.done_at > seen)) ev.push({ who: 'me', at: t.done_at }); });
  S.frTasks.forEach((t) => { if (t.done && localDay(t.done_at) === today() && (!seen || t.done_at > seen)) ev.push({ who: 'fr', at: t.done_at }); });
  ev.sort((a, b) => (a.at < b.at ? -1 : 1));
  const queue = ev.slice(-12);
  if (!queue.length) { setSeen(); return; }
  const ns = nickState();
  const myQ = queue.filter((e) => e.who === 'me').length, frQ = queue.length - myQ;
  S.replay = { my: ns.myHits - myQ, fr: ns.frHits - frQ, queue, myQ, frQ };
}

function runReplay() {
  const R = S.replay;
  if (!R || R.running) return;
  R.running = true;
  const parts = [];
  if (R.frQ) parts.push(`${R.frQ}대 맞고`);
  if (R.myQ) parts.push(`${R.myQ}대 때림`);
  toast(`자리 비운 사이 ${parts.join(' ')}`.replace(/고$/, '음'), 2000);
  let i = 0;
  const step = () => {
    if (S.tab !== 'fight' || !document.getElementById('arena')) { S.replay = null; setSeen(); return; }
    if (i >= R.queue.length) { S.replay = null; setSeen(); render(); return; }
    const e = R.queue[i++];
    if (e.who === 'me') R.my++; else R.fr++;
    animatePunch(e.who);
    const hpL = document.getElementById('hpL'), hpR = document.getElementById('hpR');
    setTimeout(() => {
      if (hpL) hpL.style.width = Math.max(0, 100 - R.fr * HIT) + '%';
      if (hpR) hpR.style.width = Math.max(0, 100 - R.my * HIT) + '%';
      if (R.fr * HIT >= 100) document.getElementById('fL')?.classList.add('ko');
      if (R.my * HIT >= 100) document.getElementById('fR')?.classList.add('ko');
    }, 170);
    setTimeout(step, 750);
  };
  setTimeout(step, 600);
}

function punch(who) {
  if (!document.getElementById('arena') || S.replay) {
    if (who === 'fr' && !S.replay) toast(`${frName()}가 진도 끝냄 · 한 대 맞았어요`);
    return;
  }
  animatePunch(who);
  setSeen();
  setTimeout(render, 900);
}

function animatePunch(who) {
  const att = document.getElementById(who === 'me' ? 'fL' : 'fR');
  const def = document.getElementById(who === 'me' ? 'fR' : 'fL');
  if (!att || !def) return;
  att.classList.add('punch');
  setTimeout(() => {
    att.classList.remove('punch');
    def.classList.remove('hit'); void def.offsetWidth; def.classList.add('hit');
    const arena = document.getElementById('arena');
    const r = def.getBoundingClientRect(), ar = arena.getBoundingClientRect();
    const d = document.createElement('div');
    d.className = 'dmg'; d.textContent = '-' + HIT;
    d.style.left = (r.left - ar.left + 30) + 'px'; d.style.top = (r.top - ar.top - 4) + 'px';
    arena.appendChild(d);
    setTimeout(() => d.remove(), 800);
    if (navigator.vibrate) navigator.vibrate(who === 'me' ? 20 : [40, 30, 40]);
  }, 160);
}

async function saveNick() {
  const v = document.getElementById('nick').value.trim().slice(0, 12);
  if (!v) { toast('호칭을 적어주세요'); return; }
  if (!nickState().meWin) { toast('이기고 있을 때만 정할 수 있어요'); return; }
  const { error } = await sb.from('profiles').update({ nickname_for_friend: v, nickname_day: today() }).eq('id', S.user.id);
  if (error) { toast('저장 실패: ' + error.message); return; }
  S.me.nickname_for_friend = v; S.me.nickname_day = today();
  toast(`오늘 ${S.fr.name}의 호칭: ${v}`);
  render();
}

async function sendComment() {
  const el = document.getElementById('cmt');
  const body = (el?.value || '').trim();
  if (!body) return;
  S.draft = ''; el.value = '';
  const { error } = await sb.from('comments').insert({ author_id: S.user.id, target_id: S.fr.id, body });
  if (error) { toast('전송 실패: ' + error.message); S.draft = body; render(); return; }
  callApi({ action: 'push', kind: 'comment', text: body }).catch(() => {});
}

function sendPhoto() {
  pickFile(async (file) => {
    toast('사진 보내는 중…');
    try {
      const url = await uploadPhoto(file);
      const c = await sb.from('comments').insert({ author_id: S.user.id, target_id: S.fr.id, image_url: url, body: '' });
      if (c.error) throw c.error;
      const p = await sb.from('pranks').insert({ from_id: S.user.id, to_id: S.fr.id, image_url: url });
      if (p.error) throw p.error;
      toast('친구 화면에 사진 투척 완료');
      callApi({ action: 'push', kind: 'prank' }).catch(() => {});
    } catch (e) { toast('사진 전송 실패: ' + (e.message || e)); }
  });
}

async function wake() {
  const left = 30 - Math.floor((Date.now() - S.lastWake) / 1000);
  if (left > 0) { toast(`${left}초 뒤에 다시 깨울 수 있어요`); return; }
  S.lastWake = Date.now();
  try {
    const r = await callApi({ action: 'push', kind: 'wake' });
    toast(r.sent ? `${frName()} 폰에 알림 보냄` : (r.reason || '알림을 못 보냈어요'));
  } catch (e) { toast('알림 실패: ' + e.message); }
}

/* ---------- 떠다니는 사진 ---------- */
const floaters = {};
let floatRaf = null;
function syncPranks() {
  const active = S.pranks.filter((p) => p.to_id === S.user?.id && !p.broken);
  const ids = new Set(active.map((p) => p.id));
  Object.keys(floaters).forEach((id) => { if (!ids.has(id)) { floaters[id].el.remove(); delete floaters[id]; } });
  active.forEach((p) => {
    if (floaters[p.id]) { floaters[p.id].p = p; updateFloater(floaters[p.id]); return; }
    const el = document.createElement('button');
    el.className = 'prank';
    el.setAttribute('aria-label', '친구가 보낸 사진. 연타해서 부수기');
    el.innerHTML = `<img src="${esc(p.image_url)}" alt=""><svg class="crack" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><path d="M50 50L20 10M50 50L85 18M50 50L92 60M50 50L60 95M50 50L12 70M35 30L30 45M70 35L80 45" stroke="#fff" stroke-width="2" fill="none"/></svg><div class="cnt"></div>`;
    const w = window.innerWidth, h = window.innerHeight;
    const f = { p, el, x: Math.random() * (w - 140), y: 80 + Math.random() * (h - 300), vx: (Math.random() < 0.5 ? -1 : 1) * (1 + Math.random()), vy: (Math.random() < 0.5 ? -1 : 1) * (0.8 + Math.random()), local: p.hits };
    el.addEventListener('click', () => hitFloater(f));
    document.body.appendChild(el);
    floaters[p.id] = f;
    updateFloater(f);
  });
  if (Object.keys(floaters).length && !floatRaf) floatRaf = requestAnimationFrame(floatLoop);
}

function updateFloater(f) {
  const n = Math.max(f.local, f.p.hits);
  f.el.querySelector('.cnt').textContent = `연타해서 부수기 ${n}/${f.p.hits_needed}`;
  f.el.querySelector('.crack').style.opacity = String(Math.min(1, n / f.p.hits_needed));
}

function floatLoop() {
  const w = window.innerWidth, h = window.innerHeight;
  Object.values(floaters).forEach((f) => {
    if (f.dead) return;
    f.x += f.vx; f.y += f.vy;
    if (f.x < 0 || f.x > w - 130) { f.vx *= -1; f.x = clamp(f.x, 0, w - 130); }
    if (f.y < 20 || f.y > h - 210) { f.vy *= -1; f.y = clamp(f.y, 20, h - 210); }
    f.el.style.transform = `translate(${f.x}px,${f.y}px) rotate(${f.vx * 4}deg)`;
    f.el.style.left = '0'; f.el.style.top = '0';
  });
  floatRaf = Object.keys(floaters).length ? requestAnimationFrame(floatLoop) : null;
}

let hitSaveTimer = {};
function hitFloater(f) {
  if (f.dead) return;
  f.local = Math.max(f.local, f.p.hits) + 1;
  f.vx *= 1.08; f.vy *= 1.08;
  f.el.classList.remove('shake'); void f.el.offsetWidth; f.el.classList.add('shake');
  if (navigator.vibrate) navigator.vibrate(15);
  updateFloater(f);
  const id = f.p.id;
  if (f.local >= f.p.hits_needed) {
    f.dead = true;
    f.el.classList.add('boom');
    clearTimeout(hitSaveTimer[id]);
    sb.from('pranks').update({ hits: f.local, broken: true }).eq('id', id).then(({ error }) => error && toast('저장 실패: ' + error.message));
    setTimeout(() => { f.el.remove(); delete floaters[id]; }, 500);
    f.p.broken = true;
    toast('부숴버렸다');
    return;
  }
  clearTimeout(hitSaveTimer[id]);
  hitSaveTimer[id] = setTimeout(() => sb.from('pranks').update({ hits: f.local }).eq('id', id).then(() => {}), 400);
}

/* ---------- 프로필 ---------- */
function viewProfile() {
  const me = S.me;
  const pushOn = 'Notification' in window && Notification.permission === 'granted';
  const standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  return `<div class="page">
    <h1>프로필</h1>
    <div class="card" style="align-items:center;text-align:center">
      ${avatarHtml(me, 96)}
      <button class="btn line small" data-act="avatar">프로필 사진 바꾸기</button>
      ${S.frNickNote()}
    </div>
    <div class="card">
      <label class="label" for="pName">이름</label>
      <div class="row"><input id="pName" maxlength="12" value="${esc(me.name)}"><button class="btn small" data-act="saveName">저장</button></div>
    </div>
    <div class="card">
      <div class="label">내 테마 색</div>
      <div class="chips">${THEMES.map((c) => `<button class="swatch ${c.toLowerCase() === (me.color || '').toLowerCase() ? 'on' : ''}" style="background:${c}" data-act="color" data-c="${c}" aria-label="색 ${c}"></button>`).join('')}</div>
      <div class="sub">대결 화면이랑 친구 앱에서 내 캐릭터가 이 색으로 보여요</div>
    </div>
    <div class="card">
      <div class="between"><h2>알림</h2><span class="sub">${pushOn ? '켜짐' : '꺼짐'}</span></div>
      <div class="sub">친구가 깨우기, 사진, 댓글을 보내면 폰으로 알림이 와요.${standalone ? '' : ' 아이폰은 Safari 공유 버튼 → "홈 화면에 추가"로 설치한 앱에서만 켤 수 있어요.'}</div>
      <button class="btn ${pushOn ? 'line' : ''}" data-act="enablePush">${pushOn ? '알림 다시 연결' : '알림 켜기'}</button>
    </div>
    <div class="card">
      ${S.fr ? `<div class="between"><span class="sub">연결된 친구</span><span class="row" style="gap:8px">${avatarHtml(S.fr, 24)}<b>${esc(S.fr.name)}</b></span></div>`
        : `<div class="between"><span class="sub">내 초대 코드</span><b class="num" style="letter-spacing:.1em">${esc(me.invite_code)}</b></div><button class="btn line small" data-act="tab" data-tab="fight">친구 연결하러 가기</button>`}
    </div>
    <button class="btn line" data-act="logout">로그아웃</button>
  </div>`;
}
S.frNickNote = () => { const ns = nickState(); return ns.frNick && S.fr ? `<div class="pill late">${esc(S.fr.name)}가 정한 오늘 내 호칭: ${esc(ns.frNick)}</div>` : ''; };

function b64ToUint8(b64) {
  const p = '='.repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + p).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

async function enablePush() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
    toast('이 브라우저는 알림이 안 돼요. 아이폰은 홈 화면에 추가해서 열어주세요', 4000); return;
  }
  if (!CFG.vapidPublicKey) { toast('config.js에 알림 키가 없어요'); return; }
  try {
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') { toast('알림이 허용되지 않았어요. 설정에서 허용해주세요'); return; }
    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToUint8(CFG.vapidPublicKey) });
    const { error } = await sb.from('push_subs').upsert({ user_id: S.user.id, sub: sub.toJSON(), updated_at: new Date().toISOString() });
    if (error) throw error;
    toast('알림 켰어요');
  } catch (e) { toast('알림 설정 실패: ' + (e.message || e)); }
  render();
}

async function updateMe(patch) {
  const { error } = await sb.from('profiles').update(patch).eq('id', S.user.id);
  if (error) { toast('저장 실패: ' + error.message); return false; }
  Object.assign(S.me, patch); applyColors(); render();
  return true;
}

/* ---------- 데이터 ---------- */
function applyColors() {
  document.documentElement.style.setProperty('--me', S.me?.color || '#1F6F5C');
  document.documentElement.style.setProperty('--fr', S.fr?.color || '#4A6FA5');
}

async function loadMine() {
  const [p, t] = await Promise.all([
    sb.from('plans').select('*').eq('user_id', S.user.id).maybeSingle(),
    sb.from('tasks').select('*').eq('user_id', S.user.id).order('sort'),
  ]);
  S.myPlan = p.data || null;
  S.myTasks = t.data || [];
  render();
}

async function loadAll() {
  if (!S.user) return;
  let me = null;
  for (let i = 0; i < 5 && !me; i++) {
    const r = await sb.from('profiles').select('*').eq('id', S.user.id).maybeSingle();
    me = r.data;
    if (!me) await new Promise((res) => setTimeout(res, 700));
  }
  S.me = me;
  if (!me) { S.loaded = true; S.err = '프로필을 불러오지 못했어요. 새로고침 해주세요'; render(); return; }
  S.fr = null;
  if (me.friend_id) S.fr = (await sb.from('profiles').select('*').eq('id', me.friend_id).maybeSingle()).data;
  const ids = [S.user.id, me.friend_id].filter(Boolean);
  const [plans, tasks, comments, pranks] = await Promise.all([
    sb.from('plans').select('*').in('user_id', ids),
    sb.from('tasks').select('*').in('user_id', ids).order('sort'),
    sb.from('comments').select('*').order('created_at'),
    sb.from('pranks').select('*').order('created_at'),
  ]);
  S.myPlan = (plans.data || []).find((p) => p.user_id === S.user.id) || null;
  S.frPlan = (plans.data || []).find((p) => p.user_id === me.friend_id) || null;
  S.myTasks = (tasks.data || []).filter((t) => t.user_id === S.user.id);
  S.frTasks = (tasks.data || []).filter((t) => t.user_id === me.friend_id);
  S.comments = comments.data || [];
  S.pranks = pranks.data || [];
  S.loaded = true; S.err = '';
  applyColors();
  subscribe();
  if (S.tab === 'fight') prepareReplay();
  render();
  syncPranks();
}

function upsertIn(arr, row) {
  const i = arr.findIndex((x) => x.id === row.id);
  if (i < 0) arr.push(row); else arr[i] = row;
}

function subscribe() {
  if (S.channel) return;
  S.channel = sb.channel('studymate')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'tasks' }, (pl) => {
      const row = pl.new && pl.new.id ? pl.new : null;
      if (pl.eventType === 'DELETE') {
        const id = pl.old.id;
        S.myTasks = S.myTasks.filter((t) => t.id !== id); S.frTasks = S.frTasks.filter((t) => t.id !== id);
        render(); return;
      }
      if (!row) return;
      if (row.user_id === S.user.id) {
        const prev = S.myTasks.find((t) => t.id === row.id);
        upsertIn(S.myTasks, prev ? { ...prev, ...row } : row);
      } else if (row.user_id === S.me?.friend_id) {
        const prev = S.frTasks.find((t) => t.id === row.id);
        upsertIn(S.frTasks, row);
        if (row.done && (!prev || !prev.done) && row.done_at && Date.now() - new Date(row.done_at).getTime() < 60000) punch('fr');
      }
      render();
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'plans' }, (pl) => {
      const row = pl.new;
      if (!row?.user_id) return;
      if (row.user_id === S.user.id) S.myPlan = row; else if (row.user_id === S.me?.friend_id) S.frPlan = row;
      render();
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'comments' }, (pl) => {
      if (pl.eventType === 'DELETE') S.comments = S.comments.filter((c) => c.id !== pl.old.id);
      else if (pl.new?.id) {
        const isNew = !S.comments.some((c) => c.id === pl.new.id);
        upsertIn(S.comments, pl.new);
        if (isNew && pl.new.author_id !== S.user.id && S.tab !== 'fight') toast(`${frName()}: ${pl.new.body || '사진을 보냈어요'}`);
      }
      render();
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'pranks' }, (pl) => {
      if (pl.new?.id) upsertIn(S.pranks, pl.new);
      syncPranks(); render();
    })
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'profiles' }, async (pl) => {
      const row = pl.new;
      if (!row?.id) return;
      if (row.id === S.user.id) {
        const paired = !S.me?.friend_id && row.friend_id;
        S.me = { ...S.me, ...row };
        if (paired) { await loadAll(); return; }
        applyColors();
      } else if (row.id === S.me?.friend_id) { S.fr = { ...S.fr, ...row }; applyColors(); }
      render();
    })
    .subscribe();
}

/* ---------- 이벤트 ---------- */
document.addEventListener('click', async (ev) => {
  const el = ev.target.closest('[data-act]');
  if (!el) return;
  const a = el.dataset.act;
  if (a === 'closeSheet') { if (ev.target === el) { S.editing = null; renderSheet(); } return; }
  ev.preventDefault();
  switch (a) {
    case 'tab':
      if (S.tab === 'fight' && el.dataset.tab !== 'fight') { S.replay = null; setSeen(); }
      S.tab = el.dataset.tab; S.err = ''; window.scrollTo(0, 0);
      if (S.tab === 'fight') prepareReplay();
      render(); break;
    case 'authMode': S.authMode = S.authMode === 'login' ? 'signup' : 'login'; S.err = ''; render(); break;
    case 'logout': await sb.auth.signOut(); break;
    case 'copyCode':
      try { await navigator.clipboard.writeText(S.me.invite_code); toast('복사했어요'); } catch (e) { toast(S.me.invite_code); }
      break;
    case 'homeView': S.homeView = el.dataset.v; render(); break;
    case 'selDay': S.selDay = el.dataset.d; render(); break;
    case 'toggle': { const t = S.myTasks.find((x) => x.id === el.dataset.id); if (t) setDone(t.id, !t.done, el); break; }
    case 'startPlan': S.form = newForm(); S.tab = 'plan'; S.err = ''; render(); break;
    case 'cancelSetup': S.form = null; S.err = ''; render(); break;
    case 'fWeeks': readForm(); S.form.weeks = +el.dataset.n; render(); break;
    case 'fKind': { readForm(); const k = el.dataset.k, ks = S.form.kinds; S.form.kinds = ks.includes(k) ? ks.filter((x) => x !== k) : ks.concat(k); render(); break; }
    case 'addKind': {
      readForm(); const inp = document.getElementById('fNewKind'); const v = inp.value.trim();
      if (v && !DEFAULT_KINDS.includes(v) && !S.form.extraKinds.includes(v)) S.form.extraKinds.push(v);
      if (v && !S.form.kinds.includes(v)) S.form.kinds.push(v);
      inp.value = ''; render(); break;
    }
    case 'addSubj': readForm(); S.form.subjects.push({ name: '', range: '' }); render(); break;
    case 'delSubj': readForm(); S.form.subjects.splice(+el.dataset.i, 1); render(); break;
    case 'makePlan': makePlan(true); break;
    case 'makeEmpty': makePlan(false); break;
    case 'planView': S.planView = el.dataset.v; render(); break;
    case 'replan': replan(); break;
    case 'editTask': openEdit(el.dataset.id); break;
    case 'addTask': openEdit(null); break;
    case 'eKind': readSheet(); S.editing.kind = el.dataset.k; renderSheet(); break;
    case 'saveTask': saveTask(); break;
    case 'resetLate': readSheet(); S.editing.late_count = 0; renderSheet(); toast('저장을 누르면 밀림 기록이 지워져요'); break;
    case 'delTask': delTask(); break;
    case 'saveNick': saveNick(); break;
    case 'sendComment': sendComment(); break;
    case 'sendPhoto': sendPhoto(); break;
    case 'wake': wake(); break;
    case 'avatar':
      pickFile(async (file) => {
        toast('사진 올리는 중…');
        try { const url = await uploadPhoto(file); if (await updateMe({ avatar_url: url })) toast('프로필 사진 바꿨어요'); } catch (e) { toast('업로드 실패: ' + (e.message || e)); }
      });
      break;
    case 'saveName': { const v = document.getElementById('pName').value.trim(); if (v && await updateMe({ name: v })) toast('저장했어요'); break; }
    case 'color': updateMe({ color: el.dataset.c }); break;
    case 'enablePush': enablePush(); break;
    default: break;
  }
});

document.addEventListener('input', (ev) => {
  const el = ev.target;
  if (el.id === 'cmt') { S.draft = el.value; return; }
  const f = el.dataset.f;
  if (!f || !S.form) return;
  const i = +el.dataset.i;
  if (f === 'sname') S.form.subjects[i].name = el.value;
  else if (f === 'srange') S.form.subjects[i].range = el.value;
  else if (f === 'goal') S.form.goal = el.value;
});

document.addEventListener('change', (ev) => {
  if (ev.target.id === 'fStart' && S.form) { S.form.start = ev.target.value || S.form.start; render(); }
});

document.addEventListener('submit', (ev) => {
  ev.preventDefault();
  if (ev.target.id === 'authForm') submitAuth();
  if (ev.target.id === 'pairForm') submitPair();
});

document.addEventListener('keydown', (ev) => {
  if (ev.key === 'Enter' && ev.target.id === 'cmt') { ev.preventDefault(); sendComment(); }
  if (ev.key === 'Enter' && ev.target.id === 'fNewKind') { ev.preventDefault(); document.querySelector('[data-act="addKind"]')?.click(); }
});

document.addEventListener('visibilitychange', () => { if (!document.hidden && S.user && S.loaded) loadAll(); });

/* ---------- 시작 ---------- */
async function boot() {
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
  if (!window.supabase || !CFG.supabaseUrl || !CFG.supabaseAnonKey) { render(); return; }
  sb = window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseAnonKey);
  const { data } = await sb.auth.getSession();
  S.user = data.session?.user || null;
  render();
  if (S.user) loadAll();
  sb.auth.onAuthStateChange((event, session) => {
    const prev = S.user?.id;
    S.user = session?.user || null;
    if (!S.user) {
      S.loaded = false; S.me = S.fr = null; S.myTasks = []; S.frTasks = [];
      if (S.channel) { sb.removeChannel(S.channel); S.channel = null; }
      Object.keys(floaters).forEach((id) => { floaters[id].el.remove(); delete floaters[id]; });
      render();
    } else if (S.user.id !== prev) { S.loaded = false; render(); loadAll(); }
  });
}
boot();

// 테스트용
window.__studymate = { assignDays, weekNo, streak, addDays, diffDays };
})();
