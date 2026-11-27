import {
  csvObjects, groupReadings, isISODate, isoDate, parseISO, addDays, initialDate, neighbours,
  slotParts, progressKey, parseProgress, serializeProgress, mergeProgress, b64encode, b64decode,
} from './lib.js?v=dev';

const CONFIG = {
  owner: 'pouvelenc',
  repo: 'bradbury',
  branch: 'main',
  readingsPath: 'data/readings.csv',
  progressPath: 'data/progress.csv',
};
const API = `https://api.github.com/repos/${CONFIG.owner}/${CONFIG.repo}/contents/${CONFIG.progressPath}`;
const LS = { progress: 'bradbury.progress', pending: 'bradbury.pending', token: 'bradbury.token' };
// Card labels follow the language of the piece (the `lang` column).
const STRINGS = {
  en: { poem: 'Poem', essay: 'Essay', story: 'Short story', bonus: 'bonus', by: 'By', open: 'Read online ↗' },
  sv: { poem: 'Dikt', essay: 'Essä', story: 'Novell', bonus: 'extra', by: 'Av', open: 'Läs online ↗' },
};
const strings = lang => STRINGS[lang] || STRINGS.en;

// localStorage can throw (private mode, blocked storage): never let it break the page.
const store = {
  get(k, fallback) {
    try { const v = localStorage.getItem(k); return v == null ? fallback : JSON.parse(v); }
    catch { return fallback; }
  },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* ignore */ } },
  del(k) { try { localStorage.removeItem(k); } catch { /* ignore */ } },
};

const state = {
  readings: new Map(),
  dates: [],
  progress: new Map(),
  pending: new Set(),
  remote: null,          // { sha, map } as last seen on GitHub
  today: isoDate(new Date()),
  current: null,
  token: store.get(LS.token, ''),
  sync: { busy: false, status: '', error: '', last: null, retryDelay: 0 },
  timer: null,
  lastPull: 0,
  loadError: '',
};

const $ = sel => document.querySelector(sel);

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return node;
}

// ---------- Local persistence ----------

function loadLocal() {
  const entries = store.get(LS.progress, []);
  state.progress = new Map(Array.isArray(entries)
    ? entries.filter(e => e && e.date && e.slot).map(e => [progressKey(e.date, e.slot), e])
    : []);
  state.pending = new Set(store.get(LS.pending, []));
}

function saveLocal() {
  store.set(LS.progress, [...state.progress.values()]);
  store.set(LS.pending, [...state.pending]);
}

function entry(date, slot) {
  return state.progress.get(progressKey(date, slot)) || { date, slot, read: false, rating: 0, updated: '' };
}

function setEntry(date, slot, changes) {
  const next = { ...entry(date, slot), ...changes, updated: new Date().toISOString() };
  if (next.rating) next.read = true;
  if (!next.read) next.rating = 0;
  const k = progressKey(date, slot);
  state.progress.set(k, next);
  state.pending.add(k);
  saveLocal();
  render();
  if (state.token) { setStatus('pending'); scheduleSync(1500); }
  else setStatus('local');
}

// ---------- GitHub sync ----------

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

async function httpError(res) {
  let msg = `${res.status} ${res.statusText}`;
  try { const j = await res.json(); if (j.message) msg = j.message; } catch { /* ignore */ }
  return new HttpError(res.status, msg);
}

function headers(extra = {}) {
  const h = { Accept: 'application/vnd.github+json', ...extra };
  if (state.token) h.Authorization = `Bearer ${state.token}`;
  return h;
}

async function fetchRemote() {
  const res = await fetch(`${API}?ref=${CONFIG.branch}`, { headers: headers(), cache: 'no-store' });
  if (res.status === 404) return (state.remote = { sha: null, map: new Map() });
  if (!res.ok) throw await httpError(res);
  const json = await res.json();
  return (state.remote = { sha: json.sha, map: parseProgress(b64decode(json.content || '')) });
}

// Fold remote progress into local; drop pending marks the remote already has.
function applyRemote(remote) {
  const merged = mergeProgress(state.progress, remote);
  for (const k of [...state.pending]) {
    const r = remote.get(k);
    if (r && merged.get(k) === r) state.pending.delete(k);
  }
  state.progress = merged;
  saveLocal();
}

async function pull() {
  state.lastPull = Date.now();
  try {
    const remote = await fetchRemote();
    applyRemote(remote.map);
    render();
    if (!state.pending.size && state.token) setStatus('synced');
  } catch (e) {
    handleSyncError(e, false);
  }
}

function describe(e) {
  return `${e.date} ${e.slot} ${e.read ? '✓' : '○'}${e.rating ? ' ★' + e.rating : ''}`;
}

function commitMessage(keys) {
  const entries = keys.map(k => state.progress.get(k)).filter(Boolean);
  if (entries.length === 1) return `progress: ${describe(entries[0])}`;
  return `progress: ${entries.length} updates\n\n${entries.map(describe).join('\n')}`;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function push() {
  clearTimeout(state.timer);
  if (!state.token || !state.pending.size || state.sync.busy) return;
  if (!navigator.onLine) { setStatus('offline'); return; }
  state.sync.busy = true;
  setStatus('syncing');
  const sent = new Map([...state.pending].map(k => [k, state.progress.get(k)?.updated]));
  try {
    let remote = state.remote || await fetchRemote();
    for (let attempt = 1; ; attempt++) {
      const merged = mergeProgress(remote.map, state.progress);
      const body = {
        message: commitMessage([...sent.keys()]),
        content: b64encode(serializeProgress(merged)),
        branch: CONFIG.branch,
      };
      if (remote.sha) body.sha = remote.sha;
      const res = await fetch(API, {
        method: 'PUT',
        headers: headers({ 'Content-Type': 'application/json' }),
        body: JSON.stringify(body),
      });
      if (res.ok) {
        const json = await res.json();
        state.remote = { sha: json.content.sha, map: merged };
        state.progress = mergeProgress(merged, state.progress); // keep taps made meanwhile
        for (const [k, updated] of sent) {
          if (state.progress.get(k)?.updated === updated) state.pending.delete(k);
        }
        saveLocal();
        state.sync.last = new Date();
        state.sync.error = '';
        state.sync.retryDelay = 0;
        render();
        setStatus(state.pending.size ? 'pending' : 'synced');
        break;
      }
      // 409: file changed since we read it. 422: sha missing/stale. Re-read and retry.
      if ((res.status === 409 || res.status === 422) && attempt < 4) {
        await sleep(400 * attempt);
        remote = await fetchRemote();
        continue;
      }
      throw await httpError(res);
    }
  } catch (e) {
    handleSyncError(e, true);
  } finally {
    state.sync.busy = false;
    if (state.pending.size && state.sync.status === 'pending') scheduleSync(1500);
  }
}

function handleSyncError(e, retry) {
  console.warn('Sync error', e);
  if (!state.token) { setStatus(state.pending.size ? 'local' : ''); return; }
  if (e instanceof HttpError && (e.status === 401 || (e.status === 403 && /credential|permission|access/i.test(e.message)))) {
    state.sync.error = e.message;
    setStatus('auth');
    return;
  }
  state.sync.error = e.message || String(e);
  if (!navigator.onLine || e instanceof TypeError) setStatus(state.pending.size ? 'offline' : '');
  else setStatus(state.pending.size ? 'error' : '');
  if (retry && state.pending.size) {
    state.sync.retryDelay = Math.min((state.sync.retryDelay || 15000) * 2, 300000);
    scheduleSync(state.sync.retryDelay);
  }
}

function scheduleSync(delay) {
  clearTimeout(state.timer);
  state.timer = setTimeout(push, delay);
}

// ---------- Status line ----------

const STATUS_TEXT = {
  local: 'Saved on this device',
  pending: 'Saving…',
  syncing: 'Syncing…',
  synced: 'Saved to GitHub ✓',
  offline: 'Offline — will sync later',
  error: 'Sync failed — will retry',
  auth: 'GitHub token rejected — check settings',
};

function setStatus(s) {
  state.sync.status = s;
  const node = $('#status');
  node.textContent = STATUS_TEXT[s] || '';
  node.dataset.state = s;
  renderSettingsDetail();
}

// ---------- Rendering ----------

const fmtDay = new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
const fmtDateline = new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
const fmtMonth = new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric' });
const fmtTime = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit' });

function daysBetween(a, b) {
  return Math.round((parseISO(b) - parseISO(a)) / 86400000);
}

function relative(d) {
  const n = daysBetween(state.today, d);
  if (n === 0) return 'Today';
  if (n === 1) return 'Tomorrow';
  if (n === -1) return 'Yesterday';
  return n > 0 ? `In ${n} days` : `${-n} days ago`;
}

function label(slot, lang) {
  const { type, n } = slotParts(slot);
  const t = strings(lang);
  const base = t[type] || type.charAt(0).toUpperCase() + type.slice(1);
  return n > 1 ? `${base} · ${t.bonus}` : base;
}

function render() {
  const d = state.current;
  if (!d) return;
  const first = state.dates[0];

  $('#date').textContent = fmtDateline.format(parseISO(d));
  const dayNo = first && d >= first ? `No. ${daysBetween(first, d) + 1} · ` : '';
  $('#subtitle').textContent = dayNo + relative(d);
  document.title = `${fmtDay.format(parseISO(d))} · Bradbury`;

  const banner = $('#banner');
  if (state.loadError) {
    banner.textContent = state.loadError;
    banner.hidden = false;
  } else if (first && state.today < first) {
    banner.textContent = `The challenge starts on ${fmtDay.format(parseISO(first))}. Here’s a preview.`;
    banner.hidden = false;
  } else banner.hidden = true;

  renderPieces(d);
  renderMonth(d);

  const { prev, next } = neighbours(d, state.dates, state.today);
  $('#prev').disabled = !prev;
  $('#next').disabled = !next;
  $('#today').hidden = d === state.today || (first && state.today < first);
}

function renderPieces(d) {
  const box = $('#pieces');
  const pieces = state.readings.get(d) || [];
  if (!pieces.length) {
    const last = state.dates[state.dates.length - 1];
    const msg = state.loadError ? '' :
      last && d > last ? 'The readings for this day haven’t been added yet.' : 'Nothing is scheduled for this day.';
    box.replaceChildren(msg ? el('p', { class: 'empty' }, msg) : '');
    return;
  }
  box.replaceChildren(...pieces.map(p => pieceCard(d, p)));
}

function pieceCard(d, p) {
  const e = entry(d, p.slot);
  const link = p.url ? { href: p.url, target: '_blank', rel: 'noopener' } : null;
  const t = strings(p.lang);

  const stars = el('div', { class: 'stars', role: 'group', 'aria-label': 'Rating' },
    [1, 2, 3, 4, 5].map(n => el('button', {
      type: 'button',
      class: n <= e.rating ? 'star on' : 'star',
      'aria-label': `${n} of 5`,
      'aria-pressed': String(n === e.rating),
      onclick: () => setEntry(d, p.slot, { rating: e.rating === n ? 0 : n }),
    }, '★')));

  return el('article', { class: e.read ? 'piece is-read' : 'piece', 'data-type': p.type, lang: p.lang || null },
    el('div', { class: 'piece-head' },
      el('span', { class: 'kind' }, label(p.slot, p.lang)),
      link && el('a', { class: 'open', ...link }, t.open)),
    el('h3', { class: 'title' }, link ? el('a', link, p.title) : p.title),
    p.author && el('p', { class: 'author' }, `${t.by} ${p.author}`),
    p.source && el('p', { class: 'meta' }, p.source),
    p.note && el('p', { class: 'note' }, p.note),
    el('div', { class: 'actions' },
      el('button', {
        type: 'button',
        class: 'read-toggle',
        'aria-pressed': String(e.read),
        onclick: () => setEntry(d, p.slot, { read: !e.read }),
      }, el('span', { class: 'check', 'aria-hidden': 'true' }), 'Read'),
      stars));
}

function renderMonth(d) {
  const [y, m] = d.split('-').map(Number);
  const daysIn = new Date(y, m, 0).getDate();
  const offset = (new Date(y, m - 1, 1).getDay() + 6) % 7; // Monday first
  $('#month-title').textContent = fmtMonth.format(new Date(y, m - 1, 1));

  let total = 0, read = 0, ratingSum = 0, rated = 0;
  const cells = [];
  for (let i = 0; i < offset; i++) cells.push(el('span', { class: 'cell blank', 'aria-hidden': 'true' }));
  for (let day = 1; day <= daysIn; day++) {
    const date = isoDate(new Date(y, m - 1, day));
    const pieces = state.readings.get(date) || [];
    const dots = pieces.map(p => {
      const e = entry(date, p.slot);
      total++;
      if (e.read) read++;
      if (e.rating) { ratingSum += e.rating; rated++; }
      return el('i', { class: e.read ? 'dot on' : 'dot' });
    });
    const done = pieces.length && dots.every(x => x.classList.contains('on'));
    const cls = ['cell',
      date === d && 'is-current',
      date === state.today && 'is-today',
      date > state.today && 'is-future',
      done && 'is-done',
      !pieces.length && 'is-empty'].filter(Boolean).join(' ');
    const readCount = dots.filter(x => x.classList.contains('on')).length;
    cells.push(el('button', {
      type: 'button',
      class: cls,
      'aria-label': `${fmtDay.format(parseISO(date))}${pieces.length ? `, ${readCount} of ${pieces.length} read` : ''}`,
      'aria-current': date === d ? 'date' : null,
      onclick: () => go(date),
    }, el('span', { class: 'num' }, day), el('span', { class: 'dots' }, dots)));
  }
  $('#grid').replaceChildren(...cells);

  $('#month-stats').textContent = total
    ? `${read} of ${total} read${rated ? ` · average ★${(ratingSum / rated).toFixed(1)}` : ''}`
    : '';
}

// ---------- Navigation ----------

function defaultDate() {
  return initialDate(state.today, state.dates);
}

function route() {
  const h = decodeURIComponent(location.hash.slice(1));
  state.current = isISODate(h) ? h : defaultDate();
  render();
}

function go(date) {
  if (!date || date === state.current) return;
  history.pushState(null, '', date === defaultDate() ? location.pathname + location.search : '#' + date);
  route();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function step(dir) {
  const { prev, next } = neighbours(state.current, state.dates, state.today);
  go(dir < 0 ? prev : next);
}

function bindSwipe() {
  let x0 = null, y0 = 0;
  const main = document.querySelector('main');
  main.addEventListener('touchstart', e => {
    if (e.touches.length !== 1 || e.target.closest('.grid')) { x0 = null; return; }
    x0 = e.touches[0].clientX; y0 = e.touches[0].clientY;
  }, { passive: true });
  main.addEventListener('touchend', e => {
    if (x0 == null) return;
    const dx = e.changedTouches[0].clientX - x0, dy = e.changedTouches[0].clientY - y0;
    x0 = null;
    if (Math.abs(dx) > 70 && Math.abs(dy) < 50) step(dx > 0 ? -1 : 1);
  }, { passive: true });
}

// ---------- Settings ----------

function renderSettingsDetail() {
  const node = $('#sync-detail');
  if (!node) return;
  const parts = [];
  parts.push(state.pending.size
    ? `${state.pending.size} change${state.pending.size === 1 ? '' : 's'} not yet saved to GitHub.`
    : 'Everything on this device is saved to GitHub.');
  if (!state.token) parts[0] = state.pending.size
    ? `${state.pending.size} change${state.pending.size === 1 ? '' : 's'} saved only on this device.`
    : 'No changes waiting.';
  if (state.sync.last) parts.push(`Last sync ${fmtTime.format(state.sync.last)}.`);
  if (state.sync.error && ['auth', 'error', 'offline'].includes(state.sync.status)) parts.push(`Last error: ${state.sync.error}`);
  node.textContent = parts.join(' ');
}

function openSettings() {
  $('#token').value = state.token;
  $('#token-state').textContent = state.token ? 'A token is saved on this device.' : 'No token saved: progress stays on this device.';
  renderSettingsDetail();
  $('#settings').showModal();
}

async function saveToken() {
  const value = $('#token').value.trim();
  const msg = $('#token-state');
  if (!value) { msg.textContent = 'Paste a token first.'; return; }
  state.token = value;
  store.set(LS.token, value);
  state.sync.error = '';
  msg.textContent = 'Checking…';
  try {
    await fetchRemote();
    applyRemote(state.remote.map);
    render();
    msg.textContent = 'Token saved. It can read the repo; your next change confirms it can write.';
    if (state.pending.size) await push();
    else setStatus('synced');
  } catch (e) {
    msg.textContent = `Saved, but GitHub said: ${e.message}`;
    handleSyncError(e, false);
  }
}

function clearToken() {
  state.token = '';
  store.del(LS.token);
  $('#token').value = '';
  $('#token-state').textContent = 'Token removed from this device.';
  setStatus(state.pending.size ? 'local' : '');
}

function exportCSV() {
  const blob = new Blob([serializeProgress(state.progress)], { type: 'text/csv' });
  const a = el('a', { href: URL.createObjectURL(blob), download: `bradbury-progress-${state.today}.csv` });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// ---------- Startup ----------

function onWake() {
  const today = isoDate(new Date());
  if (today !== state.today) { state.today = today; route(); }
  if (Date.now() - state.lastPull > 30000) pull().then(push);
  else push();
}

async function loadReadings() {
  try {
    const res = await fetch(CONFIG.readingsPath, { cache: 'no-cache' });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    const { byDate, dates } = groupReadings(csvObjects(await res.text()));
    state.readings = byDate;
    state.dates = dates;
  } catch (e) {
    console.error(e);
    state.loadError = 'Couldn’t load the reading list. Check your connection and reload.';
  }
}

async function init() {
  loadLocal();
  $('#prev').addEventListener('click', () => step(-1));
  $('#next').addEventListener('click', () => step(1));
  $('#today').addEventListener('click', () => go(state.today));
  $('#open-settings').addEventListener('click', openSettings);
  $('#save-token').addEventListener('click', saveToken);
  $('#token').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); saveToken(); } });
  $('#clear-token').addEventListener('click', clearToken);
  $('#sync-now').addEventListener('click', () => pull().then(push));
  $('#export').addEventListener('click', exportCSV);
  $('#repo-link').href = `https://github.com/${CONFIG.owner}/${CONFIG.repo}/blob/${CONFIG.branch}/${CONFIG.progressPath}`;
  window.addEventListener('popstate', route);
  window.addEventListener('hashchange', route);
  window.addEventListener('online', () => push());
  window.addEventListener('offline', () => state.pending.size && setStatus('offline'));
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && onWake());
  document.addEventListener('keydown', e => {
    if (e.target.closest('input, dialog')) return;
    if (e.key === 'ArrowLeft') step(-1);
    if (e.key === 'ArrowRight') step(1);
  });
  bindSwipe();

  await loadReadings();
  route();
  if (state.pending.size) setStatus(state.token ? 'pending' : 'local');
  await pull();
  await push();
}

init();
